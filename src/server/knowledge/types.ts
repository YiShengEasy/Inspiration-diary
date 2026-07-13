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

export type KnowledgeNodeReference = { nodeId: string };

export type PropertyValue =
  | string
  | string[]
  | number
  | boolean
  | KnowledgeNodeReference;

export type KnowledgeProperties = Record<string, PropertyValue>;
