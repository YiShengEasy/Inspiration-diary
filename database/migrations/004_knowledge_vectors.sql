CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE knowledge_nodes
  ADD CONSTRAINT knowledge_nodes_user_id_id_unique UNIQUE (user_id, id);

CREATE TABLE knowledge_node_embeddings (
  user_id UUID NOT NULL,
  node_id UUID NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions BETWEEN 1 AND 4096),
  content_fingerprint TEXT NOT NULL,
  embedding VECTOR NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, node_id, model),
  FOREIGN KEY (user_id, node_id)
    REFERENCES knowledge_nodes(user_id, id) ON DELETE CASCADE,
  CHECK (vector_dims(embedding) = dimensions)
);

CREATE INDEX knowledge_node_embeddings_lookup_idx
  ON knowledge_node_embeddings(user_id, model, dimensions, node_id);
