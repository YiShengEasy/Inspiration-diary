import { createContentFingerprint } from "./fingerprint.ts";
import {
  canonicalNodePair,
  findKnowledgeCandidates,
  type CandidateNode,
  type KnowledgeCandidate,
} from "./candidates.ts";
import {
  projectBookRow,
  projectCardRow,
  projectWeeklyNoteRow,
  type BookProjectionRow,
  type CardProjectionRow,
  type KnowledgeProjection,
  type WeeklyNoteProjectionRow,
} from "./nodeProjection.ts";
import { validateKnowledgeProperties } from "./properties.ts";
import {
  createKnowledgeRepository,
  type KnowledgeLink,
  type KnowledgeNode,
  type KnowledgeNodePage,
  type KnowledgeQueryable,
  type ListKnowledgeNodesInput,
  type OptimisticNodeUpdateResult,
} from "./repository.ts";
import { createKnowledgeSlug } from "./slug.ts";
import type { KnowledgeEntityType, KnowledgeLinkOrigin, KnowledgeProperties, KnowledgeRelationType } from "./types.ts";
import { normalizeKnowledgeTitle, parseWikilinks } from "./wikilinks.ts";

export type JoinableKnowledgeEntityType = Exclude<KnowledgeEntityType, "concept">;

export interface KnowledgeNodeDetail {
  node: KnowledgeNode;
  markdown: string;
}

export interface KnowledgeCandidateDetail extends Omit<KnowledgeCandidate, "node"> {
  node: KnowledgeNode;
}

export interface KnowledgeGraphNode {
  node: KnowledgeNode;
  distance: 0 | 1 | 2;
}

export interface KnowledgeGraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: KnowledgeRelationType;
  origin: KnowledgeLinkOrigin;
  suggested: boolean;
}

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  truncated: boolean;
}

export interface KnowledgeAiSuggestionContext {
  source: KnowledgeNodeDetail;
  targets: KnowledgeNode[];
}

export interface IndexCardResult {
  status: "created" | "updated" | "unchanged" | "disabled" | "not_found";
  node: KnowledgeNode | null;
}

export interface UpdateKnowledgeNodeRequest {
  userId: string;
  nodeId: string;
  expectedRevision: number;
  title: string;
  tags: string[];
  properties: unknown;
  markdown?: string;
  searchText?: string;
  now?: number;
}

export interface KnowledgeService {
  isAutoAddEnabled(userId: string): Promise<boolean>;
  indexCard(userId: string, cardId: string, now?: number): Promise<IndexCardResult>;
  joinEntity(userId: string, entityType: JoinableKnowledgeEntityType, entityId: string, now?: number): Promise<KnowledgeNode | null>;
  leaveEntity(userId: string, entityType: JoinableKnowledgeEntityType, entityId: string, now?: number): Promise<KnowledgeNode | null>;
  leaveNode(userId: string, nodeId: string, now?: number): Promise<KnowledgeNode | null>;
  listNodes(input: ListKnowledgeNodesInput): Promise<KnowledgeNodePage>;
  getNode(userId: string, nodeId: string): Promise<KnowledgeNodeDetail | null>;
  getEntityNode(userId: string, entityType: KnowledgeEntityType, entityId: string): Promise<KnowledgeNodeDetail | null>;
  updateNode(input: UpdateKnowledgeNodeRequest): Promise<OptimisticNodeUpdateResult>;
  syncWikilinks(userId: string, sourceNode: KnowledgeNode, markdown: string, now?: number): Promise<void>;
  getBacklinks(userId: string, nodeId: string): ReturnType<ReturnType<typeof createKnowledgeRepository>["listBacklinks"]>;
  listCandidates(userId: string, nodeId: string, limit?: number): Promise<KnowledgeCandidateDetail[] | null>;
  acceptCandidate(userId: string, sourceNodeId: string, targetNodeId: string, now?: number): Promise<KnowledgeLink | null>;
  dismissCandidate(userId: string, sourceNodeId: string, targetNodeId: string, now?: number): Promise<boolean>;
  createManualLink(input: {
    userId: string;
    sourceNodeId: string;
    targetNodeId: string;
    relationType: KnowledgeRelationType;
    context?: string | null;
    now?: number;
  }): Promise<KnowledgeLink | null>;
  deleteLink(userId: string, linkId: string): Promise<boolean>;
  getLocalGraph(userId: string, nodeId: string, depth?: 1 | 2): Promise<KnowledgeGraph | null>;
  getAiSuggestionContext(userId: string, nodeId: string, limit?: number): Promise<KnowledgeAiSuggestionContext | null>;
}

export interface KnowledgeServiceOptions {
  now?: () => number;
}

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const value = String(tag).normalize("NFKC").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function projectionFingerprint(projection: KnowledgeProjection): string {
  return createContentFingerprint({
    entityType: projection.entityType,
    entityId: projection.entityId,
    title: projection.title,
    tags: projection.tags,
    properties: projection.properties,
    searchText: projection.searchText,
    markdown: projection.markdown ?? "",
  });
}

function candidateFingerprintForPair(source: CandidateNode, target: CandidateNode): {
  lowerNodeId: string;
  higherNodeId: string;
  lowerFingerprint: string;
  higherFingerprint: string;
} {
  const pair = canonicalNodePair(source.id, target.id);
  return {
    ...pair,
    lowerFingerprint: pair.lowerNodeId === source.id ? source.contentFingerprint : target.contentFingerprint,
    higherFingerprint: pair.higherNodeId === source.id ? source.contentFingerprint : target.contentFingerprint,
  };
}

function linkToGraphEdge(link: KnowledgeLink): KnowledgeGraphEdge {
  return {
    id: link.id,
    sourceNodeId: link.sourceNodeId,
    targetNodeId: link.targetNodeId,
    relationType: link.relationType,
    origin: link.origin,
    suggested: false,
  };
}

const GRAPH_MAX_NODES = 50;
const GRAPH_MAX_EDGES = 100;

async function loadCardProjection(
  client: KnowledgeQueryable,
  userId: string,
  cardId: string,
): Promise<KnowledgeProjection | null> {
  const result = await client.query<CardProjectionRow>(
    `SELECT
       c.id, c.type, c.week_id, c.day_index, c.created_at,
       c.md_name, c.md_content, c.md_summary, c.insight_note, c.terms,
       ARRAY(
         SELECT value FROM (
           SELECT va.original_name AS value FROM video_assets va
           WHERE va.user_id = $1 AND va.card_id = c.id
           UNION ALL
           SELECT ia.original_name AS value FROM image_assets ia
           WHERE ia.user_id = $1 AND ia.card_id = c.id
           UNION ALL
           SELECT da.original_name AS value FROM document_assets da
           WHERE da.user_id = $1 AND da.card_id = c.id
         ) originals
       ) AS original_filenames,
       ARRAY(
         SELECT ci.original_name FROM combo_images ci
         WHERE ci.user_id = $1 AND ci.card_id = c.id
         ORDER BY ci.sort_order, ci.created_at
       ) AS combo_image_original_names,
       ARRAY(
         SELECT cg.original_name FROM combo_generations cg
         WHERE cg.user_id = $1 AND cg.card_id = c.id
         ORDER BY cg.sort_order, cg.created_at
       ) AS combo_generation_original_names,
       ARRAY(
         SELECT ci.role FROM combo_images ci
         WHERE ci.user_id = $1 AND ci.card_id = c.id
         ORDER BY ci.sort_order, ci.created_at
       ) AS combo_roles,
       ARRAY(
         SELECT cg.prompt_note FROM combo_generations cg
         WHERE cg.user_id = $1 AND cg.card_id = c.id
           AND COALESCE(cg.prompt_note, '') <> ''
         ORDER BY cg.sort_order, cg.created_at
       ) AS combo_prompt_notes
     FROM cards c
     WHERE c.user_id = $1 AND c.id = $2`,
    [userId, cardId],
  );
  return result.rows[0] ? projectCardRow(result.rows[0]) : null;
}

async function loadBookProjection(
  client: KnowledgeQueryable,
  userId: string,
  bookId: string,
): Promise<KnowledgeProjection | null> {
  const result = await client.query<BookProjectionRow>(
    `SELECT
       b.id, b.title, b.description, b.cover_card_id, b.created_at, b.updated_at,
       (SELECT count(*)::int
        FROM inspiration_book_cards bc
        WHERE bc.user_id = $1 AND bc.book_id = b.id) AS card_count,
       ARRAY(
         SELECT c.md_name
         FROM inspiration_book_cards bc
         JOIN cards c ON c.user_id = $1 AND c.id = bc.card_id
         WHERE bc.user_id = $1 AND bc.book_id = b.id AND c.md_name IS NOT NULL
         ORDER BY bc.added_at
       ) AS member_titles,
       ARRAY(
         SELECT c.type
         FROM inspiration_book_cards bc
         JOIN cards c ON c.user_id = $1 AND c.id = bc.card_id
         WHERE bc.user_id = $1 AND bc.book_id = b.id AND c.type IS NOT NULL
         ORDER BY bc.added_at
       ) AS member_types,
       ARRAY(
         SELECT DISTINCT tag
         FROM inspiration_book_cards bc
         JOIN cards c ON c.user_id = $1 AND c.id = bc.card_id
         CROSS JOIN LATERAL unnest(COALESCE(c.terms, '{}')) AS tags(tag)
         WHERE bc.user_id = $1 AND bc.book_id = b.id
         ORDER BY tag
       ) AS member_tags
     FROM inspiration_books b
     WHERE b.user_id = $1 AND b.id = $2`,
    [userId, bookId],
  );
  return result.rows[0] ? projectBookRow(result.rows[0]) : null;
}

async function loadWeeklyNoteProjection(
  client: KnowledgeQueryable,
  userId: string,
  weekId: string,
): Promise<KnowledgeProjection | null> {
  const result = await client.query<WeeklyNoteProjectionRow>(
    `SELECT week_id, note, height, updated_at
     FROM notes
     WHERE user_id = $1 AND week_id = $2`,
    [userId, weekId],
  );
  return result.rows[0] ? projectWeeklyNoteRow(result.rows[0]) : null;
}

async function loadProjection(
  client: KnowledgeQueryable,
  userId: string,
  entityType: JoinableKnowledgeEntityType,
  entityId: string,
): Promise<KnowledgeProjection | null> {
  if (entityType === "card") return loadCardProjection(client, userId, entityId);
  if (entityType === "book") return loadBookProjection(client, userId, entityId);
  return loadWeeklyNoteProjection(client, userId, entityId);
}

async function loadSourceMarkdown(
  client: KnowledgeQueryable,
  userId: string,
  node: KnowledgeNode,
): Promise<string> {
  if (!node.entityId) return "";
  if (node.entityType === "card") {
    const result = await client.query<{ md_content: string | null }>(
      `SELECT md_content FROM cards WHERE user_id = $1 AND id = $2`,
      [userId, node.entityId],
    );
    return result.rows[0]?.md_content ?? "";
  }
  if (node.entityType === "weekly_note") {
    const result = await client.query<{ note: string | null }>(
      `SELECT note FROM notes WHERE user_id = $1 AND week_id = $2`,
      [userId, node.entityId],
    );
    return result.rows[0]?.note ?? "";
  }
  return "";
}

export function createKnowledgeService(
  client: KnowledgeQueryable,
  options: KnowledgeServiceOptions = {},
): KnowledgeService {
  const repository = createKnowledgeRepository(client);
  const currentTime = options.now ?? Date.now;

  async function isAutoAddEnabled(userId: string): Promise<boolean> {
    const result = await client.query<{ value: string | null }>(
      `SELECT value FROM settings
       WHERE user_id = $1 AND key = 'knowledge_auto_add'
       LIMIT 1`,
      [userId],
    );
    const value = result.rows[0]?.value?.trim().toLocaleLowerCase("en-US");
    if (value === undefined || value === null || value === "") return true;
    return !["false", "0", "off", "no"].includes(value);
  }

  async function syncWikilinks(
    userId: string,
    sourceNode: KnowledgeNode,
    markdown: string,
    now = currentTime(),
  ): Promise<void> {
    const targets = [];
    for (const link of parseWikilinks(markdown)) {
      let target = await repository.getActiveNodeBySlug(userId, link.target);
      if (!target) {
        target = await repository.getActiveNodeByTitle(
          userId,
          normalizeKnowledgeTitle(link.target),
        );
      }
      if (!target) {
        const normalizedTitle = normalizeKnowledgeTitle(link.target);
        target = await repository.createConceptNode({
          userId,
          title: link.target,
          slug: createKnowledgeSlug(link.target, `concept:${normalizedTitle}`),
          contentFingerprint: createContentFingerprint({ title: normalizedTitle }),
          now,
        });
      }
      if (target.id !== sourceNode.id) {
        targets.push({ targetNodeId: target.id, context: link.alias ?? null });
      }
    }
    await repository.replaceWikilinkLinks(userId, sourceNode.id, targets, now);
  }

  async function putProjection(
    userId: string,
    projection: KnowledgeProjection,
    autoAdded: boolean,
    now: number,
  ): Promise<{ node: KnowledgeNode; changed: boolean; created: boolean }> {
    const existing = await repository.getNodeByEntity(
      userId,
      projection.entityType,
      projection.entityId,
      false,
    );
    const mergedProjection = existing
      ? {
          ...projection,
          title: projection.entityType === "weekly_note" ? existing.title : projection.title,
          // Preserve user-defined metadata while refreshing source-owned keys.
          properties: { ...existing.properties, ...projection.properties },
        }
      : projection;
    const contentFingerprint = projectionFingerprint(mergedProjection);
    if (existing?.contentFingerprint === contentFingerprint) {
      return { node: existing, changed: false, created: false };
    }
    if (!existing) {
      const concept = await repository.getActiveConceptByTitle(
        userId,
        normalizeKnowledgeTitle(projection.title),
      );
      if (concept) {
        const node = await repository.claimConceptNode({
          userId,
          conceptNodeId: concept.id,
          entityType: projection.entityType,
          entityId: projection.entityId,
          slug: concept.slug,
          title: projection.title,
          tags: normalizeTags([...concept.tags, ...projection.tags]),
          properties: validateKnowledgeProperties({ ...concept.properties, ...projection.properties }),
          searchText: projection.searchText,
          contentFingerprint,
          autoAdded,
          now,
        });
        if (node) {
          await syncWikilinks(userId, node, projection.markdown ?? "", now);
          return { node, changed: true, created: false };
        }
      }
    }
    const node = await repository.putEntityNode({
      userId,
      entityType: projection.entityType,
      entityId: projection.entityId,
      slug: existing?.slug ?? createKnowledgeSlug(
        projection.title,
        `${projection.entityType}:${projection.entityId}`,
      ),
      title: mergedProjection.title,
      tags: normalizeTags(mergedProjection.tags),
      properties: validateKnowledgeProperties(mergedProjection.properties),
      searchText: mergedProjection.searchText,
      contentFingerprint,
      autoAdded,
      now,
    });
    if (node.isActive) await syncWikilinks(userId, node, mergedProjection.markdown ?? "", now);
    return { node, changed: true, created: !existing };
  }

  async function getNode(userId: string, nodeId: string): Promise<KnowledgeNodeDetail | null> {
    const node = await repository.getNodeById(userId, nodeId, true);
    if (!node) return null;
    return { node, markdown: await loadSourceMarkdown(client, userId, node) };
  }

  async function findCandidateDetails(
    userId: string,
    nodeId: string,
    limit = 10,
  ): Promise<Array<KnowledgeCandidateDetail & { candidateNode: CandidateNode }> | null> {
    const sourceNode = await repository.getNodeById(userId, nodeId, true);
    if (!sourceNode) return null;
    const candidateNodes = await repository.listCandidateNodes(userId);
    const sourceCandidate = candidateNodes.find((node) => node.id === nodeId);
    if (!sourceCandidate) return null;
    const [linkedNodeIds, feedback] = await Promise.all([
      repository.listLinkedNodeIds(userId, nodeId),
      repository.listFeedbackForNode(userId, nodeId),
    ]);
    const candidates = findKnowledgeCandidates(sourceCandidate, candidateNodes, {
      formalLinkedNodeIds: linkedNodeIds,
      feedback,
      limit,
    });
    const nodes = await repository.listActiveNodesByIds(
      userId,
      candidates.map((candidate) => candidate.node.id),
    );
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return candidates.flatMap((candidate) => {
      const node = nodeById.get(candidate.node.id);
      if (!node) return [];
      return [{
        node,
        score: candidate.score,
        evidence: candidate.evidence,
        candidateNode: candidate.node,
      }];
    });
  }

  return {
    isAutoAddEnabled,

    async indexCard(userId, cardId, now = currentTime()) {
      const existing = await repository.getNodeByEntity(userId, "card", cardId, false);
      if (!existing && !(await isAutoAddEnabled(userId))) {
        return { status: "disabled", node: null };
      }
      const projection = await loadCardProjection(client, userId, cardId);
      if (!projection) return { status: "not_found", node: null };
      const result = await putProjection(userId, projection, !existing, now);
      return {
        status: result.created ? "created" : result.changed ? "updated" : "unchanged",
        node: result.node,
      };
    },

    async joinEntity(userId, entityType, entityId, now = currentTime()) {
      const projection = await loadProjection(client, userId, entityType, entityId);
      if (!projection) return null;
      const result = await putProjection(userId, projection, false, now);
      const node = result.node.isActive
        ? result.node
        : await repository.setNodeActive(userId, result.node.id, true, now);
      if (node?.isActive && !result.node.isActive) {
        await syncWikilinks(userId, node, projection.markdown ?? "", now);
      }
      return node;
    },

    async leaveEntity(userId, entityType, entityId, now = currentTime()) {
      const node = await repository.getNodeByEntity(userId, entityType, entityId, false);
      return node ? repository.setNodeActive(userId, node.id, false, now) : null;
    },

    leaveNode(userId, nodeId, now = currentTime()) {
      return repository.setNodeActive(userId, nodeId, false, now);
    },

    listNodes(input) {
      return repository.listNodes(input);
    },

    getNode,

    async getEntityNode(userId, entityType, entityId) {
      const node = await repository.getNodeByEntity(userId, entityType, entityId, true);
      if (!node) return null;
      return { node, markdown: await loadSourceMarkdown(client, userId, node) };
    },

    async updateNode(input) {
      const current = await repository.getNodeById(input.userId, input.nodeId, true);
      if (!current) return { status: "not_found" };
      const properties = validateKnowledgeProperties(input.properties);
      const tags = normalizeTags(input.tags);
      const markdown = input.markdown ?? await loadSourceMarkdown(client, input.userId, current);
      const searchText = input.searchText?.trim()
        || [input.title, ...tags, markdown || current.searchText].filter(Boolean).join(" ");
      const contentFingerprint = createContentFingerprint({
        title: input.title,
        tags,
        properties,
        searchText,
        markdown,
      });
      const result = await repository.updateNodeOptimistically({
        userId: input.userId,
        nodeId: input.nodeId,
        expectedRevision: input.expectedRevision,
        title: input.title.trim(),
        tags,
        properties,
        searchText,
        contentFingerprint,
        now: input.now ?? currentTime(),
      });
      if (result.status !== "updated") return result;

      const now = input.now ?? currentTime();
      if (current.entityId && current.entityType === "card") {
        await client.query(
          `UPDATE cards
           SET md_name = $3, terms = $4,
               md_content = CASE WHEN $5::boolean THEN $6 ELSE md_content END,
               terms_text = $7
           WHERE user_id = $1 AND id = $2`,
          [
            input.userId, current.entityId, input.title.trim(), tags,
            input.markdown !== undefined, markdown, searchText,
          ],
        );
      } else if (current.entityId && current.entityType === "book") {
        await client.query(
          `UPDATE inspiration_books
           SET title = $3, updated_at = $4
           WHERE user_id = $1 AND id = $2`,
          [input.userId, current.entityId, input.title.trim(), now],
        );
      } else if (current.entityId && current.entityType === "weekly_note" && input.markdown !== undefined) {
        await client.query(
          `UPDATE notes SET note = $3, updated_at = $4
           WHERE user_id = $1 AND week_id = $2`,
          [input.userId, current.entityId, markdown, now],
        );
      }
      await syncWikilinks(input.userId, result.node, markdown, now);
      return result;
    },

    syncWikilinks,

    getBacklinks(userId, nodeId) {
      return repository.listBacklinks(userId, nodeId);
    },

    async listCandidates(userId, nodeId, limit) {
      const candidates = await findCandidateDetails(userId, nodeId, limit);
      return candidates
        ? candidates.map(({ candidateNode: _candidateNode, ...candidate }) => candidate)
        : null;
    },

    async acceptCandidate(userId, sourceNodeId, targetNodeId, now = currentTime()) {
      const candidates = await findCandidateDetails(userId, sourceNodeId, 10);
      if (!candidates) return null;
      const accepted = candidates.find((candidate) => candidate.node.id === targetNodeId);
      if (!accepted) return null;
      const sourceCandidate = (await repository.listCandidateNodes(userId)).find((node) => node.id === sourceNodeId);
      if (!sourceCandidate) return null;
      const feedback = candidateFingerprintForPair(sourceCandidate, accepted.candidateNode);
      const link = await repository.putLink({
        userId,
        sourceNodeId,
        targetNodeId,
        relationType: "related",
        origin: "tag_suggestion",
        context: accepted.evidence.sharedTags.length
          ? `shared_tags:${accepted.evidence.sharedTags.join(",")}`
          : null,
        now,
      });
      if (!link) return null;
      await repository.putSuggestionFeedback({
        userId,
        action: "accepted",
        now,
        ...feedback,
      });
      return link;
    },

    async dismissCandidate(userId, sourceNodeId, targetNodeId, now = currentTime()) {
      const candidateNodes = await repository.listCandidateNodes(userId);
      const source = candidateNodes.find((node) => node.id === sourceNodeId);
      const target = candidateNodes.find((node) => node.id === targetNodeId);
      if (!source || !target || source.id === target.id) return false;
      const feedback = candidateFingerprintForPair(source, target);
      const result = await repository.putSuggestionFeedback({
        userId,
        action: "dismissed",
        now,
        ...feedback,
      });
      return Boolean(result);
    },

    createManualLink(input) {
      return repository.putLink({
        userId: input.userId,
        sourceNodeId: input.sourceNodeId,
        targetNodeId: input.targetNodeId,
        relationType: input.relationType,
        origin: "manual",
        context: input.context ?? null,
        now: input.now ?? currentTime(),
      });
    },

    deleteLink(userId, linkId) {
      return repository.deleteLink(userId, linkId);
    },

    async getLocalGraph(userId, nodeId, depth = 1) {
      const source = await repository.getNodeById(userId, nodeId, true);
      if (!source) return null;
      const firstLinks = await repository.listLinksForNode(userId, nodeId);
      const firstNeighborIds = new Set(firstLinks.flatMap((link) => [
        link.sourceNodeId,
        link.targetNodeId,
      ]).filter((id) => id !== nodeId));
      const linkById = new Map(firstLinks.map((link) => [link.id, link]));
      if (depth === 2 && firstNeighborIds.size > 0) {
        const secondLinks = await repository.listLinksTouchingNodes(userId, [...firstNeighborIds]);
        for (const link of secondLinks) linkById.set(link.id, link);
      }
      const formalLinks = [...linkById.values()];
      const nodeIds = new Set<string>([nodeId]);
      for (const link of formalLinks) {
        nodeIds.add(link.sourceNodeId);
        nodeIds.add(link.targetNodeId);
      }
      const candidates = await findCandidateDetails(userId, nodeId, 10);
      const suggestedEdges: KnowledgeGraphEdge[] = [];
      for (const candidate of candidates ?? []) {
        if (nodeIds.size < GRAPH_MAX_NODES) nodeIds.add(candidate.node.id);
        suggestedEdges.push({
          id: `suggested:${nodeId}:${candidate.node.id}`,
          sourceNodeId: nodeId,
          targetNodeId: candidate.node.id,
          relationType: "related",
          origin: "tag_suggestion",
          suggested: true,
        });
      }
      const nodes = await repository.listActiveNodesByIds(userId, [...nodeIds]);
      const distanceById = new Map<string, 0 | 1 | 2>([[nodeId, 0]]);
      for (const id of firstNeighborIds) distanceById.set(id, 1);
      if (depth === 2) {
        for (const link of formalLinks) {
          const sourceDistance = distanceById.get(link.sourceNodeId);
          const targetDistance = distanceById.get(link.targetNodeId);
          if (sourceDistance === 1 && !targetDistance) distanceById.set(link.targetNodeId, 2);
          if (targetDistance === 1 && !sourceDistance) distanceById.set(link.sourceNodeId, 2);
        }
      }
      const sortedNodes = nodes
        .map((node) => ({ node, distance: distanceById.get(node.id) ?? (node.id === nodeId ? 0 : 1) }))
        .sort((first, second) => first.distance - second.distance || first.node.updatedAt - second.node.updatedAt || first.node.id.localeCompare(second.node.id))
        .slice(0, GRAPH_MAX_NODES);
      const keptNodeIds = new Set(sortedNodes.map((entry) => entry.node.id));
      const formalEdges = formalLinks.map(linkToGraphEdge);
      const edges = [...formalEdges, ...suggestedEdges]
        .filter((edge) => keptNodeIds.has(edge.sourceNodeId) && keptNodeIds.has(edge.targetNodeId))
        .slice(0, GRAPH_MAX_EDGES);
      return {
        nodes: sortedNodes,
        edges,
        truncated: nodes.length > GRAPH_MAX_NODES || formalEdges.length + suggestedEdges.length > GRAPH_MAX_EDGES,
      };
    },

    async getAiSuggestionContext(userId, nodeId, limit = 50) {
      const source = await getNode(userId, nodeId);
      if (!source) return null;
      const page = await repository.listNodes({
        userId,
        page: 1,
        pageSize: Math.min(100, Math.max(1, limit + 1)),
      });
      return {
        source,
        targets: page.nodes.filter((node) => node.id !== nodeId).slice(0, limit),
      };
    },
  };
}

export const createNoAiKnowledgeService = createKnowledgeService;
