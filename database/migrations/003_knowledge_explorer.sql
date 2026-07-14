CREATE UNIQUE INDEX IF NOT EXISTS knowledge_nodes_user_id_unique
  ON knowledge_nodes(user_id, id);

CREATE TABLE knowledge_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id UUID,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  source_type TEXT NOT NULL CHECK (source_type IN ('manual','inspiration_book')),
  source_entity_id TEXT,
  sort_order BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CHECK ((source_type = 'manual') = (source_entity_id IS NULL))
);

CREATE UNIQUE INDEX knowledge_folders_user_id_unique
  ON knowledge_folders(user_id, id);

ALTER TABLE knowledge_folders
  ADD CONSTRAINT knowledge_folders_parent_fk
  FOREIGN KEY (user_id, parent_id)
  REFERENCES knowledge_folders(user_id, id)
  ON DELETE CASCADE;

CREATE UNIQUE INDEX knowledge_folders_source_unique
  ON knowledge_folders(user_id, source_type, source_entity_id)
  WHERE source_entity_id IS NOT NULL;

CREATE UNIQUE INDEX knowledge_folders_root_name_unique
  ON knowledge_folders(user_id, lower(regexp_replace(trim(name), '\s+', ' ', 'g')))
  WHERE parent_id IS NULL;

CREATE UNIQUE INDEX knowledge_folders_child_name_unique
  ON knowledge_folders(user_id, parent_id, lower(regexp_replace(trim(name), '\s+', ' ', 'g')))
  WHERE parent_id IS NOT NULL;

CREATE INDEX knowledge_folders_parent_sort_idx
  ON knowledge_folders(user_id, parent_id, sort_order, id);

CREATE TABLE knowledge_folder_nodes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id UUID NOT NULL,
  node_id UUID NOT NULL,
  sort_order BIGINT NOT NULL,
  added_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, folder_id, node_id),
  FOREIGN KEY (user_id, folder_id)
    REFERENCES knowledge_folders(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, node_id)
    REFERENCES knowledge_nodes(user_id, id) ON DELETE CASCADE
);

CREATE INDEX knowledge_folder_nodes_folder_idx
  ON knowledge_folder_nodes(user_id, folder_id, sort_order, node_id);

CREATE INDEX knowledge_folder_nodes_node_idx
  ON knowledge_folder_nodes(user_id, node_id, folder_id);

WITH named_books AS (
  SELECT
    b.*,
    count(*) OVER (
      PARTITION BY b.user_id, lower(regexp_replace(trim(b.title), '\s+', ' ', 'g'))
    ) AS duplicate_count
  FROM inspiration_books b
)
INSERT INTO knowledge_folders (
  user_id, parent_id, name, source_type, source_entity_id,
  sort_order, created_at, updated_at
)
SELECT
  b.user_id,
  NULL,
  CASE WHEN b.duplicate_count > 1
    THEN b.title || ' · ' || left(b.id, 8)
    ELSE b.title
  END,
  'inspiration_book',
  b.id,
  b.updated_at,
  b.created_at,
  b.updated_at
FROM named_books b
ON CONFLICT (user_id, source_type, source_entity_id)
  WHERE source_entity_id IS NOT NULL
DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  updated_at = EXCLUDED.updated_at;

INSERT INTO knowledge_folder_nodes (user_id, folder_id, node_id, sort_order, added_at)
SELECT
  bc.user_id,
  folder.id,
  node.id,
  bc.added_at,
  bc.added_at
FROM inspiration_book_cards bc
JOIN knowledge_folders folder
  ON folder.user_id = bc.user_id
 AND folder.source_type = 'inspiration_book'
 AND folder.source_entity_id = bc.book_id
JOIN knowledge_nodes node
  ON node.user_id = bc.user_id
 AND node.entity_type = 'card'
 AND node.entity_id = bc.card_id
ON CONFLICT (user_id, folder_id, node_id) DO NOTHING;
