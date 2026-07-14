import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("knowledge core migration preserves tenant, relation, and search contracts", async () => {
  const sql = await readFile(
    new URL("../database/migrations/002_knowledge_core.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pg_trgm/i);
  assert.match(sql, /CREATE TABLE knowledge_nodes[\s\S]*user_id uuid NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/i);
  assert.match(sql, /UNIQUE INDEX knowledge_nodes_entity_unique[\s\S]*\(user_id, entity_type, entity_id\)[\s\S]*WHERE entity_id IS NOT NULL/i);
  assert.match(sql, /UNIQUE INDEX knowledge_nodes_slug_unique[\s\S]*\(user_id, slug\)/i);
  assert.match(sql, /relation_type text NOT NULL CHECK \(relation_type IN \('mentions','related','references','derived_from','belongs_to','contrasts','supports'\)\)/i);
  assert.match(sql, /origin text NOT NULL CHECK \(origin IN \('manual','wikilink','tag_suggestion','ai'\)\)/i);
  assert.match(sql, /CHECK \(source_node_id <> target_node_id\)/i);
  assert.match(sql, /CHECK \(lower_node_id::text < higher_node_id::text\)/i);
  assert.match(sql, /knowledge_nodes_search_trgm_idx[\s\S]*gin\(search_text gin_trgm_ops\)/i);
});

test("knowledge explorer migration keeps folders tenant-safe and indexed", async () => {
  const sql = await readFile(
    new URL("../database/migrations/003_knowledge_explorer.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /CREATE TABLE knowledge_folders/i);
  assert.match(sql, /source_type TEXT NOT NULL CHECK \(source_type IN \('manual','inspiration_book'\)\)/i);
  assert.match(sql, /FOREIGN KEY \(user_id, parent_id\)[\s\S]*REFERENCES knowledge_folders\(user_id, id\)/i);
  assert.match(sql, /PRIMARY KEY \(user_id, folder_id, node_id\)/i);
  assert.match(sql, /FOREIGN KEY \(user_id, node_id\)[\s\S]*REFERENCES knowledge_nodes\(user_id, id\)/i);
  assert.match(sql, /knowledge_folders_parent_sort_idx/i);
  assert.match(sql, /knowledge_folder_nodes_folder_idx/i);
  assert.match(sql, /knowledge_folder_nodes_node_idx/i);
  assert.match(sql, /ON CONFLICT \(user_id, folder_id, node_id\) DO NOTHING/i);
});
