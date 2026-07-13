import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupUploadSessions,
  type CleanupPool,
} from "../src/server/direct-upload/cleanup.ts";

interface FakeRow {
  id: string;
  user_id: string;
  status: "authorized" | "failed" | "finalized";
  pending_object_key: string;
  final_object_key: string | null;
}

function createFixture(rows: FakeRow[], referencedKeys = new Set<string>()) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  let released = false;
  const client = {
    async query<Row = Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (text.includes("FROM upload_sessions") && text.includes("FOR UPDATE")) {
        return { rows: rows as unknown as Row[] };
      }
      if (text.includes("AS is_referenced")) {
        return {
          rows: [{ is_referenced: referencedKeys.has(String(values?.[0])) }] as unknown as Row[],
        };
      }
      return { rows: [] as Row[] };
    },
    release() {
      released = true;
    },
  };
  const pool: CleanupPool = { async connect() { return client; } };
  return { pool, queries, wasReleased: () => released };
}

test("cleanup is bounded and uses skip-locked rows", async () => {
  const fixture = createFixture([]);
  const result = await cleanupUploadSessions({
    pool: fixture.pool,
    gateway: { async delete() {} },
    batchSize: 100,
    now: 2 * 24 * 60 * 60 * 1000,
    log() {},
  });

  const select = fixture.queries.find((query) => query.text.includes("FROM upload_sessions"));
  assert.match(select?.text || "", /LIMIT \$3\s+FOR UPDATE SKIP LOCKED/u);
  assert.equal(select?.values?.[2], 100);
  assert.equal(result.scanned, 0);
  assert.equal(fixture.wasReleased(), true);
  await assert.rejects(
    cleanupUploadSessions({
      pool: fixture.pool,
      gateway: { async delete() {} },
      batchSize: 101,
      log() {},
    }),
    /between 1 and 100/u,
  );
});

test("cleanup expires pending objects and preserves referenced finalized media", async () => {
  const fixture = createFixture(
    [
      { id: "fresh-expired", user_id: "u1", status: "authorized", pending_object_key: "pending/u1/a.jpg", final_object_key: null },
      { id: "old-failed", user_id: "u1", status: "failed", pending_object_key: "pending/u1/b.jpg", final_object_key: null },
      { id: "orphan-final", user_id: "u1", status: "finalized", pending_object_key: "pending/u1/c.jpg", final_object_key: "media/u1/c.jpg" },
      { id: "claimed-final", user_id: "u1", status: "finalized", pending_object_key: "pending/u1/d.jpg", final_object_key: "media/u1/d.jpg" },
    ],
    new Set(["media/u1/d.jpg"]),
  );
  const deleted: string[] = [];
  const result = await cleanupUploadSessions({
    pool: fixture.pool,
    gateway: { async delete(key) { deleted.push(key); } },
    now: 3 * 24 * 60 * 60 * 1000,
    log() {},
  });

  assert.deepEqual(deleted, ["pending/u1/a.jpg", "pending/u1/b.jpg", "media/u1/c.jpg"]);
  assert.deepEqual(result, {
    scanned: 4,
    expired: 1,
    deletedPending: 2,
    deletedFinal: 1,
    restoredClaimed: 1,
    failed: 0,
  });
  assert.equal(
    fixture.queries.some((query) => query.text.includes("SET status = 'claimed'") && query.values?.[0] === "claimed-final"),
    true,
  );
});

test("cleanup leaves a session for retry when OSS deletion fails", async () => {
  const fixture = createFixture([
    { id: "retry", user_id: "u1", status: "failed", pending_object_key: "pending/u1/retry.jpg", final_object_key: null },
  ]);
  const result = await cleanupUploadSessions({
    pool: fixture.pool,
    gateway: { async delete() { throw new Error("temporary OSS failure"); } },
    now: 3 * 24 * 60 * 60 * 1000,
    log() {},
  });

  assert.equal(result.failed, 1);
  assert.equal(
    fixture.queries.some((query) => query.text.includes("DELETE FROM upload_sessions")),
    false,
  );
});
