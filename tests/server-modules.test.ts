import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import express, { type Express } from "express";
import type pg from "pg";

import type { AuthenticatedRequest, AuthUser } from "../src/server/auth.ts";
import { createBooksRouter } from "../src/server/books/router.ts";
import { createCardReadRouter } from "../src/server/cards/readRouter.ts";
import { createCardUpsertRouter } from "../src/server/cards/upsertRouter.ts";
import { createMiniprogramRouter } from "../src/server/miniprogram/router.ts";
import { createNotesRouter } from "../src/server/notes/router.ts";
import { createRequirePostgresAuth } from "../src/server/postgresAuth.ts";
import { createSettingsRouter } from "../src/server/settings/router.ts";

const USER: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "member@example.test",
  displayName: "Member",
  role: "user",
};

async function requestJson(
  app: Express,
  input: { method: "GET" | "POST"; path: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}${input.path}`, {
      method: input.method,
      headers: input.body === undefined ? undefined : { "content-type": "application/json" },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function authenticatedApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).user = USER;
    next();
  });
  return app;
}

test("database auth boundary returns 503 without a configured pool", async () => {
  const app = express();
  app.get("/private", createRequirePostgresAuth(null), (_req, res) => res.json({ leaked: true }));
  assert.deepEqual(await requestJson(app, { method: "GET", path: "/private" }), {
    status: 503,
    body: { error: "PostgreSQL is not configured." },
  });
});

test("notes router preserves tenant-bound read and write contracts", async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const pool = {
    async query(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      if (text.startsWith("SELECT week_id")) {
        return { rows: [{ week_id: "2026-W29", note: "note", height: 180, updated_at: "42" }] };
      }
      return { rows: [] };
    },
  } as unknown as pg.Pool;
  const app = authenticatedApp();
  app.use("/api/db", createNotesRouter(pool));

  assert.deepEqual(await requestJson(app, { method: "GET", path: "/api/db/notes/2026-W29" }), {
    status: 200,
    body: { weekId: "2026-W29", note: "note", height: 180, updatedAt: 42 },
  });
  assert.deepEqual(await requestJson(app, {
    method: "POST",
    path: "/api/db/notes",
    body: { weekId: "2026-W29", note: "updated", height: 200 },
  }), { status: 200, body: { success: true } });
  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.values[0] === USER.id), true);
});

test("settings router commits the complete batch in one transaction", async () => {
  const commands: string[] = [];
  const client = {
    async query(text: string) {
      commands.push(text.trim().split(/\s+/u)[0]!.toUpperCase());
      return { rows: [] };
    },
    release() { commands.push("RELEASE"); },
  };
  const pool = {
    async connect() { return client; },
    async query() { return { rows: [] }; },
  } as unknown as pg.Pool;
  const app = authenticatedApp();
  app.use("/api/db", createSettingsRouter(pool));

  const response = await requestJson(app, {
    method: "POST",
    path: "/api/db/settings",
    body: { knowledge_auto_add: "false", theme: "dark" },
  });
  assert.deepEqual(response, { status: 200, body: { success: true } });
  assert.deepEqual(commands, ["BEGIN", "INSERT", "INSERT", "COMMIT", "RELEASE"]);
});

test("mini-program router keeps profile counts scoped to the authenticated user", async () => {
  const values: unknown[][] = [];
  const pool = {
    async query(_text: string, queryValues: unknown[] = []) {
      values.push(queryValues);
      return { rows: [{ count: values.length === 1 ? 9 : 2 }] };
    },
  } as unknown as pg.Pool;
  const app = authenticatedApp();
  app.use("/api/miniprogram", createMiniprogramRouter(pool));

  const response = await requestJson(app, { method: "GET", path: "/api/miniprogram/me" });
  assert.equal(response.status, 200);
  assert.equal((response.body as { stats: { inspirationCount: number } }).stats.inspirationCount, 9);
  assert.equal(values.every((entry) => entry[0] === USER.id), true);
});

test("books router preserves the mounted path and tenant-bound list query", async () => {
  const values: unknown[][] = [];
  const pool = {
    async query(_text: string, queryValues: unknown[] = []) {
      values.push(queryValues);
      return { rows: [{ id: "book-1" }] };
    },
  } as unknown as pg.Pool;
  const app = authenticatedApp();
  app.use("/api/db", createBooksRouter({
    pool,
    comboSummarySelectForCard: "NULL::json AS combo_images, NULL::json AS combo_generations",
    comboSummarySelectForCoverCard: "NULL::json AS combo_images, NULL::json AS combo_generations",
    mapCardRows: () => [],
    mapBookRow: (row) => ({
      id: (row as { id: string }).id,
      title: "Book",
      description: "",
      createdAt: 1,
      updatedAt: 1,
      cardCount: 0,
      coverCardId: "",
      coverCard: null,
    }),
  }));

  const response = await requestJson(app, { method: "GET", path: "/api/db/books" });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, [{
    id: "book-1",
    title: "Book",
    description: "",
    createdAt: 1,
    updatedAt: 1,
    cardCount: 0,
    coverCardId: "",
    coverCard: null,
  }]);
  assert.deepEqual(values, [[USER.id]]);
});

test("card read router keeps pagination and tenant scope in the list contract", async () => {
  const values: unknown[][] = [];
  const pool = {
    async query(text: string, queryValues: unknown[] = []) {
      values.push([...queryValues]);
      if (text.startsWith("SELECT COUNT")) return { rows: [{ total: 1 }] };
      return { rows: [{ id: "card-1" }] };
    },
  } as unknown as pg.Pool;
  const app = authenticatedApp();
  app.use("/api/db", createCardReadRouter({
    pool,
    comboSummarySelect: "NULL::uuid AS combo_cover_image_id, 0::int AS combo_image_count, 0::int AS combo_generation_count",
    comboSummarySelectForCard: "NULL::uuid AS combo_cover_image_id, 0::int AS combo_image_count, 0::int AS combo_generation_count",
    mapCardRows: (rows) => rows.map((row) => ({
      id: (row as { id: string }).id,
      weekId: "2026-W29",
      dayIndex: 0,
      imageUrl: "",
      terms: [],
      decoType: "tape",
      angle: 0,
      createdAt: 1,
    })),
    mapVideoAssetRow: () => null,
    mapImageAssetRow: () => null,
  }));

  const response = await requestJson(app, { method: "GET", path: "/api/db/cards?page=1&pageSize=12" });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    cards: [{
      id: "card-1",
      weekId: "2026-W29",
      dayIndex: 0,
      imageUrl: "",
      terms: [],
      decoType: "tape",
      angle: 0,
      createdAt: 1,
    }],
    total: 1,
    page: 1,
    pageSize: 12,
    totalPages: 1,
  });
  assert.deepEqual(values, [[USER.id], [USER.id, 12, 0]]);
});

test("card upsert keeps persistence and knowledge refresh in one transaction", async () => {
  const commands: string[] = [];
  const client = {
    async query(text: string) {
      const command = text.trim().split(/\s+/u)[0]!.toUpperCase();
      commands.push(command);
      return command === "INSERT" ? { rows: [{ id: "card-1" }] } : { rows: [] };
    },
    release() { commands.push("RELEASE"); },
  };
  const pool = {
    async connect() { return client; },
  } as unknown as pg.Pool;
  const app = authenticatedApp();
  app.use("/api/db", createCardUpsertRouter({
    pool,
    getDirectUploadId: () => "",
    claimDirectPrimaryCard: async () => undefined,
    claimDirectDocumentCard: async () => undefined,
    normalizeInternalProxyUrl: (value) => value || "",
    refreshKnowledgeCard: async () => { commands.push("KNOWLEDGE"); },
  }));

  const response = await requestJson(app, {
    method: "POST",
    path: "/api/db/cards",
    body: {
      id: "card-1",
      weekId: "2026-W29",
      dayIndex: 0,
      terms: ["knowledge"],
      decoType: "tape",
      angle: 0,
      type: "md",
      mdContent: "content",
    },
  });
  assert.deepEqual(response, { status: 200, body: { success: true } });
  assert.deepEqual(commands, ["BEGIN", "INSERT", "KNOWLEDGE", "COMMIT", "RELEASE"]);
});
