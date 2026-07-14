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

export type KnowledgePreviewKind = "image" | "markdown" | "combo" | "video" | "book" | "weekly_note" | "concept";

export interface KnowledgePreview {
  kind: KnowledgePreviewKind;
  thumbnailUrls: string[];
  mediaCount: number;
}

export interface KnowledgeFolderSummary {
  id: string;
  name: string;
}

export interface KnowledgeExplorerNode extends KnowledgeNodeSummary {
  preview: KnowledgePreview;
  folders: KnowledgeFolderSummary[];
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

export interface KnowledgeFolderPage {
  folders: KnowledgeFolder[];
  nextCursor: string | null;
}

export interface KnowledgeExplorerPage {
  nodes: KnowledgeExplorerNode[];
  nextCursor: string | null;
}

export type KnowledgeExplorerSource =
  | { kind: "all"; label: string }
  | { kind: "unfiled"; label: string }
  | { kind: "folder"; id: string; label: string }
  | { kind: "contentType"; contentType: "image" | "md" | "combo" | "video"; label: string }
  | { kind: "entityType"; entityType: "book" | "weekly_note" | "concept"; label: string };

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
  feedbackBoost?: number;
  feedbackPenalty?: number;
  source?: "ranked" | "exploration";
}

export interface KnowledgeCandidate {
  node: KnowledgeNodeSummary & { preview?: KnowledgePreview; folders?: KnowledgeFolderSummary[] };
  score: number;
  evidence: KnowledgeCandidateEvidence;
}

export interface KnowledgeCandidatesResponse {
  candidates: KnowledgeCandidate[];
}

export interface KnowledgeAiSuggestion {
  targetNodeId: string;
  relationType: KnowledgeRelationType;
  confidence: number;
  reason: string;
  localScore?: number;
  evidence?: KnowledgeCandidateEvidence | null;
}

export interface KnowledgeAiSuggestionsResponse {
  suggestions: KnowledgeAiSuggestion[];
}

export interface KnowledgeGraphNode extends KnowledgeNodeSummary {
  contentType?: string;
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
