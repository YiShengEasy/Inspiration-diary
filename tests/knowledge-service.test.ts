import assert from "node:assert/strict";
import { test } from "node:test";

import type { KnowledgeQueryResult, KnowledgeQueryable } from "../src/server/knowledge/repository.ts";
import { createKnowledgeService } from "../src/server/knowledge/service.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";

interface QueryCall {
  text: string;
  values: unknown[];
}

function scriptedQueryable(
  respond: (call: QueryCall, index: number) => KnowledgeQueryResult<Record<string, unknown>>,
): { queryable: KnowledgeQueryable; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  return {
    calls,
    queryable: {
      async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []) {
        const call = { text, values };
        calls.push(call);
        return respond(call, calls.length - 1) as KnowledgeQueryResult<Row>;
      },
    },
  };
}

test("knowledge auto-add defaults on and recognizes an explicit opt-out", async () => {
  const missing = scriptedQueryable(() => ({ rows: [], rowCount: 0 }));
  assert.equal(await createKnowledgeService(missing.queryable).isAutoAddEnabled(USER_ID), true);
  assert.deepEqual(missing.calls[0]?.values, [USER_ID]);

  const disabled = scriptedQueryable(() => ({ rows: [{ value: "false" }], rowCount: 1 }));
  assert.equal(await createKnowledgeService(disabled.queryable).isAutoAddEnabled(USER_ID), false);
  assert.deepEqual(disabled.calls[0]?.values, [USER_ID]);
});

test("an opted-out user does not create a node for a new card", async () => {
  const database = scriptedQueryable((_call, index) => {
    if (index === 0) return { rows: [], rowCount: 0 }; // No existing knowledge node.
    if (index === 1) return { rows: [{ value: "false" }], rowCount: 1 };
    throw new Error("indexCard queried source content after opt-out");
  });

  const result = await createKnowledgeService(database.queryable).indexCard(USER_ID, "card-1");
  assert.deepEqual(result, { status: "disabled", node: null });
  assert.equal(database.calls.length, 2);
  for (const call of database.calls) assert.equal(call.values[0], USER_ID);
});

test("a same-title Markdown card claims the concept placeholder and preserves its node id", async () => {
  const conceptRow = {
    id: "22222222-2222-4222-8222-222222222222",
    user_id: USER_ID,
    entity_type: "concept",
    entity_id: null,
    slug: "未来视觉语言-placeholder",
    title: "未来视觉语言",
    tags: [],
    properties: {},
    search_text: "未来视觉语言",
    is_active: true,
    auto_added: false,
    content_fingerprint: "concept-fingerprint",
    revision: 1,
    deleted_at: null,
    created_at: 100,
    updated_at: 100,
  };
  const database = scriptedQueryable((call) => {
    if (/FROM cards c/u.test(call.text)) {
      return {
        rows: [{
          id: "card-1",
          type: "md",
          week_id: "2026-W29",
          day_index: 1,
          created_at: 200,
          md_name: "未来视觉语言",
          md_content: "正文",
          md_summary: "",
          insight_note: "",
          terms: [],
          original_filenames: [],
          combo_image_original_names: [],
          combo_generation_original_names: [],
          combo_roles: [],
          combo_prompt_notes: [],
        }],
        rowCount: 1,
      };
    }
    if (/entity_type = \$2 AND entity_id = \$3/u.test(call.text)) {
      return { rows: [], rowCount: 0 };
    }
    if (/entity_type = 'concept'/u.test(call.text) && /^\s*SELECT/u.test(call.text)) {
      return { rows: [conceptRow], rowCount: 1 };
    }
    if (/^\s*UPDATE knowledge_nodes/u.test(call.text)) {
      return {
        rows: [{
          ...conceptRow,
          entity_type: "card",
          entity_id: "card-1",
          title: "未来视觉语言",
          properties: { contentType: "md", weekId: "2026-W29", dayIndex: 1, createdAt: 200 },
          search_text: "md 未来视觉语言 正文",
          content_fingerprint: "card-fingerprint",
          revision: 2,
          updated_at: 200,
        }],
        rowCount: 1,
      };
    }
    if (/^\s*DELETE FROM knowledge_links/u.test(call.text)) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected knowledge query: ${call.text}`);
  });

  const node = await createKnowledgeService(database.queryable).joinEntity(
    USER_ID,
    "card",
    "card-1",
    200,
  );

  assert.equal(node?.id, conceptRow.id);
  assert.equal(node?.entityType, "card");
  assert.equal(node?.entityId, "card-1");
  assert.equal(database.calls.some((call) => /^\s*INSERT INTO knowledge_nodes/u.test(call.text)), false);
  for (const call of database.calls) assert.equal(call.values[0], USER_ID);
});
