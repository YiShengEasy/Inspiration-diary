import type {
  KnowledgeLink,
  KnowledgeNode,
} from "./repository.ts";
import type { KnowledgeNodeDetail } from "./service.ts";

function snippet(searchText: string, maximum = 180): string {
  const normalized = searchText.replace(/\s+/gu, " ").trim();
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}

export function serializeKnowledgeNodeSummary(node: KnowledgeNode) {
  return {
    id: node.id,
    entityType: node.entityType,
    entityId: node.entityId,
    slug: node.slug,
    title: node.title,
    tags: node.tags,
    snippet: snippet(node.searchText),
    isActive: node.isActive,
    autoAdded: node.autoAdded,
    revision: node.revision,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

export function serializeKnowledgeNodeDetail(detail: KnowledgeNodeDetail) {
  return {
    ...serializeKnowledgeNodeSummary(detail.node),
    properties: detail.node.properties,
    markdown: detail.markdown || null,
  };
}

export function serializeKnowledgeLink(link: KnowledgeLink) {
  return {
    id: link.id,
    sourceNodeId: link.sourceNodeId,
    targetNodeId: link.targetNodeId,
    relationType: link.relationType,
    origin: link.origin,
    context: link.context,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}
