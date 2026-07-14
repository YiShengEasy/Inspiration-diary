import type {
  KnowledgeEntityType,
  KnowledgeLinkOrigin,
  KnowledgeProperties,
  KnowledgeRelationType,
} from "./types.ts";
import type { CandidateNode } from "./candidates.ts";

export interface KnowledgeQueryResult<Row> {
  rows: Row[];
  rowCount?: number | null;
}

/** Structural subset shared by pg.Pool and pg.PoolClient. */
export interface KnowledgeQueryable {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<KnowledgeQueryResult<Row>>;
}

export interface KnowledgeNode {
  id: string;
  userId: string;
  entityType: KnowledgeEntityType;
  entityId: string | null;
  slug: string;
  title: string;
  tags: string[];
  properties: KnowledgeProperties;
  searchText: string;
  isActive: boolean;
  autoAdded: boolean;
  contentFingerprint: string;
  revision: number;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeLink {
  id: string;
  userId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: KnowledgeRelationType;
  origin: KnowledgeLinkOrigin;
  context: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeSuggestionFeedback {
  id: string;
  userId: string;
  lowerNodeId: string;
  higherNodeId: string;
  action: "dismissed" | "accepted";
  lowerFingerprint: string;
  higherFingerprint: string;
  createdAt: number;
}

export interface KnowledgeNodeRow {
  id: string;
  user_id: string;
  entity_type: KnowledgeEntityType;
  entity_id: string | null;
  slug: string;
  title: string;
  tags: string[];
  properties: KnowledgeProperties;
  search_text: string;
  is_active: boolean;
  auto_added: boolean;
  content_fingerprint: string;
  revision: number | string;
  deleted_at: number | string | null;
  created_at: number | string;
  updated_at: number | string;
}

interface KnowledgeLinkRow {
  id: string;
  user_id: string;
  source_node_id: string;
  target_node_id: string;
  relation_type: KnowledgeRelationType;
  origin: KnowledgeLinkOrigin;
  context: string | null;
  created_at: number | string;
  updated_at: number | string;
}

interface KnowledgeFeedbackRow {
  id: string;
  user_id: string;
  lower_node_id: string;
  higher_node_id: string;
  action: "dismissed" | "accepted";
  lower_fingerprint: string;
  higher_fingerprint: string;
  created_at: number | string;
}

interface KnowledgeCandidateNodeRow {
  id: string;
  tags: string[];
  properties: KnowledgeProperties;
  created_at: number | string;
  content_fingerprint: string;
  is_active: boolean;
  book_ids: string[] | null;
}

interface KnowledgeBacklinkRow extends KnowledgeLinkRow {
  node_id: string;
  node_user_id: string;
  node_entity_type: KnowledgeEntityType;
  node_entity_id: string | null;
  node_slug: string;
  node_title: string;
  node_tags: string[];
  node_properties: KnowledgeProperties;
  node_search_text: string;
  node_is_active: boolean;
  node_auto_added: boolean;
  node_content_fingerprint: string;
  node_revision: number | string;
  node_deleted_at: number | string | null;
  node_created_at: number | string;
  node_updated_at: number | string;
}

export const NODE_COLUMNS = `
  id, user_id, entity_type, entity_id, slug, title, tags, properties,
  search_text, is_active, auto_added, content_fingerprint, revision,
  deleted_at, created_at, updated_at
`;

const LINK_COLUMNS = `
  id, user_id, source_node_id, target_node_id, relation_type, origin,
  context, created_at, updated_at
`;

const FEEDBACK_COLUMNS = `
  id, user_id, lower_node_id, higher_node_id, action,
  lower_fingerprint, higher_fingerprint, created_at
`;

function safeInteger(value: number | string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Invalid knowledge ${field}`);
  return parsed;
}

function nullableSafeInteger(value: number | string | null, field: string): number | null {
  return value === null ? null : safeInteger(value, field);
}

export function mapKnowledgeNodeRow(row: KnowledgeNodeRow): KnowledgeNode {
  return {
    id: row.id,
    userId: row.user_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    slug: row.slug,
    title: row.title,
    tags: row.tags,
    properties: row.properties,
    searchText: row.search_text,
    isActive: row.is_active,
    autoAdded: row.auto_added,
    contentFingerprint: row.content_fingerprint,
    revision: safeInteger(row.revision, "knowledge_nodes.revision"),
    deletedAt: nullableSafeInteger(row.deleted_at, "knowledge_nodes.deleted_at"),
    createdAt: safeInteger(row.created_at, "knowledge_nodes.created_at"),
    updatedAt: safeInteger(row.updated_at, "knowledge_nodes.updated_at"),
  };
}

function mapLink(row: KnowledgeLinkRow): KnowledgeLink {
  return {
    id: row.id,
    userId: row.user_id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    relationType: row.relation_type,
    origin: row.origin,
    context: row.context,
    createdAt: safeInteger(row.created_at, "knowledge_links.created_at"),
    updatedAt: safeInteger(row.updated_at, "knowledge_links.updated_at"),
  };
}

function mapFeedback(row: KnowledgeFeedbackRow): KnowledgeSuggestionFeedback {
  return {
    id: row.id,
    userId: row.user_id,
    lowerNodeId: row.lower_node_id,
    higherNodeId: row.higher_node_id,
    action: row.action,
    lowerFingerprint: row.lower_fingerprint,
    higherFingerprint: row.higher_fingerprint,
    createdAt: safeInteger(row.created_at, "knowledge_suggestion_feedback.created_at"),
  };
}

export interface PutEntityNodeInput {
  userId: string;
  entityType: KnowledgeEntityType;
  entityId: string;
  slug: string;
  title: string;
  tags: string[];
  properties: KnowledgeProperties;
  searchText: string;
  contentFingerprint: string;
  autoAdded: boolean;
  now: number;
}

export interface CreateConceptNodeInput {
  userId: string;
  slug: string;
  title: string;
  tags?: string[];
  properties?: KnowledgeProperties;
  searchText?: string;
  contentFingerprint: string;
  now: number;
}

export interface UpdateKnowledgeNodeInput {
  userId: string;
  nodeId: string;
  expectedRevision: number;
  title: string;
  tags: string[];
  properties: KnowledgeProperties;
  searchText: string;
  contentFingerprint: string;
  now: number;
}

export type OptimisticNodeUpdateResult =
  | { status: "updated"; node: KnowledgeNode }
  | { status: "conflict"; node: KnowledgeNode }
  | { status: "not_found" };

export interface ListKnowledgeNodesInput {
  userId: string;
  query?: string;
  entityType?: KnowledgeEntityType;
  page?: number;
  pageSize?: number;
  activeOnly?: boolean;
}

export interface KnowledgeNodePage {
  nodes: KnowledgeNode[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PutKnowledgeLinkInput {
  userId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: KnowledgeRelationType;
  origin: KnowledgeLinkOrigin;
  context?: string | null;
  now: number;
}

export interface WikilinkTarget {
  targetNodeId: string;
  context?: string | null;
}

export interface PutSuggestionFeedbackInput {
  userId: string;
  lowerNodeId: string;
  higherNodeId: string;
  action: "dismissed" | "accepted";
  lowerFingerprint: string;
  higherFingerprint: string;
  now: number;
}

export interface KnowledgeRepository {
  getNodeById(userId: string, nodeId: string, activeOnly?: boolean): Promise<KnowledgeNode | null>;
  getNodeByEntity(userId: string, entityType: KnowledgeEntityType, entityId: string, activeOnly?: boolean): Promise<KnowledgeNode | null>;
  getActiveNodeBySlug(userId: string, slug: string): Promise<KnowledgeNode | null>;
  getActiveNodeByTitle(userId: string, normalizedTitle: string): Promise<KnowledgeNode | null>;
  getActiveConceptByTitle(userId: string, normalizedTitle: string): Promise<KnowledgeNode | null>;
  listNodes(input: ListKnowledgeNodesInput): Promise<KnowledgeNodePage>;
  putEntityNode(input: PutEntityNodeInput): Promise<KnowledgeNode>;
  claimConceptNode(input: PutEntityNodeInput & { conceptNodeId: string }): Promise<KnowledgeNode | null>;
  createConceptNode(input: CreateConceptNodeInput): Promise<KnowledgeNode>;
  updateNodeOptimistically(input: UpdateKnowledgeNodeInput): Promise<OptimisticNodeUpdateResult>;
  setNodeActive(userId: string, nodeId: string, active: boolean, now: number): Promise<KnowledgeNode | null>;
  softDeleteNode(userId: string, nodeId: string, now: number): Promise<KnowledgeNode | null>;
  listLinksForNode(userId: string, nodeId: string): Promise<KnowledgeLink[]>;
  listLinksTouchingNodes(userId: string, nodeIds: string[]): Promise<KnowledgeLink[]>;
  listBacklinks(userId: string, targetNodeId: string): Promise<Array<{ link: KnowledgeLink; source: KnowledgeNode }>>;
  listLinkedNodeIds(userId: string, nodeId: string): Promise<string[]>;
  listActiveNodesByIds(userId: string, nodeIds: string[]): Promise<KnowledgeNode[]>;
  listCandidateNodes(userId: string): Promise<CandidateNode[]>;
  putLink(input: PutKnowledgeLinkInput): Promise<KnowledgeLink | null>;
  deleteLink(userId: string, linkId: string): Promise<boolean>;
  replaceWikilinkLinks(userId: string, sourceNodeId: string, targets: WikilinkTarget[], now: number): Promise<KnowledgeLink[]>;
  listFeedbackForNode(userId: string, nodeId: string): Promise<KnowledgeSuggestionFeedback[]>;
  putSuggestionFeedback(input: PutSuggestionFeedbackInput): Promise<KnowledgeSuggestionFeedback | null>;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, "\\$&");
}

export function createKnowledgeRepository(client: KnowledgeQueryable): KnowledgeRepository {
  async function getNodeById(userId: string, nodeId: string, activeOnly = false): Promise<KnowledgeNode | null> {
    const result = await client.query<KnowledgeNodeRow>(
      `SELECT ${NODE_COLUMNS}
       FROM knowledge_nodes
       WHERE user_id = $1 AND id = $2
         AND ($3::boolean = FALSE OR (is_active = TRUE AND deleted_at IS NULL))`,
      [userId, nodeId, activeOnly],
    );
    return result.rows[0] ? mapKnowledgeNodeRow(result.rows[0]) : null;
  }

  async function putLink(input: PutKnowledgeLinkInput): Promise<KnowledgeLink | null> {
    const result = await client.query<KnowledgeLinkRow>(
      `INSERT INTO knowledge_links (
         user_id, source_node_id, target_node_id, relation_type,
         origin, context, created_at, updated_at
       )
       SELECT $1, source.id, target.id, $4, $5, $6, $7, $7
       FROM knowledge_nodes source
       JOIN knowledge_nodes target ON target.id = $3 AND target.user_id = $1
       WHERE source.id = $2 AND source.user_id = $1
         AND source.is_active = TRUE AND source.deleted_at IS NULL
         AND target.is_active = TRUE AND target.deleted_at IS NULL
         AND source.id <> target.id
       ON CONFLICT (user_id, source_node_id, target_node_id, relation_type, origin)
       DO UPDATE SET context = EXCLUDED.context, updated_at = EXCLUDED.updated_at
       RETURNING ${LINK_COLUMNS}`,
      [
        input.userId, input.sourceNodeId, input.targetNodeId,
        input.relationType, input.origin, input.context ?? null, input.now,
      ],
    );
    return result.rows[0] ? mapLink(result.rows[0]) : null;
  }

  return {
    getNodeById,

    async getNodeByEntity(userId, entityType, entityId, activeOnly = false) {
      const result = await client.query<KnowledgeNodeRow>(
        `SELECT ${NODE_COLUMNS}
         FROM knowledge_nodes
         WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3
           AND ($4::boolean = FALSE OR (is_active = TRUE AND deleted_at IS NULL))`,
        [userId, entityType, entityId, activeOnly],
      );
      return result.rows[0] ? mapKnowledgeNodeRow(result.rows[0]) : null;
    },

    async getActiveNodeBySlug(userId, slug) {
      const result = await client.query<KnowledgeNodeRow>(
        `SELECT ${NODE_COLUMNS}
         FROM knowledge_nodes
         WHERE user_id = $1 AND slug = $2 AND is_active = TRUE AND deleted_at IS NULL`,
        [userId, slug],
      );
      return result.rows[0] ? mapKnowledgeNodeRow(result.rows[0]) : null;
    },

    async getActiveNodeByTitle(userId, normalizedTitle) {
      const result = await client.query<KnowledgeNodeRow>(
        `SELECT ${NODE_COLUMNS}
         FROM knowledge_nodes
         WHERE user_id = $1
           AND lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) = $2
           AND is_active = TRUE AND deleted_at IS NULL
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
        [userId, normalizedTitle],
      );
      return result.rows[0] ? mapKnowledgeNodeRow(result.rows[0]) : null;
    },

    async getActiveConceptByTitle(userId, normalizedTitle) {
      const result = await client.query<KnowledgeNodeRow>(
        `SELECT ${NODE_COLUMNS}
         FROM knowledge_nodes
         WHERE user_id = $1 AND entity_type = 'concept' AND entity_id IS NULL
           AND lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) = $2
           AND is_active = TRUE AND deleted_at IS NULL
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
        [userId, normalizedTitle],
      );
      return result.rows[0] ? mapKnowledgeNodeRow(result.rows[0]) : null;
    },

    async listNodes(input) {
      const page = Math.max(1, Math.floor(input.page ?? 1));
      const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 20)));
      const query = input.query?.trim() ?? "";
      const pattern = `%${escapeLike(query)}%`;
      const result = await client.query<KnowledgeNodeRow & { total_count: number | string }>(
        `SELECT ${NODE_COLUMNS}, count(*) OVER() AS total_count
         FROM knowledge_nodes
         WHERE user_id = $1
           AND ($2::text IS NULL OR entity_type = $2)
           AND ($3::boolean = FALSE OR (is_active = TRUE AND deleted_at IS NULL))
           AND (
             $4::text = '' OR slug = $4
             OR lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) = lower($4)
             OR search_text ILIKE $5 ESCAPE '\\'
           )
         ORDER BY
           CASE WHEN slug = $4 THEN 0
                WHEN lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) = lower($4) THEN 1
                ELSE 2 END,
           CASE WHEN $4::text = '' THEN 0 ELSE similarity(search_text, $4) END DESC,
           updated_at DESC, id ASC
         LIMIT $6 OFFSET $7`,
        [
          input.userId,
          input.entityType ?? null,
          input.activeOnly ?? true,
          query,
          pattern,
          pageSize,
          (page - 1) * pageSize,
        ],
      );
      return {
        nodes: result.rows.map(mapKnowledgeNodeRow),
        total: result.rows[0] ? safeInteger(result.rows[0].total_count, "node count") : 0,
        page,
        pageSize,
      };
    },

    async putEntityNode(input) {
      const result = await client.query<KnowledgeNodeRow>(
        `INSERT INTO knowledge_nodes (
           user_id, entity_type, entity_id, slug, title, tags, properties,
           search_text, is_active, auto_added, content_fingerprint,
           revision, deleted_at, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9, $10, 1, NULL, $11, $11)
         ON CONFLICT (user_id, entity_type, entity_id) WHERE entity_id IS NOT NULL
         DO UPDATE SET
           title = EXCLUDED.title,
           tags = EXCLUDED.tags,
           properties = EXCLUDED.properties,
           search_text = EXCLUDED.search_text,
           content_fingerprint = EXCLUDED.content_fingerprint,
           revision = knowledge_nodes.revision + 1,
           updated_at = EXCLUDED.updated_at
         RETURNING ${NODE_COLUMNS}`,
        [
          input.userId, input.entityType, input.entityId, input.slug, input.title,
          input.tags, input.properties, input.searchText, input.autoAdded,
          input.contentFingerprint, input.now,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("PostgreSQL did not return the knowledge node");
      return mapKnowledgeNodeRow(row);
    },

    async claimConceptNode(input) {
      const result = await client.query<KnowledgeNodeRow>(
        `UPDATE knowledge_nodes
         SET entity_type = $3, entity_id = $4, title = $5, tags = $6,
             properties = $7, search_text = $8, auto_added = $9,
             content_fingerprint = $10, revision = revision + 1,
             deleted_at = NULL, is_active = TRUE, updated_at = $11
         WHERE user_id = $1 AND id = $2
           AND entity_type = 'concept' AND entity_id IS NULL
           AND is_active = TRUE AND deleted_at IS NULL
         RETURNING ${NODE_COLUMNS}`,
        [
          input.userId, input.conceptNodeId, input.entityType, input.entityId,
          input.title, input.tags, input.properties, input.searchText,
          input.autoAdded, input.contentFingerprint, input.now,
        ],
      );
      return result.rows[0] ? mapKnowledgeNodeRow(result.rows[0]) : null;
    },

    async createConceptNode(input) {
      const result = await client.query<KnowledgeNodeRow>(
        `INSERT INTO knowledge_nodes (
           user_id, entity_type, entity_id, slug, title, tags, properties,
           search_text, is_active, auto_added, content_fingerprint,
           revision, deleted_at, created_at, updated_at
         ) VALUES ($1, 'concept', NULL, $2, $3, $4, $5, $6, TRUE, FALSE, $7, 1, NULL, $8, $8)
         ON CONFLICT (user_id, slug)
         DO UPDATE SET
           is_active = TRUE,
           deleted_at = NULL,
           updated_at = EXCLUDED.updated_at
         RETURNING ${NODE_COLUMNS}`,
        [
          input.userId, input.slug, input.title, input.tags ?? [],
          input.properties ?? {}, input.searchText ?? input.title,
          input.contentFingerprint, input.now,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("PostgreSQL did not return the concept node");
      return mapKnowledgeNodeRow(row);
    },

    async updateNodeOptimistically(input) {
      const updated = await client.query<KnowledgeNodeRow>(
        `UPDATE knowledge_nodes
         SET title = $3, tags = $4, properties = $5, search_text = $6,
             content_fingerprint = $7, revision = revision + 1, updated_at = $8
         WHERE user_id = $1 AND id = $2 AND revision = $9
           AND is_active = TRUE AND deleted_at IS NULL
         RETURNING ${NODE_COLUMNS}`,
        [
          input.userId, input.nodeId, input.title, input.tags, input.properties,
          input.searchText, input.contentFingerprint, input.now, input.expectedRevision,
        ],
      );
      if (updated.rows[0]) return { status: "updated", node: mapKnowledgeNodeRow(updated.rows[0]) };
      const current = await getNodeById(input.userId, input.nodeId, true);
      return current ? { status: "conflict", node: current } : { status: "not_found" };
    },

    async setNodeActive(userId, nodeId, active, now) {
      const result = await client.query<KnowledgeNodeRow>(
        `UPDATE knowledge_nodes
         SET is_active = $3,
             deleted_at = CASE WHEN $3 THEN NULL ELSE deleted_at END,
             revision = revision + 1,
             updated_at = $4
         WHERE user_id = $1 AND id = $2
         RETURNING ${NODE_COLUMNS}`,
        [userId, nodeId, active, now],
      );
      return result.rows[0] ? mapKnowledgeNodeRow(result.rows[0]) : null;
    },

    async softDeleteNode(userId, nodeId, now) {
      const result = await client.query<KnowledgeNodeRow>(
        `UPDATE knowledge_nodes
         SET is_active = FALSE, deleted_at = $3,
             revision = revision + 1, updated_at = $3
         WHERE user_id = $1 AND id = $2
         RETURNING ${NODE_COLUMNS}`,
        [userId, nodeId, now],
      );
      return result.rows[0] ? mapKnowledgeNodeRow(result.rows[0]) : null;
    },

    async listLinksForNode(userId, nodeId) {
      const result = await client.query<KnowledgeLinkRow>(
        `SELECT l.id, l.user_id, l.source_node_id, l.target_node_id,
                l.relation_type, l.origin, l.context, l.created_at, l.updated_at
         FROM knowledge_links l
         JOIN knowledge_nodes source ON source.id = l.source_node_id AND source.user_id = $1
         JOIN knowledge_nodes target ON target.id = l.target_node_id AND target.user_id = $1
         WHERE l.user_id = $1 AND (l.source_node_id = $2 OR l.target_node_id = $2)
           AND source.is_active = TRUE AND source.deleted_at IS NULL
           AND target.is_active = TRUE AND target.deleted_at IS NULL
         ORDER BY l.updated_at DESC, l.id ASC`,
        [userId, nodeId],
      );
      return result.rows.map(mapLink);
    },

    async listLinksTouchingNodes(userId, nodeIds) {
      if (nodeIds.length === 0) return [];
      const result = await client.query<KnowledgeLinkRow>(
        `SELECT l.id, l.user_id, l.source_node_id, l.target_node_id,
                l.relation_type, l.origin, l.context, l.created_at, l.updated_at
         FROM knowledge_links l
         JOIN knowledge_nodes source ON source.id = l.source_node_id AND source.user_id = $1
         JOIN knowledge_nodes target ON target.id = l.target_node_id AND target.user_id = $1
         WHERE l.user_id = $1
           AND (l.source_node_id = ANY($2::uuid[]) OR l.target_node_id = ANY($2::uuid[]))
           AND source.is_active = TRUE AND source.deleted_at IS NULL
           AND target.is_active = TRUE AND target.deleted_at IS NULL
         ORDER BY l.updated_at DESC, l.id ASC`,
        [userId, nodeIds],
      );
      return result.rows.map(mapLink);
    },

    async listBacklinks(userId, targetNodeId) {
      const result = await client.query<KnowledgeBacklinkRow>(
        `SELECT
           l.id, l.user_id, l.source_node_id, l.target_node_id, l.relation_type,
           l.origin, l.context, l.created_at, l.updated_at,
           source.id AS node_id, source.user_id AS node_user_id,
           source.entity_type AS node_entity_type, source.entity_id AS node_entity_id,
           source.slug AS node_slug, source.title AS node_title, source.tags AS node_tags,
           source.properties AS node_properties, source.search_text AS node_search_text,
           source.is_active AS node_is_active, source.auto_added AS node_auto_added,
           source.content_fingerprint AS node_content_fingerprint,
           source.revision AS node_revision, source.deleted_at AS node_deleted_at,
           source.created_at AS node_created_at, source.updated_at AS node_updated_at
         FROM knowledge_links l
         JOIN knowledge_nodes source ON source.id = l.source_node_id AND source.user_id = $1
         JOIN knowledge_nodes target ON target.id = l.target_node_id AND target.user_id = $1
         WHERE l.user_id = $1 AND l.target_node_id = $2
           AND source.is_active = TRUE AND source.deleted_at IS NULL
           AND target.is_active = TRUE AND target.deleted_at IS NULL
         ORDER BY l.updated_at DESC, l.id ASC`,
        [userId, targetNodeId],
      );
      return result.rows.map((row) => ({
        link: mapLink(row),
        source: mapKnowledgeNodeRow({
          id: row.node_id,
          user_id: row.node_user_id,
          entity_type: row.node_entity_type,
          entity_id: row.node_entity_id,
          slug: row.node_slug,
          title: row.node_title,
          tags: row.node_tags,
          properties: row.node_properties,
          search_text: row.node_search_text,
          is_active: row.node_is_active,
          auto_added: row.node_auto_added,
          content_fingerprint: row.node_content_fingerprint,
          revision: row.node_revision,
          deleted_at: row.node_deleted_at,
          created_at: row.node_created_at,
          updated_at: row.node_updated_at,
        }),
      }));
    },

    async listLinkedNodeIds(userId, nodeId) {
      const result = await client.query<{ linked_node_id: string }>(
        `SELECT DISTINCT CASE
           WHEN source_node_id = $2 THEN target_node_id ELSE source_node_id
         END AS linked_node_id
         FROM knowledge_links
         WHERE user_id = $1 AND (source_node_id = $2 OR target_node_id = $2)`,
        [userId, nodeId],
      );
      return result.rows.map((row) => row.linked_node_id);
    },

    async listActiveNodesByIds(userId, nodeIds) {
      if (nodeIds.length === 0) return [];
      const result = await client.query<KnowledgeNodeRow>(
        `SELECT ${NODE_COLUMNS}
         FROM knowledge_nodes
         WHERE user_id = $1 AND id = ANY($2::uuid[])
           AND is_active = TRUE AND deleted_at IS NULL
         ORDER BY updated_at DESC, id ASC`,
        [userId, nodeIds],
      );
      return result.rows.map(mapKnowledgeNodeRow);
    },

    async listCandidateNodes(userId) {
      const result = await client.query<KnowledgeCandidateNodeRow>(
        `SELECT
           n.id, n.tags, n.properties, n.created_at, n.content_fingerprint,
           n.is_active,
           CASE
             WHEN n.entity_type = 'book' AND n.entity_id IS NOT NULL
               THEN ARRAY[n.entity_id]
             WHEN n.entity_type = 'card' AND n.entity_id IS NOT NULL
               THEN COALESCE((
                 SELECT array_agg(bc.book_id ORDER BY bc.book_id)
                 FROM inspiration_book_cards bc
                 WHERE bc.user_id = n.user_id AND bc.card_id = n.entity_id
               ), '{}')
             ELSE '{}'
           END AS book_ids
         FROM knowledge_nodes n
         WHERE n.user_id = $1 AND n.is_active = TRUE AND n.deleted_at IS NULL
         ORDER BY n.updated_at DESC, n.id ASC
         LIMIT 500`,
        [userId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        tags: row.tags,
        properties: row.properties,
        createdAt: safeInteger(row.created_at, "knowledge_nodes.created_at"),
        contentFingerprint: row.content_fingerprint,
        isActive: row.is_active,
        bookIds: row.book_ids ?? [],
      }));
    },

    putLink,

    async deleteLink(userId, linkId) {
      const result = await client.query<{ id: string }>(
        `DELETE FROM knowledge_links WHERE user_id = $1 AND id = $2 RETURNING id`,
        [userId, linkId],
      );
      return Boolean(result.rows[0]);
    },

    async replaceWikilinkLinks(userId, sourceNodeId, targets, now) {
      await client.query(
        `DELETE FROM knowledge_links
         WHERE user_id = $1 AND source_node_id = $2 AND origin = 'wikilink'`,
        [userId, sourceNodeId],
      );
      const links: KnowledgeLink[] = [];
      for (const target of targets) {
        const result = await putLink({
          userId,
          sourceNodeId,
          targetNodeId: target.targetNodeId,
          relationType: "mentions",
          origin: "wikilink",
          context: target.context ?? null,
          now,
        });
        if (result) links.push(result);
      }
      return links;
    },

    async listFeedbackForNode(userId, nodeId) {
      const result = await client.query<KnowledgeFeedbackRow>(
        `SELECT ${FEEDBACK_COLUMNS}
         FROM knowledge_suggestion_feedback
         WHERE user_id = $1 AND (lower_node_id = $2 OR higher_node_id = $2)
         ORDER BY created_at DESC, id ASC`,
        [userId, nodeId],
      );
      return result.rows.map(mapFeedback);
    },

    async putSuggestionFeedback(input) {
      const result = await client.query<KnowledgeFeedbackRow>(
        `INSERT INTO knowledge_suggestion_feedback (
           user_id, lower_node_id, higher_node_id, action,
           lower_fingerprint, higher_fingerprint, created_at
         )
         SELECT $1, lower_node.id, higher_node.id, $4, $5, $6, $7
         FROM knowledge_nodes lower_node
         JOIN knowledge_nodes higher_node ON higher_node.id = $3 AND higher_node.user_id = $1
         WHERE lower_node.id = $2 AND lower_node.user_id = $1
           AND lower_node.id::text < higher_node.id::text
           AND lower_node.is_active = TRUE AND lower_node.deleted_at IS NULL
           AND higher_node.is_active = TRUE AND higher_node.deleted_at IS NULL
         ON CONFLICT (
           user_id, lower_node_id, higher_node_id,
           lower_fingerprint, higher_fingerprint
         ) DO UPDATE SET action = EXCLUDED.action, created_at = EXCLUDED.created_at
         RETURNING ${FEEDBACK_COLUMNS}`,
        [
          input.userId, input.lowerNodeId, input.higherNodeId, input.action,
          input.lowerFingerprint, input.higherFingerprint, input.now,
        ],
      );
      return result.rows[0] ? mapFeedback(result.rows[0]) : null;
    },
  };
}
