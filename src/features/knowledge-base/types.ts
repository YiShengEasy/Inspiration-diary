export type KnowledgeEntityType = "card" | "book" | "weekly_note" | "concept";

export type KnowledgeRelationType =
  | "mentions"
  | "related"
  | "references"
  | "derived_from"
  | "belongs_to"
  | "contrasts"
  | "supports";

export type KnowledgeLinkOrigin = "manual" | "wikilink" | "tag_suggestion" | "ai";

export type KnowledgePropertyValue = string | string[] | number | boolean | { nodeId: string };
export type KnowledgeProperties = Record<string, KnowledgePropertyValue>;

export interface KnowledgeNodeSummary {
  id: string;
  entityType: KnowledgeEntityType;
  entityId: string | null;
  slug: string;
  title: string;
  tags: string[];
  snippet: string;
  isActive: boolean;
  autoAdded: boolean;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeNodeDetail extends KnowledgeNodeSummary {
  properties: KnowledgeProperties;
  markdown: string | null;
}

export interface KnowledgeNodeListResponse {
  nodes: KnowledgeNodeSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface KnowledgeNodeResponse {
  node: KnowledgeNodeDetail;
}

export interface KnowledgeEntityMembershipResponse {
  node: KnowledgeNodeDetail | null;
}

export interface KnowledgeLink {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: KnowledgeRelationType;
  origin: KnowledgeLinkOrigin;
  context: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeBacklink {
  link: KnowledgeLink;
  source: KnowledgeNodeSummary;
}

export interface KnowledgeBacklinksResponse {
  backlinks: KnowledgeBacklink[];
}

export interface KnowledgeCandidateEvidence {
  sharedTags: string[];
  sameBook: boolean;
  sharedPropertyRatio: number;
  creationProximity: number;
}

export interface KnowledgeCandidate {
  node: KnowledgeNodeSummary;
  score: number;
  evidence: KnowledgeCandidateEvidence;
}

export interface KnowledgeCandidatesResponse {
  candidates: KnowledgeCandidate[];
}

export interface KnowledgeGraphNode extends KnowledgeNodeSummary {
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

export interface KnowledgeGraphResponse {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  truncated: boolean;
}

export interface KnowledgeBackfillResponse {
  cursor: string | null;
  processed: number;
  created: number;
  updated: number;
  nextCursor: string | null;
  done: boolean;
}

export interface KnowledgeRevisionConflictResponse {
  error: "revision_conflict";
  serverRevision: number;
  serverNode: KnowledgeNodeDetail;
}

export interface CreateKnowledgeMarkdownInput {
  title: string;
  markdown: string;
  tags?: string[];
  properties?: KnowledgeProperties;
}

export interface UpdateKnowledgeNodeInput {
  revision: number;
  title: string;
  markdown: string | null;
  tags: string[];
  properties: KnowledgeProperties;
}
