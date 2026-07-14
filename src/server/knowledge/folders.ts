import {
  mapKnowledgeNodeRow,
  NODE_COLUMNS,
  type KnowledgeNode,
  type KnowledgeNodeRow,
  type KnowledgeQueryable,
} from "./repository.ts";
import { loadKnowledgePreviews, type KnowledgePreview } from "./previews.ts";
import type { KnowledgeEntityType } from "./types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_FOLDER_DEPTH = 8;

export class KnowledgeFolderError extends Error {
  constructor(readonly code: "invalid" | "conflict" | "not_found", message: string) {
    super(message);
    this.name = "KnowledgeFolderError";
  }
}

export interface KnowledgeFolder {
  id: string;
  parentId: string | null;
  name: string;
  sourceType: "manual" | "inspiration_book";
  sourceEntityId: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  hasChildren: boolean;
  nodeCount: number;
}

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  source_type: "manual" | "inspiration_book";
  source_entity_id: string | null;
  sort_order: number | string;
  created_at: number | string;
  updated_at: number | string;
  has_children: boolean;
  node_count: number | string;
}

interface FolderCursor { sortOrder: number; id: string }
interface NodeCursor { updatedAt: number; id: string }

export interface ExplorerNode {
  node: KnowledgeNode;
  preview: KnowledgePreview;
  folders: Array<{ id: string; name: string }>;
}

function safeInteger(value: number | string, field: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`Invalid ${field}`);
  return result;
}

function parseCursor<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    throw new KnowledgeFolderError("invalid", "分页游标无效");
  }
}

export function encodeKnowledgeCursor(value: FolderCursor | NodeCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeKnowledgeCursor<T extends FolderCursor | NodeCursor>(value: string): T {
  const parsed = parseCursor<T>(value);
  if (!parsed || !Number.isSafeInteger("sortOrder" in parsed ? parsed.sortOrder : parsed.updatedAt) || !UUID_PATTERN.test(parsed.id)) {
    throw new KnowledgeFolderError("invalid", "分页游标无效");
  }
  return parsed;
}

function cleanName(value: string): string {
  const name = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!name || name.length > 120) throw new KnowledgeFolderError("invalid", "目录名称无效");
  return name;
}

function assertUuid(value: string | null | undefined, label: string): void {
  if (value !== null && value !== undefined && !UUID_PATTERN.test(value)) {
    throw new KnowledgeFolderError("invalid", `${label}无效`);
  }
}

function mapFolder(row: FolderRow): KnowledgeFolder {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    sourceType: row.source_type,
    sourceEntityId: row.source_entity_id,
    sortOrder: safeInteger(row.sort_order, "folder sort order"),
    createdAt: safeInteger(row.created_at, "folder created at"),
    updatedAt: safeInteger(row.updated_at, "folder updated at"),
    hasChildren: Boolean(row.has_children),
    nodeCount: safeInteger(row.node_count, "folder node count"),
  };
}

function pageSize(value?: number): number {
  return Math.min(100, Math.max(1, Math.floor(value ?? 30)));
}

export function createKnowledgeFolderService(queryable: KnowledgeQueryable) {
  async function assertParent(userId: string, parentId: string | null, movingFolderId?: string): Promise<void> {
    if (!parentId) return;
    assertUuid(parentId, "父目录");
    const result = await queryable.query<{ id: string; depth: number | string; includes_moving: boolean }>(
      `WITH RECURSIVE ancestors AS (
         SELECT id, parent_id, 1 AS depth, id = $3::uuid AS includes_moving
         FROM knowledge_folders WHERE user_id = $1 AND id = $2
         UNION ALL
         SELECT parent.id, parent.parent_id, ancestors.depth + 1,
                ancestors.includes_moving OR parent.id = $3::uuid
         FROM knowledge_folders parent
         JOIN ancestors ON ancestors.parent_id = parent.id
         WHERE parent.user_id = $1 AND ancestors.depth < $4
       )
       SELECT id, depth, includes_moving FROM ancestors ORDER BY depth DESC LIMIT 1`,
      [userId, parentId, movingFolderId ?? null, MAX_FOLDER_DEPTH + 1],
    );
    const row = result.rows[0];
    if (!row) throw new KnowledgeFolderError("not_found", "父目录不存在");
    if (row.includes_moving) throw new KnowledgeFolderError("invalid", "目录不能移动到自身的子目录");
    if (safeInteger(row.depth, "folder depth") >= MAX_FOLDER_DEPTH) {
      throw new KnowledgeFolderError("invalid", `目录最多支持 ${MAX_FOLDER_DEPTH} 层`);
    }
  }

  async function listNodeFolders(userId: string, nodeIds: string[]) {
    if (nodeIds.length === 0) return new Map<string, Array<{ id: string; name: string }>>();
    const result = await queryable.query<{ node_id: string; id: string; name: string }>(
      `SELECT membership.node_id, folder.id, folder.name
       FROM knowledge_folder_nodes membership
       JOIN knowledge_folders folder
         ON folder.user_id = membership.user_id AND folder.id = membership.folder_id
       WHERE membership.user_id = $1 AND membership.node_id = ANY($2::uuid[])
       ORDER BY folder.name ASC, folder.id ASC`,
      [userId, nodeIds],
    );
    const folders = new Map<string, Array<{ id: string; name: string }>>();
    for (const row of result.rows) {
      const list = folders.get(row.node_id) ?? [];
      if (list.length < 3) list.push({ id: row.id, name: row.name });
      folders.set(row.node_id, list);
    }
    return folders;
  }

  async function enrich(userId: string, rows: KnowledgeNodeRow[]): Promise<ExplorerNode[]> {
    const nodes = rows.map(mapKnowledgeNodeRow);
    const [previews, folders] = await Promise.all([
      loadKnowledgePreviews(queryable, userId, nodes),
      listNodeFolders(userId, nodes.map((node) => node.id)),
    ]);
    return nodes.map((node) => ({
      node,
      preview: previews.get(node.id) ?? { kind: "concept", thumbnailUrls: [], mediaCount: 0 },
      folders: folders.get(node.id) ?? [],
    }));
  }

  async function listNodes(input: {
    userId: string;
    folderId?: string | null;
    unfiled?: boolean;
    query?: string;
    entityType?: KnowledgeEntityType;
    contentType?: string;
    cursor?: string | null;
    pageSize?: number;
  }) {
    if (input.folderId) assertUuid(input.folderId, "目录");
    const limit = pageSize(input.pageSize);
    const cursor = input.cursor ? decodeKnowledgeCursor<NodeCursor>(input.cursor) : null;
    const query = input.query?.trim().slice(0, 200) ?? "";
    const values: unknown[] = [input.userId, input.folderId ?? null, query, `%${query.replace(/[\\%_]/gu, "\\$&")}%`, input.entityType ?? null, input.contentType ?? null, cursor?.updatedAt ?? null, cursor?.id ?? null, limit + 1];
    const membershipSql = input.unfiled
      ? `NOT EXISTS (
           SELECT 1 FROM knowledge_folder_nodes membership
           WHERE membership.user_id = n.user_id AND membership.node_id = n.id
         )`
      : `$2::uuid IS NULL OR EXISTS (
           SELECT 1 FROM knowledge_folder_nodes membership
           WHERE membership.user_id = n.user_id AND membership.folder_id = $2 AND membership.node_id = n.id
         )`;
    const result = await queryable.query<KnowledgeNodeRow>(
      `SELECT ${NODE_COLUMNS.replaceAll("\n", " ")}
       FROM knowledge_nodes n
       WHERE n.user_id = $1 AND n.is_active = TRUE AND n.deleted_at IS NULL
         AND (${membershipSql})
         AND ($3::text = '' OR n.search_text ILIKE $4 ESCAPE '\\')
         AND ($5::text IS NULL OR n.entity_type = $5)
         AND ($6::text IS NULL OR n.properties->>'contentType' = $6)
         AND ($7::bigint IS NULL OR n.updated_at < $7 OR (n.updated_at = $7 AND n.id > $8::uuid))
       ORDER BY n.updated_at DESC, n.id ASC
       LIMIT $9`,
      values,
    );
    const selected = result.rows.slice(0, limit);
    const last = selected.at(-1);
    return {
      nodes: await enrich(input.userId, selected),
      nextCursor: result.rows.length > limit && last
        ? encodeKnowledgeCursor({ updatedAt: safeInteger(last.updated_at, "node updated at"), id: last.id })
        : null,
    };
  }

  return {
    async listChildren(input: { userId: string; parentId?: string | null; cursor?: string | null; pageSize?: number }) {
      if (input.parentId) assertUuid(input.parentId, "父目录");
      const limit = pageSize(input.pageSize);
      const cursor = input.cursor ? decodeKnowledgeCursor<FolderCursor>(input.cursor) : null;
      const result = await queryable.query<FolderRow>(
        `SELECT folder.id, folder.parent_id, folder.name, folder.source_type, folder.source_entity_id,
                folder.sort_order, folder.created_at, folder.updated_at,
                EXISTS (SELECT 1 FROM knowledge_folders child WHERE child.user_id = $1 AND child.parent_id = folder.id) AS has_children,
                (SELECT count(*)::int FROM knowledge_folder_nodes membership WHERE membership.user_id = $1 AND membership.folder_id = folder.id) AS node_count
         FROM knowledge_folders folder
         WHERE folder.user_id = $1 AND folder.parent_id IS NOT DISTINCT FROM $2::uuid
           AND ($3::bigint IS NULL OR folder.sort_order > $3 OR (folder.sort_order = $3 AND folder.id > $4::uuid))
         ORDER BY folder.sort_order ASC, folder.id ASC
         LIMIT $5`,
        [input.userId, input.parentId ?? null, cursor?.sortOrder ?? null, cursor?.id ?? null, limit + 1],
      );
      const selected = result.rows.slice(0, limit);
      const last = selected.at(-1);
      return {
        folders: selected.map(mapFolder),
        nextCursor: result.rows.length > limit && last
          ? encodeKnowledgeCursor({ sortOrder: safeInteger(last.sort_order, "folder sort order"), id: last.id })
          : null,
      };
    },

    async createFolder(input: { userId: string; parentId?: string | null; name: string; now?: number }) {
      await assertParent(input.userId, input.parentId ?? null);
      const now = input.now ?? Date.now();
      try {
        const result = await queryable.query<FolderRow>(
          `INSERT INTO knowledge_folders (user_id, parent_id, name, source_type, source_entity_id, sort_order, created_at, updated_at)
           VALUES ($1, $2, $3, 'manual', NULL, $4, $4, $4)
           RETURNING id, parent_id, name, source_type, source_entity_id, sort_order, created_at, updated_at, FALSE AS has_children, 0 AS node_count`,
          [input.userId, input.parentId ?? null, cleanName(input.name), now],
        );
        return mapFolder(result.rows[0]!);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new KnowledgeFolderError("conflict", "同级目录名称已存在");
        throw error;
      }
    },

    async updateFolder(input: { userId: string; folderId: string; parentId?: string | null; name: string; now?: number }) {
      assertUuid(input.folderId, "目录");
      if (input.parentId === input.folderId) throw new KnowledgeFolderError("invalid", "目录不能移动到自身");
      await assertParent(input.userId, input.parentId ?? null, input.folderId);
      try {
        const result = await queryable.query<FolderRow>(
          `UPDATE knowledge_folders SET parent_id = $3, name = $4, updated_at = $5
           WHERE user_id = $1 AND id = $2 AND source_type = 'manual'
           RETURNING id, parent_id, name, source_type, source_entity_id, sort_order, created_at, updated_at,
             EXISTS (SELECT 1 FROM knowledge_folders child WHERE child.user_id = $1 AND child.parent_id = knowledge_folders.id) AS has_children,
             (SELECT count(*)::int FROM knowledge_folder_nodes membership WHERE membership.user_id = $1 AND membership.folder_id = knowledge_folders.id) AS node_count`,
          [input.userId, input.folderId, input.parentId ?? null, cleanName(input.name), input.now ?? Date.now()],
        );
        return result.rows[0] ? mapFolder(result.rows[0]) : null;
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new KnowledgeFolderError("conflict", "同级目录名称已存在");
        throw error;
      }
    },

    async deleteFolder(userId: string, folderId: string) {
      assertUuid(folderId, "目录");
      const result = await queryable.query<{ id: string }>(
        `DELETE FROM knowledge_folders WHERE user_id = $1 AND id = $2 AND source_type = 'manual' RETURNING id`,
        [userId, folderId],
      );
      return Boolean(result.rows[0]);
    },

    listFolderNodes(input: Parameters<typeof listNodes>[0]) {
      return listNodes(input);
    },

    listUnfiledNodes(input: Omit<Parameters<typeof listNodes>[0], "unfiled" | "folderId">) {
      return listNodes({ ...input, unfiled: true });
    },

    async addNode(userId: string, folderId: string, nodeId: string, now = Date.now()) {
      assertUuid(folderId, "目录");
      assertUuid(nodeId, "知识节点");
      const result = await queryable.query<{ node_id: string }>(
        `INSERT INTO knowledge_folder_nodes (user_id, folder_id, node_id, sort_order, added_at)
         SELECT $1, folder.id, node.id, $4, $4
         FROM knowledge_folders folder
         JOIN knowledge_nodes node ON node.user_id = $1 AND node.id = $3 AND node.is_active = TRUE AND node.deleted_at IS NULL
         WHERE folder.user_id = $1 AND folder.id = $2
         ON CONFLICT (user_id, folder_id, node_id) DO UPDATE SET sort_order = EXCLUDED.sort_order
         RETURNING node_id`,
        [userId, folderId, nodeId, now],
      );
      return Boolean(result.rows[0]);
    },

    async removeNode(userId: string, folderId: string, nodeId: string) {
      assertUuid(folderId, "目录");
      assertUuid(nodeId, "知识节点");
      const result = await queryable.query<{ node_id: string }>(
        `DELETE FROM knowledge_folder_nodes WHERE user_id = $1 AND folder_id = $2 AND node_id = $3 RETURNING node_id`,
        [userId, folderId, nodeId],
      );
      return Boolean(result.rows[0]);
    },
  };
}
