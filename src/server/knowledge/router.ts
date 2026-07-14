import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Response } from "express";

import type { AuthenticatedRequest } from "../auth.ts";
import { KnowledgePropertyValidationError } from "./properties.ts";
import type { AiProviderDefaults } from "../analysis/shared.ts";
import {
  generateKnowledgeAiSuggestions,
  KnowledgeAiSuggestionError,
  type KnowledgeAiSuggestion,
  type KnowledgeAiSuggestionInput,
} from "./aiSuggestions.ts";
import type { KnowledgeQueryable } from "./repository.ts";
import {
  createKnowledgeService,
  type JoinableKnowledgeEntityType,
  type KnowledgeService,
} from "./service.ts";
import {
  serializeKnowledgeLink,
  serializeKnowledgeNodeDetail,
  serializeKnowledgeNodeSummary,
} from "./serializers.ts";
import type { KnowledgeEntityType } from "./types.ts";
import type { KnowledgeRelationType } from "./types.ts";

interface ReleasableKnowledgeQueryable extends KnowledgeQueryable {
  release?(): void;
}

interface ConnectableKnowledgeQueryable extends KnowledgeQueryable {
  connect?(): Promise<ReleasableKnowledgeQueryable>;
}

export interface KnowledgeRouterOptions {
  mode: boolean;
  /** Use pool for production. queryable is convenient for a PoolClient or test double. */
  pool?: ConnectableKnowledgeQueryable;
  queryable?: ConnectableKnowledgeQueryable;
  service?: KnowledgeService;
  serviceFactory?: (queryable: KnowledgeQueryable) => KnowledgeService;
  aiDefaults?: AiProviderDefaults;
  aiSuggestionGenerator?: (input: KnowledgeAiSuggestionInput) => Promise<KnowledgeAiSuggestion[]>;
}

const ENTITY_TYPES = new Set<KnowledgeEntityType>([
  "card",
  "book",
  "weekly_note",
  "concept",
]);
const JOINABLE_ENTITY_TYPES = new Set<JoinableKnowledgeEntityType>([
  "card",
  "book",
  "weekly_note",
]);
const RELATION_TYPES = new Set<KnowledgeRelationType>([
  "mentions",
  "related",
  "references",
  "derived_from",
  "belongs_to",
  "contrasts",
  "supports",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, maximum: number, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > maximum) return null;
  return text;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function parseEntityType(value: unknown): KnowledgeEntityType | null {
  return typeof value === "string" && ENTITY_TYPES.has(value as KnowledgeEntityType)
    ? value as KnowledgeEntityType
    : null;
}

function parseJoinableEntityType(value: unknown): JoinableKnowledgeEntityType | null {
  return typeof value === "string" && JOINABLE_ENTITY_TYPES.has(value as JoinableKnowledgeEntityType)
    ? value as JoinableKnowledgeEntityType
    : null;
}

function parseRelationType(value: unknown): KnowledgeRelationType | null {
  return typeof value === "string" && RELATION_TYPES.has(value as KnowledgeRelationType)
    ? value as KnowledgeRelationType
    : null;
}

function parseTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const tags = value.map((tag) => typeof tag === "string" ? tag.trim() : "");
  if (tags.some((tag) => !tag || tag.length > 100)) return null;
  return tags;
}

function isoWeek(now: Date): { weekId: string; dayIndex: number } {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return {
    weekId: `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`,
    dayIndex: day - 1,
  };
}

function publicError(res: Response, error: unknown): Response {
  if (error instanceof KnowledgePropertyValidationError) {
    return res.status(400).json({ error: error.message, code: error.code });
  }
  console.error("Knowledge route failed");
  return res.status(500).json({ error: "知识库服务异常" });
}

async function inTransaction<T>(
  database: ConnectableKnowledgeQueryable,
  factory: (queryable: KnowledgeQueryable) => KnowledgeService,
  operation: (queryable: KnowledgeQueryable, service: KnowledgeService) => Promise<T>,
): Promise<T> {
  if (!database.connect) return operation(database, factory(database));
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client, factory(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release?.();
  }
}

export function createKnowledgeRouter(options: KnowledgeRouterOptions): Router {
  const router = Router();
  const database = options.pool ?? options.queryable;
  const factory = options.serviceFactory ?? createKnowledgeService;
  const defaultService = options.service ?? (database ? factory(database) : null);
  const aiSuggestionGenerator = options.aiSuggestionGenerator ?? generateKnowledgeAiSuggestions;

  async function runMutation<T>(operation: (service: KnowledgeService) => Promise<T>): Promise<T> {
    if (!database) return operation(defaultService!);
    return inTransaction(database, factory, async (_queryable, service) => operation(service));
  }

  router.use((req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!options.mode) return res.status(404).json({ error: "接口不存在" });
    // Authentication is normally mounted before this router. Keep the boundary
    // defensive so a future mount-order change cannot create tenantless reads.
    if (!req.user) return res.status(401).json({ error: "未登录" });
    if (!defaultService) return res.status(503).json({ error: "知识库数据库未配置" });
    next();
  });

  router.get("/nodes", async (req: AuthenticatedRequest, res: Response) => {
    const rawType = typeof req.query.type === "string" ? req.query.type : "";
    const entityType = rawType ? parseEntityType(rawType) : undefined;
    if (rawType && !entityType) return res.status(400).json({ error: "知识类型无效" });
    try {
      const page = await defaultService!.listNodes({
        userId: req.user!.id,
        query: typeof req.query.q === "string" ? req.query.q.slice(0, 200) : undefined,
        entityType,
        page: boundedInteger(req.query.page, 1, 1, 1_000_000),
        pageSize: boundedInteger(req.query.pageSize, 20, 1, 100),
      });
      return res.json({
        ...page,
        nodes: page.nodes.map(serializeKnowledgeNodeSummary),
      });
    } catch (error) {
      return publicError(res, error);
    }
  });

  router.get("/nodes/:id", async (req: AuthenticatedRequest, res: Response) => {
    const nodeId = boundedText(req.params.id, 128);
    if (!nodeId) return res.status(400).json({ error: "节点参数无效" });
    try {
      const detail = await defaultService!.getNode(req.user!.id, nodeId);
      return detail
        ? res.json({ node: serializeKnowledgeNodeDetail(detail) })
        : res.status(404).json({ error: "知识节点不存在" });
    } catch (error) {
      return publicError(res, error);
    }
  });

  router.put("/nodes/:id", async (req: AuthenticatedRequest, res: Response) => {
    const nodeId = boundedText(req.params.id, 128);
    const body = record(req.body);
    const title = boundedText(body?.title, 255);
    const tags = parseTags(body?.tags);
    const revision = Number(body?.revision);
    const markdown = body?.markdown === null
      ? undefined
      : typeof body?.markdown === "string" && body.markdown.length <= 1_000_000
        ? body.markdown
        : null;
    if (
      !nodeId || !body || !title || !tags || !Number.isSafeInteger(revision) || revision < 1 ||
      body.properties === undefined || markdown === null
    ) {
      return res.status(400).json({ error: "节点参数无效" });
    }
    try {
      const outcome = await runMutation(async (service) => {
        const result = await service.updateNode({
          userId: req.user!.id,
          nodeId,
          expectedRevision: revision,
          title,
          tags,
          properties: body.properties,
          ...(markdown !== undefined ? { markdown } : {}),
        });
        const detail = result.status === "not_found"
          ? null
          : await service.getNode(req.user!.id, nodeId);
        return { result, detail };
      });
      if (outcome.result.status === "not_found") {
        return res.status(404).json({ error: "知识节点不存在" });
      }
      if (outcome.result.status === "conflict") {
        return res.status(409).json({
          error: "revision_conflict",
          serverRevision: outcome.result.node.revision,
          serverNode: outcome.detail
            ? serializeKnowledgeNodeDetail(outcome.detail)
            : { ...serializeKnowledgeNodeSummary(outcome.result.node), properties: outcome.result.node.properties, markdown: null },
        });
      }
      return res.json({
        node: outcome.detail
          ? serializeKnowledgeNodeDetail(outcome.detail)
          : { ...serializeKnowledgeNodeSummary(outcome.result.node), properties: outcome.result.node.properties, markdown: null },
      });
    } catch (error) {
      return publicError(res, error);
    }
  });

  router.get("/entities/:entityType/:entityId", async (req: AuthenticatedRequest, res: Response) => {
    const entityType = parseJoinableEntityType(req.params.entityType);
    const entityId = boundedText(req.params.entityId, 200);
    if (!entityType || !entityId) return res.status(400).json({ error: "实体参数无效" });
    try {
      const detail = await defaultService!.getEntityNode(req.user!.id, entityType, entityId);
      return res.json({ node: detail ? serializeKnowledgeNodeDetail(detail) : null });
    } catch (error) {
      return publicError(res, error);
    }
  });

  router.post("/entities/:entityType/:entityId/join", async (req: AuthenticatedRequest, res: Response) => {
    const entityType = parseJoinableEntityType(req.params.entityType);
    const entityId = boundedText(req.params.entityId, 200);
    if (!entityType || !entityId) return res.status(400).json({ error: "实体参数无效" });
    try {
      const outcome = await runMutation(async (service) => {
        const node = await service.joinEntity(req.user!.id, entityType, entityId);
        const detail = node ? await service.getNode(req.user!.id, node.id) : null;
        return { node, detail };
      });
      if (!outcome.node) return res.status(404).json({ error: "来源实体不存在" });
      return res.status(201).json({
        node: outcome.detail
          ? serializeKnowledgeNodeDetail(outcome.detail)
          : { ...serializeKnowledgeNodeSummary(outcome.node), properties: outcome.node.properties, markdown: null },
      });
    } catch (error) {
      return publicError(res, error);
    }
  });

  router.post("/nodes/:id/leave", async (req: AuthenticatedRequest, res: Response) => {
    const nodeId = boundedText(req.params.id, 128);
    if (!nodeId) return res.status(400).json({ error: "节点参数无效" });
    try {
      const node = await defaultService!.leaveNode(req.user!.id, nodeId);
      return node
        ? res.json({ node: { ...serializeKnowledgeNodeSummary(node), properties: node.properties, markdown: null } })
        : res.status(404).json({ error: "知识节点不存在" });
    } catch (error) {
      return publicError(res, error);
    }
  });

  router.get("/nodes/:id/backlinks", async (req: AuthenticatedRequest, res: Response) => {
    const nodeId = boundedText(req.params.id, 128);
    if (!nodeId) return res.status(400).json({ error: "节点参数无效" });
    try {
      const backlinks = await defaultService!.getBacklinks(req.user!.id, nodeId);
      return res.json({
        backlinks: backlinks.map(({ link, source }) => ({
          link: serializeKnowledgeLink(link),
          source: serializeKnowledgeNodeSummary(source),
        })),
      });
    } catch (error) {
      return publicError(res, error);
    }
  });

  router.post("/markdown", async (req: AuthenticatedRequest, res: Response) => {
    if (!database) return res.status(503).json({ error: "知识库数据库未配置" });
    const body = record(req.body);
    const title = boundedText(body?.title, 255);
    const markdown = typeof body?.markdown === "string" && body.markdown.length <= 1_000_000
      ? body.markdown
      : null;
    const tags = body?.tags === undefined ? [] : parseTags(body.tags);
    const properties = body?.properties === undefined ? {} : body.properties;
    const parsedProperties = record(properties);
    if (!body || !title || markdown === null || !tags || !parsedProperties) {
      return res.status(400).json({ error: "Markdown 参数无效" });
    }
    try {
      const detail = await inTransaction(database, factory, async (queryable, service) => {
        const id = `md_${randomUUID().replaceAll("-", "")}`;
        const now = Date.now();
        const calendar = isoWeek(new Date(now));
        await queryable.query(
          `INSERT INTO cards (
             id, user_id, week_id, day_index, image_url, thumbnail_url,
             photo_uid, photo_hash, terms, terms_text, deco_type, angle,
             created_at, type, md_content, md_summary, md_name, insight_note
           ) VALUES ($1, $2, $3, $4, '', '', NULL, NULL, $5, $6, 'none', 0, $7, 'md', $8, '', $9, '')`,
          [id, req.user!.id, calendar.weekId, calendar.dayIndex, tags, [title, ...tags, markdown].join(" "), now, markdown, title],
        );
        const node = await service.joinEntity(req.user!.id, "card", id, now);
        if (!node) throw new Error("Created Markdown card could not be projected");
        const updated = await service.updateNode({
          userId: req.user!.id,
          nodeId: node.id,
          expectedRevision: node.revision,
          title,
          tags,
          properties: { ...node.properties, ...parsedProperties },
          markdown,
          now,
        });
        if (updated.status !== "updated") throw new Error("Created Markdown node could not be initialized");
        const result = await service.getNode(req.user!.id, node.id);
        if (!result) throw new Error("Created Markdown node could not be loaded");
        return result;
      });
      return res.status(201).json({ node: serializeKnowledgeNodeDetail(detail) });
    } catch (error) {
      return publicError(res, error);
    }
  });

  router.post("/backfill", async (req: AuthenticatedRequest, res: Response) => {
    if (!database) return res.status(503).json({ error: "知识库数据库未配置" });
    const body = record(req.body) ?? {};
    const cursor = body.cursor === null || body.cursor === undefined
      ? null
      : boundedText(body.cursor, 200);
    if (body.cursor !== null && body.cursor !== undefined && !cursor) {
      return res.status(400).json({ error: "回填游标无效" });
    }
    try {
      const result = await inTransaction(database, factory, async (queryable, service) => {
        const rows = await queryable.query<{ id: string }>(
          `SELECT id FROM cards
           WHERE user_id = $1 AND ($2::text IS NULL OR id > $2)
           ORDER BY id ASC
           LIMIT 101`,
          [req.user!.id, cursor],
        );
        const batch = rows.rows.slice(0, 100);
        let created = 0;
        let updated = 0;
        for (const card of batch) {
          const existing = await service.getEntityNode(req.user!.id, "card", card.id);
          const node = await service.joinEntity(req.user!.id, "card", card.id);
          if (!node) continue;
          if (existing) updated += 1;
          else created += 1;
        }
        const hasMore = rows.rows.length > batch.length;
        return {
          cursor,
          processed: batch.length,
          created,
          updated,
          nextCursor: hasMore && batch.length ? batch[batch.length - 1]!.id : null,
          done: !hasMore,
        };
      });
      return res.json(result);
    } catch (error) {
      return publicError(res, error);
    }
  });

  router.get("/nodes/:id/candidates", async (req: AuthenticatedRequest, res: Response) => {
    const nodeId = boundedText(req.params.id, 128);
    if (!nodeId) return res.status(400).json({ error: "节点参数无效" });
    try {
      const candidates = await defaultService!.listCandidates(
        req.user!.id,
        nodeId,
        boundedInteger(req.query.limit, 10, 1, 10),
      );
      if (!candidates) return res.status(404).json({ error: "知识节点不存在" });
      return res.json({
        candidates: candidates.map((candidate) => ({
          node: serializeKnowledgeNodeSummary(candidate.node),
          score: candidate.score,
          evidence: candidate.evidence,
        })),
      });
    } catch (error) {
      return publicError(res, error);
    }
  });

  router.post("/nodes/:id/ai-suggestions", async (req: AuthenticatedRequest, res: Response) => {
    const nodeId = boundedText(req.params.id, 128);
    if (!nodeId) return res.status(400).json({ error: "节点参数无效" });
    if (!options.aiDefaults) return res.status(503).json({ error: "AI 建议未配置" });
    const limit = boundedInteger(req.body?.limit, 5, 1, 8);
    try {
      const context = await defaultService!.getAiSuggestionContext(req.user!.id, nodeId, 50);
      if (!context) return res.status(404).json({ error: "知识节点不存在" });
      const suggestions = await aiSuggestionGenerator({
        source: context.source.node,
        sourceMarkdown: context.source.markdown,
        targets: context.targets,
        headers: req.headers,
        defaults: options.aiDefaults,
        limit,
      });
      return res.json({ suggestions });
    } catch (error) {
      if (error instanceof KnowledgeAiSuggestionError) {
        return res.status(error.httpStatus).json({ error: error.message });
      }
      return publicError(res, error);
    }
  });

  router.post("/nodes/:id/candidates/:targetId/accept", async (req: AuthenticatedRequest, res: Response) => {
    const nodeId = boundedText(req.params.id, 128);
    const targetId = boundedText(req.params.targetId, 128);
    if (!nodeId || !targetId) return res.status(400).json({ error: "候选参数无效" });
    try {
      const link = await runMutation((service) =>
        service.acceptCandidate(req.user!.id, nodeId, targetId));
      return link
        ? res.status(201).json({ link: serializeKnowledgeLink(link) })
        : res.status(404).json({ error: "候选关系不存在" });
    } catch (error) {
      return publicError(res, error);
    }
  });

  router.post("/nodes/:id/candidates/:targetId/dismiss", async (req: AuthenticatedRequest, res: Response) => {
    const nodeId = boundedText(req.params.id, 128);
    const targetId = boundedText(req.params.targetId, 128);
    if (!nodeId || !targetId) return res.status(400).json({ error: "候选参数无效" });
    try {
      const dismissed = await runMutation((service) =>
        service.dismissCandidate(req.user!.id, nodeId, targetId));
      return dismissed
        ? res.json({ dismissed: true })
        : res.status(404).json({ error: "候选关系不存在" });
    } catch (error) {
      return publicError(res, error);
    }
  });

  router.get("/nodes/:id/graph", async (req: AuthenticatedRequest, res: Response) => {
    const nodeId = boundedText(req.params.id, 128);
    if (!nodeId) return res.status(400).json({ error: "节点参数无效" });
    const depth = boundedInteger(req.query.depth, 1, 1, 2) as 1 | 2;
    try {
      const graph = await defaultService!.getLocalGraph(req.user!.id, nodeId, depth);
      if (!graph) return res.status(404).json({ error: "知识节点不存在" });
      return res.json({
        nodes: graph.nodes.map(({ node, distance }) => ({
          ...serializeKnowledgeNodeSummary(node),
          distance,
        })),
        edges: graph.edges,
        truncated: graph.truncated,
      });
    } catch (error) {
      return publicError(res, error);
    }
  });

  router.post("/links", async (req: AuthenticatedRequest, res: Response) => {
    const body = record(req.body);
    const sourceNodeId = boundedText(body?.sourceNodeId, 128);
    const targetNodeId = boundedText(body?.targetNodeId, 128);
    const relationType = parseRelationType(body?.relationType);
    const context = body?.context === undefined || body.context === null
      ? null
      : boundedText(body.context, 500, true);
    if (!body || !sourceNodeId || !targetNodeId || !relationType || context === null && body.context !== undefined && body.context !== null) {
      return res.status(400).json({ error: "关系参数无效" });
    }
    try {
      const link = await runMutation((service) =>
        service.createManualLink({
          userId: req.user!.id,
          sourceNodeId,
          targetNodeId,
          relationType,
          context,
        }));
      return link
        ? res.status(201).json({ link: serializeKnowledgeLink(link) })
        : res.status(404).json({ error: "知识节点不存在" });
    } catch (error) {
      return publicError(res, error);
    }
  });

  router.delete("/links/:id", async (req: AuthenticatedRequest, res: Response) => {
    const linkId = boundedText(req.params.id, 128);
    if (!linkId) return res.status(400).json({ error: "关系参数无效" });
    try {
      const success = await runMutation((service) => service.deleteLink(req.user!.id, linkId));
      return success
        ? res.json({ success: true })
        : res.status(404).json({ error: "知识关系不存在" });
    } catch (error) {
      return publicError(res, error);
    }
  });

  return router;
}
