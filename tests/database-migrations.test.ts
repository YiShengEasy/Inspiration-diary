import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  migrate,
  parseMigrationNames,
  selectPending,
  type MigrationFile,
  type MigrationPool,
  type MigrationClient,
} from "../src/server/database/migrations";

test("sorts unapplied migrations and rejects duplicate versions", () => {
  assert.deepEqual(selectPending(["002_b.sql", "001_a.sql"], new Set()), ["001_a.sql", "002_b.sql"]);
  assert.deepEqual(selectPending(["002_b.sql", "001_a.sql"], new Set(["001"])), ["002_b.sql"]);
  assert.throws(() => parseMigrationNames(["001_a.sql", "001_b.sql"]), /duplicate migration version 001/i);
});

test("rejects malformed migration filenames", () => {
  assert.throws(() => parseMigrationNames(["migration.sql"]), /invalid migration filename/i);
  assert.throws(() => parseMigrationNames(["001_UPPER.sql"]), /invalid migration filename/i);
});

test("001 creates upload sessions and document assets", async () => {
  const sql = await readFile(new URL("../database/migrations/001_upload_sessions.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS upload_sessions/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS document_assets/i);
  assert.match(sql, /pending_object_key TEXT NOT NULL UNIQUE/i);
  assert.match(sql, /status IN \('authorized', 'uploaded', 'finalized', 'claimed', 'failed', 'expired'\)/i);
});

test("applies only pending migrations in isolated transactions", async () => {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  const client: MigrationClient = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("SELECT version FROM schema_migrations")) {
        return { rows: [{ version: "001" }] };
      }
      return { rows: [] };
    },
    release() {
      calls.push({ text: "RELEASE_CLIENT" });
    },
  };
  const pool: MigrationPool = { connect: async () => client };
  const files: MigrationFile[] = [
    { version: "002", filename: "002_second.sql", sql: "CREATE TABLE second_table(id text);" },
    { version: "001", filename: "001_first.sql", sql: "CREATE TABLE first_table(id text);" },
  ];

  await migrate(pool, files, 1234);

  assert.equal(calls.filter((call) => call.text === files[0].sql).length, 1);
  assert.equal(calls.filter((call) => call.text === files[1].sql).length, 0);
  assert.deepEqual(
    calls.find((call) => call.text.includes("INSERT INTO schema_migrations"))?.values,
    ["002", "002_second.sql", 1234],
  );
  assert.ok(calls.some((call) => call.text === "BEGIN"));
  assert.ok(calls.some((call) => call.text === "COMMIT"));
  assert.ok(calls.some((call) => call.text.includes("pg_advisory_unlock")));
  assert.equal(calls.at(-1)?.text, "RELEASE_CLIENT");
});

test("rolls back a failed migration and always releases the lock and client", async () => {
  const calls: string[] = [];
  const client: MigrationClient = {
    async query(text) {
      calls.push(text);
      if (text.includes("SELECT version FROM schema_migrations")) return { rows: [] };
      if (text === "BROKEN SQL") throw new Error("migration failed");
      return { rows: [] };
    },
    release() {
      calls.push("RELEASE_CLIENT");
    },
  };

  await assert.rejects(
    migrate(
      { connect: async () => client },
      [{ version: "001", filename: "001_broken.sql", sql: "BROKEN SQL" }],
    ),
    /migration failed/,
  );

  assert.ok(calls.includes("ROLLBACK"));
  assert.ok(calls.some((call) => call.includes("pg_advisory_unlock")));
  assert.equal(calls.at(-1), "RELEASE_CLIENT");
});
