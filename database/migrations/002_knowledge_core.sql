CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE knowledge_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('card','book','weekly_note','concept')),
  entity_id TEXT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  properties JSONB NOT NULL DEFAULT '{}',
  search_text TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  auto_added BOOLEAN NOT NULL DEFAULT FALSE,
  content_fingerprint TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CHECK (jsonb_typeof(properties) = 'object')
);

CREATE UNIQUE INDEX knowledge_nodes_entity_unique
  ON knowledge_nodes(user_id, entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

CREATE UNIQUE INDEX knowledge_nodes_slug_unique
  ON knowledge_nodes(user_id, slug);

CREATE INDEX knowledge_nodes_active_updated_idx
  ON knowledge_nodes(user_id, is_active, updated_at DESC);

CREATE INDEX knowledge_nodes_tags_gin_idx
  ON knowledge_nodes USING gin(tags);

CREATE INDEX knowledge_nodes_search_trgm_idx
  ON knowledge_nodes USING gin(search_text gin_trgm_ops);

CREATE TABLE knowledge_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('mentions','related','references','derived_from','belongs_to','contrasts','supports')),
  origin TEXT NOT NULL CHECK (origin IN ('manual','wikilink','tag_suggestion','ai')),
  context TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CHECK (source_node_id <> target_node_id),
  UNIQUE(user_id, source_node_id, target_node_id, relation_type, origin)
);

CREATE INDEX knowledge_links_source_idx
  ON knowledge_links(user_id, source_node_id);

CREATE INDEX knowledge_links_target_idx
  ON knowledge_links(user_id, target_node_id);

CREATE TABLE knowledge_suggestion_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lower_node_id UUID NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  higher_node_id UUID NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('dismissed','accepted')),
  lower_fingerprint TEXT NOT NULL,
  higher_fingerprint TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  CHECK (lower_node_id::text < higher_node_id::text),
  UNIQUE(user_id, lower_node_id, higher_node_id, lower_fingerprint, higher_fingerprint)
);
