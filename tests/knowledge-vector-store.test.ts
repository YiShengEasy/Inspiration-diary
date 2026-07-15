import assert from "node:assert/strict";
import { test } from "node:test";

import type { KnowledgeQueryResult, KnowledgeQueryable } from "../src/server/knowledge/repository.ts";
import { createKnowledgeVectorStore } from "../src/server/knowledge/vectorStore.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NODE_ID = "22222222-2222-4222-8222-222222222222";
const ROW = {
  id: NODE_ID,
  user_id: USER_ID,
  entity_type: "card" as const,
  entity_id: "card-1",
  slug: "node",
  title: "节点",
  tags: ["标签"],
  properties: {},
  search_text: "节点 标签",
  is_active: true,
  auto_added: false,
  content_fingerprint: "fingerprint",
  revision: 1,
  deleted_at: null,
  created_at: 1,
  updated_at: 2,
};

test("vector store scopes stale checks, upserts and similarity queries", async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const queryable: KnowledgeQueryable = {
    async query<RowType = Record<string, unknown>>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      const rows = calls.length === 1
        ? [ROW]
        : calls.length === 3
          ? [{ ...ROW, semantic_similarity: "0.82" }]
          : [];
      return { rows } as KnowledgeQueryResult<RowType>;
    },
  };
  const store = createKnowledgeVectorStore(queryable);

  const stale = await store.listNodesNeedingEmbedding(USER_ID, NODE_ID, "model-a", 2, 500);
  assert.equal(stale[0]?.id, NODE_ID);
  await store.upsertEmbedding({
    userId: USER_ID,
    node: stale[0]!,
    model: "model-a",
    dimensions: 2,
    embedding: [0.1, 0.2],
    now: 100,
  });
  const similar = await store.listSimilarNodes(USER_ID, NODE_ID, "model-a", 2, 8);

  assert.equal(similar[0]?.similarity, 0.82);
  assert.deepEqual(calls[0]?.values, [USER_ID, NODE_ID, "model-a", 2, 500]);
  assert.equal(calls[1]?.values[5], "[0.1,0.2]");
  assert.match(calls[2]?.text ?? "", /target_embedding\.embedding <=> source_embedding\.embedding/u);
  assert.match(calls[2]?.text ?? "", /NOT EXISTS[\s\S]*knowledge_links/u);
  assert.doesNotMatch(calls[2]?.text ?? "", /hnsw|ivfflat/iu);
});
