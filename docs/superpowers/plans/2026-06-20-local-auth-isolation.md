# Local Auth Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PostgreSQL-backed multi-user authentication, user-scoped data access, and authenticated PhotoPrism image proxying to Inspiration Diary.

**Architecture:** Express owns authentication and sessions through `HttpOnly` cookies backed by PostgreSQL. All business SQL is scoped by `req.user.id`, and PhotoPrism remains server-only behind authenticated app proxy routes.

**Tech Stack:** React 19, Vite, Express 4, PostgreSQL via `pg`, TypeScript, `bcryptjs` password hashes, signed random session ids stored in PostgreSQL, Docker production runtime.

---

## File Structure

- Modify `package.json` and `package-lock.json`: add auth dependencies and smoke-test script.
- Create `src/server/auth.ts`: password hashing, session cookie helpers, session store, auth routes, and `requireAuth` middleware.
- Modify `server.ts`: wire auth middleware, initialize user-owned schema, scope SQL queries, protect APIs, and mount photo proxy routes.
- Modify `src/server/photoprism.ts`: add reusable PhotoPrism fetch helpers for thumbnail/full image proxying.
- Create `src/lib/authClient.ts`: frontend auth API helpers.
- Modify `src/lib/dbClient.ts`: add authenticated fetch wrapper and 401 handling for Postgres mode.
- Modify `src/App.tsx`: replace boolean login gate with user/session state, bootstrap `/api/auth/me`, clear data on logout/401.
- Modify `src/components/LoginScreen.tsx`: restore real login/register submit behavior while keeping the current style and animation.
- Create `scripts/auth-smoke.mjs`: endpoint-level security checks for auth, ownership, pagination, and logout.
- Modify `.env.example`: document auth-related environment variables.

## Task 1: Add Auth Dependencies And Shared Types

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/server/auth.ts`

- [ ] **Step 1: Install password hashing dependency**

Run:

```bash
npm install bcryptjs
```

Expected:

```text
command exits 0 and package-lock.json records bcryptjs
```

- [ ] **Step 2: Add smoke script**

In `package.json`, update `scripts` to include:

```json
{
  "auth:smoke": "node scripts/auth-smoke.mjs"
}
```

Keep all existing scripts unchanged.

- [ ] **Step 3: Create initial auth module**

Create `src/server/auth.ts` with:

```ts
import crypto from "crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import type pg from "pg";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  sessionId?: string;
}

const SESSION_COOKIE_NAME = "inspiration_session";
const DEFAULT_SESSION_DAYS = 7;

function nowMs(): number {
  return Date.now();
}

function getSessionTtlMs(): number {
  const days = Number.parseInt(process.env.AUTH_SESSION_DAYS || String(DEFAULT_SESSION_DAYS), 10);
  return Math.max(1, days) * 24 * 60 * 60 * 1000;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeUser(row: any): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || null,
    role: row.role || "user",
  };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const item of header.split(";")) {
    const [rawKey, ...rawValue] = item.trim().split("=");
    if (!rawKey) continue;
    cookies[rawKey] = decodeURIComponent(rawValue.join("="));
  }
  return cookies;
}

function setSessionCookie(res: Response, sessionId: string, expiresAt: number): void {
  const secure = process.env.AUTH_COOKIE_SECURE === "true";
  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires: new Date(expiresAt),
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.AUTH_COOKIE_SECURE === "true",
    path: "/",
  });
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

async function createSession(pool: pg.Pool, userId: string, req: Request): Promise<{ id: string; expiresAt: number }> {
  const id = crypto.randomBytes(32).toString("base64url");
  const createdAt = nowMs();
  const expiresAt = createdAt + getSessionTtlMs();
  const userAgent = req.headers["user-agent"] || "";
  await pool.query(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, createdAt, expiresAt, createdAt, String(userAgent).slice(0, 500)]
  );
  return { id, expiresAt };
}

async function loadSession(pool: pg.Pool, sessionId: string): Promise<AuthUser | null> {
  const result = await pool.query(
    `SELECT users.id, users.email, users.display_name, users.role, sessions.expires_at
     FROM sessions
     INNER JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = $1`,
    [sessionId]
  );
  const row = result.rows[0];
  if (!row) return null;
  if (Number(row.expires_at) <= nowMs()) {
    await pool.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
    return null;
  }
  await pool.query("UPDATE sessions SET last_seen_at = $1 WHERE id = $2", [nowMs(), sessionId]);
  return safeUser(row);
}

export function getSessionId(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || null;
}

export function createAuthRouter(pool: pg.Pool) {
  const router = Router();

  router.post("/register", async (req: Request, res: Response) => {
    try {
      const email = normalizeEmail(String(req.body.email || ""));
      const password = String(req.body.password || "");
      const displayName = String(req.body.displayName || "").trim() || null;

      if (!isEmail(email)) return res.status(400).json({ error: "请输入有效邮箱" });
      if (password.length < 8) return res.status(400).json({ error: "密码至少需要 8 位" });

      const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
      if (existing.rows.length > 0) return res.status(409).json({ error: "邮箱或密码不正确" });

      const passwordHash = await hashPassword(password);
      const createdAt = nowMs();
      const result = await pool.query(
        `INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'user', $4, $4)
         RETURNING id, email, display_name, role`,
        [email, passwordHash, displayName, createdAt]
      );
      const user = safeUser(result.rows[0]);
      const session = await createSession(pool, user.id, req);
      setSessionCookie(res, session.id, session.expiresAt);
      return res.json({ user });
    } catch (err: any) {
      console.error("Auth register error:", err);
      return res.status(500).json({ error: "注册失败" });
    }
  });

  router.post("/login", async (req: Request, res: Response) => {
    try {
      const email = normalizeEmail(String(req.body.email || ""));
      const password = String(req.body.password || "");
      const result = await pool.query(
        "SELECT id, email, password_hash, display_name, role FROM users WHERE email = $1",
        [email]
      );
      const row = result.rows[0];
      if (!row) return res.status(401).json({ error: "邮箱或密码不正确" });
      const ok = await verifyPassword(password, row.password_hash);
      if (!ok) return res.status(401).json({ error: "邮箱或密码不正确" });
      const user = safeUser(row);
      const session = await createSession(pool, user.id, req);
      setSessionCookie(res, session.id, session.expiresAt);
      return res.json({ user });
    } catch (err: any) {
      console.error("Auth login error:", err);
      return res.status(500).json({ error: "登录失败" });
    }
  });

  router.post("/logout", async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    if (sessionId) await pool.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
    clearSessionCookie(res);
    return res.json({ success: true });
  });

  router.get("/me", async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    if (!sessionId) return res.status(401).json({ error: "未登录" });
    const user = await loadSession(pool, sessionId);
    if (!user) return res.status(401).json({ error: "登录已过期" });
    return res.json({ user });
  });

  return router;
}

export function requireAuth(pool: pg.Pool) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const sessionId = getSessionId(req);
      if (!sessionId) return res.status(401).json({ error: "未登录" });
      const user = await loadSession(pool, sessionId);
      if (!user) return res.status(401).json({ error: "登录已过期" });
      req.user = user;
      req.sessionId = sessionId;
      return next();
    } catch (err: any) {
      console.error("Auth middleware error:", err);
      return res.status(500).json({ error: "鉴权失败" });
    }
  };
}
```

- [ ] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected:

```text
no TypeScript errors
```

- [ ] **Step 5: Commit**

Run:

```bash
git add package.json package-lock.json src/server/auth.ts
git commit -m "feat: add local auth primitives"
```

Expected:

```text
commit command exits 0
```

## Task 2: Initialize Auth And User-Owned Schema

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: Import auth helpers**

At the top of `server.ts`, add:

```ts
import { createAuthRouter, requireAuth, type AuthenticatedRequest } from "./src/server/auth";
```

- [ ] **Step 2: Add user-owned schema SQL to `initDb`**

Inside `initDb`, before creating `notes`, add:

```ts
await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
await client.query(`
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );
`);
await client.query(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    last_seen_at BIGINT NOT NULL,
    user_agent TEXT
  );
`);
await client.query("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);");
await client.query("CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);");
```

- [ ] **Step 3: Add ownership columns and indexes**

After creating existing `notes`, `cards`, and `settings`, add:

```ts
await client.query("ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;");
await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;");
await client.query("ALTER TABLE settings ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;");
await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_created_at ON cards(user_id, created_at DESC);");
await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_week_created_at ON cards(user_id, week_id, created_at);");
await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_user_week ON notes(user_id, week_id);");
await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_user_key ON settings(user_id, key);");
```

- [ ] **Step 4: Backfill existing rows to first local user**

After ownership columns are added, add:

```ts
const userCount = await client.query("SELECT COUNT(*)::int AS count FROM users");
if (Number(userCount.rows[0]?.count || 0) === 0) {
  const bootstrapEmail = process.env.AUTH_BOOTSTRAP_EMAIL || "local-admin@example.com";
  const bootstrapPassword = process.env.AUTH_BOOTSTRAP_PASSWORD;
  if (!bootstrapPassword) {
    console.warn("AUTH_BOOTSTRAP_PASSWORD is not set. Existing data will be assigned after first registration.");
  } else {
    const bcrypt = await import("bcryptjs");
    const passwordHash = await bcrypt.default.hash(bootstrapPassword, 12);
    await client.query(
      `INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'Local Admin', 'admin', $3, $3)
       ON CONFLICT (email) DO NOTHING`,
      [bootstrapEmail.trim().toLowerCase(), passwordHash, Date.now()]
    );
  }
}

const ownerResult = await client.query("SELECT id FROM users ORDER BY created_at ASC LIMIT 1");
const ownerId = ownerResult.rows[0]?.id;
if (ownerId) {
  await client.query("UPDATE notes SET user_id = $1 WHERE user_id IS NULL", [ownerId]);
  await client.query("UPDATE cards SET user_id = $1 WHERE user_id IS NULL", [ownerId]);
  await client.query("UPDATE settings SET user_id = $1 WHERE user_id IS NULL", [ownerId]);
}
```

- [ ] **Step 5: Mount auth routes**

After `pgPool` is initialized and before protected business routes are defined, add:

```ts
if (pgPool) {
  app.use("/api/auth", createAuthRouter(pgPool));
}
```

- [ ] **Step 6: Run lint and build**

Run:

```bash
npm run lint
npm run build
```

Expected:

```text
no TypeScript errors
dist/server.cjs generated
```

- [ ] **Step 7: Commit**

Run:

```bash
git add server.ts
git commit -m "feat: initialize auth schema"
```

Expected:

```text
commit command exits 0
```

## Task 3: Protect API Routes And Scope SQL By User

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: Create protected middleware variable**

Before the first protected API route in `server.ts`, add:

```ts
const requirePostgresAuth = (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  return requireAuth(pgPool)(req, res, next);
};
```

- [ ] **Step 2: Protect AI and upload routes**

Change these route declarations:

```ts
app.post("/api/analyze-image", async (req, res) => {
app.post("/api/store-image", async (req, res) => {
app.post("/api/test-model", async (req, res) => {
```

to:

```ts
app.post("/api/analyze-image", requirePostgresAuth, async (req, res) => {
app.post("/api/store-image", requirePostgresAuth, async (req, res) => {
app.post("/api/test-model", requirePostgresAuth, async (req, res) => {
```

- [ ] **Step 3: Scope note read**

Replace the note read query with:

```ts
const authReq = req as AuthenticatedRequest;
const result = await pgPool.query(
  "SELECT week_id, note, height, updated_at FROM notes WHERE user_id = $1 AND week_id = $2",
  [authReq.user!.id, req.params.weekId]
);
```

- [ ] **Step 4: Scope note upsert**

Replace note upsert SQL with:

```ts
const authReq = req as AuthenticatedRequest;
await pgPool.query(
  `INSERT INTO notes (user_id, week_id, note, height, updated_at)
   VALUES ($1, $2, $3, $4, $5)
   ON CONFLICT (user_id, week_id)
   DO UPDATE SET note = EXCLUDED.note, height = EXCLUDED.height, updated_at = EXCLUDED.updated_at`,
  [authReq.user!.id, weekId, note, height, Date.now()]
);
```

- [ ] **Step 5: Scope card list and pagination**

For `GET /api/db/cards`, add:

```ts
const authReq = req as AuthenticatedRequest;
const userId = authReq.user!.id;
```

Change week-specific query to:

```ts
const result = await pgPool.query(
  `SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, terms, deco_type, angle, created_at
   FROM cards
   WHERE user_id = $1 AND week_id = $2
   ORDER BY day_index ASC, created_at ASC`,
  [userId, weekId]
);
```

Initialize all-history `values` with:

```ts
const whereClauses: string[] = ["user_id = $1"];
const values: Array<string | number> = [userId];
```

Keep the existing `q`, `LIMIT`, and `OFFSET` parameter construction.

- [ ] **Step 6: Scope card upsert**

Replace card upsert SQL with:

```ts
const authReq = req as AuthenticatedRequest;
await pgPool.query(
  `INSERT INTO cards (id, user_id, week_id, day_index, image_url, thumbnail_url, photo_uid, terms, terms_text, deco_type, angle, created_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, array_to_string($8::text[], ' '), $9, $10, $11)
   ON CONFLICT (id)
   DO UPDATE SET week_id = EXCLUDED.week_id, day_index = EXCLUDED.day_index, image_url = EXCLUDED.image_url,
                 thumbnail_url = EXCLUDED.thumbnail_url, photo_uid = EXCLUDED.photo_uid,
                 terms = EXCLUDED.terms, terms_text = EXCLUDED.terms_text, deco_type = EXCLUDED.deco_type,
                 angle = EXCLUDED.angle, created_at = EXCLUDED.created_at
   WHERE cards.user_id = EXCLUDED.user_id`,
  [id, authReq.user!.id, weekId, dayIndex, imageUrl, thumbnailUrl || "", photoUid || "", terms, decoType, angle, createdAt || Date.now()]
);
```

- [ ] **Step 7: Scope delete and term update**

Replace delete with:

```ts
const authReq = req as AuthenticatedRequest;
const result = await pgPool.query("DELETE FROM cards WHERE id = $1 AND user_id = $2", [req.params.id, authReq.user!.id]);
if (result.rowCount === 0) return res.status(404).json({ error: "Card not found" });
```

Replace term update with:

```ts
const authReq = req as AuthenticatedRequest;
const result = await pgPool.query(
  "UPDATE cards SET terms = $1, terms_text = array_to_string($1::text[], ' ') WHERE id = $2 AND user_id = $3",
  [terms, req.params.id, authReq.user!.id]
);
if (result.rowCount === 0) return res.status(404).json({ error: "Card not found" });
```

- [ ] **Step 8: Scope settings**

Replace settings read query with:

```ts
const authReq = req as AuthenticatedRequest;
const result = await pgPool.query("SELECT key, value FROM settings WHERE user_id = $1", [authReq.user!.id]);
```

Replace settings upsert SQL with:

```ts
const authReq = req as AuthenticatedRequest;
await pgPool.query(
  `INSERT INTO settings (user_id, key, value, updated_at) VALUES ($1, $2, $3, $4)
   ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
  [authReq.user!.id, key, value, now]
);
```

- [ ] **Step 9: Protect all database route declarations**

Add `requirePostgresAuth` to:

```ts
app.get("/api/db/notes/:weekId", requirePostgresAuth, async (req, res) => {
app.post("/api/db/notes", requirePostgresAuth, async (req, res) => {
app.get("/api/db/cards", requirePostgresAuth, async (req, res) => {
app.post("/api/db/cards", requirePostgresAuth, async (req, res) => {
app.delete("/api/db/cards/:id", requirePostgresAuth, async (req, res) => {
app.put("/api/db/cards/:id/terms", requirePostgresAuth, async (req, res) => {
app.get("/api/db/settings", requirePostgresAuth, async (req, res) => {
app.post("/api/db/settings", requirePostgresAuth, async (req, res) => {
```

- [ ] **Step 10: Run lint and build**

Run:

```bash
npm run lint
npm run build
```

Expected:

```text
no TypeScript errors
dist/server.cjs generated
```

- [ ] **Step 11: Commit**

Run:

```bash
git add server.ts
git commit -m "feat: scope APIs by authenticated user"
```

Expected:

```text
commit command exits 0
```

## Task 4: Add Authenticated PhotoPrism Read Proxy

**Files:**
- Modify: `src/server/photoprism.ts`
- Modify: `server.ts`

- [ ] **Step 1: Export PhotoPrism URL resolver and authenticated fetch**

In `src/server/photoprism.ts`, export:

```ts
export async function buildPhotoPrismReadUrls(hash: string): Promise<{ thumbnailUrl: string; imageUrl: string }> {
  const config = getConfig();
  const session = await login(config);
  const clientConfig = await loadClientConfig(config, session);
  return buildPhotoUrls(config, clientConfig, hash);
}

export async function fetchPhotoPrismImage(url: string): Promise<Response> {
  return fetch(url);
}
```

- [ ] **Step 2: Store PhotoPrism hash with cards**

Add a `photo_hash TEXT` column in `server.ts` schema initialization:

```ts
await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS photo_hash TEXT;");
await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_photo_uid ON cards(user_id, photo_uid);");
```

Extend `mapCards` to include:

```ts
photoHash: row.photo_hash || "",
```

Accept `photoHash` in card body:

```ts
const { id, weekId, dayIndex, imageUrl, thumbnailUrl, photoUid, photoHash, terms, decoType, angle, createdAt } = req.body;
```

Add `photo_hash` to insert/update SQL and pass `photoHash || ""`.

- [ ] **Step 3: Return hash from upload**

In `storeImageInPhotoPrism`, add `photoHash` to `StoredPhotoPrismImage`:

```ts
export interface StoredPhotoPrismImage {
  photoUid: string;
  photoHash: string;
  imageUrl: string;
  thumbnailUrl: string;
}
```

Return:

```ts
return {
  photoUid,
  photoHash: hash,
  ...buildPhotoUrls(config, clientConfig, hash),
};
```

- [ ] **Step 4: Add proxy routes**

In `server.ts`, import:

```ts
import { buildPhotoPrismReadUrls, fetchPhotoPrismImage, storeImageInPhotoPrism } from "./src/server/photoprism";
```

Add route:

```ts
app.get("/api/photos/:photoUid/:variant", requirePostgresAuth, async (req, res) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  const authReq = req as AuthenticatedRequest;
  const variant = req.params.variant;
  if (variant !== "thumb" && variant !== "full") {
    return res.status(404).json({ error: "Photo not found" });
  }

  const result = await pgPool.query(
    "SELECT photo_hash FROM cards WHERE user_id = $1 AND photo_uid = $2 LIMIT 1",
    [authReq.user!.id, req.params.photoUid]
  );
  const photoHash = result.rows[0]?.photo_hash;
  if (!photoHash) return res.status(404).json({ error: "Photo not found" });

  const urls = await buildPhotoPrismReadUrls(photoHash);
  const upstream = await fetchPhotoPrismImage(variant === "thumb" ? urls.thumbnailUrl : urls.imageUrl);
  if (!upstream.ok || !upstream.body) {
    return res.status(502).json({ error: "Photo fetch failed" });
  }

  res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=300");
  const arrayBuffer = await upstream.arrayBuffer();
  return res.send(Buffer.from(arrayBuffer));
});
```

- [ ] **Step 5: Run lint and build**

Run:

```bash
npm run lint
npm run build
```

Expected:

```text
no TypeScript errors
dist/server.cjs generated
```

- [ ] **Step 6: Commit**

Run:

```bash
git add server.ts src/server/photoprism.ts
git commit -m "feat: proxy photoprism reads"
```

Expected:

```text
commit command exits 0
```

## Task 5: Add Frontend Auth Client And Authenticated Fetch

**Files:**
- Create: `src/lib/authClient.ts`
- Modify: `src/lib/dbClient.ts`

- [ ] **Step 1: Create auth client**

Create `src/lib/authClient.ts`:

```ts
export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
}

export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthRequiredError";
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || res.statusText);
  }
  return body as T;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (res.status === 401) return null;
  const body = await parseJson<{ user: AuthUser }>(res);
  return body.user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await parseJson<{ user: AuthUser }>(res);
  return body.user;
}

export async function register(email: string, password: string): Promise<AuthUser> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await parseJson<{ user: AuthUser }>(res);
  return body.user;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(input, {
    ...init,
    credentials: "same-origin",
  });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent("auth:required"));
    throw new AuthRequiredError();
  }
  return res;
}
```

- [ ] **Step 2: Use `authFetch` in Postgres db client**

In `src/lib/dbClient.ts`, import:

```ts
import { authFetch } from "./authClient";
```

Replace Postgres-mode `fetch(` calls with `authFetch(` for:

- `/api/db/cards`
- `/api/db/notes`
- `/api/db/settings`

Keep Firestore code unchanged.

- [ ] **Step 3: Preserve JSON headers**

For every POST/PUT call changed to `authFetch`, keep:

```ts
headers: { "Content-Type": "application/json" }
```

Expected behavior:

```text
credentials are sent automatically and existing request bodies remain unchanged
```

- [ ] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected:

```text
no TypeScript errors
```

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/authClient.ts src/lib/dbClient.ts
git commit -m "feat: add frontend auth client"
```

Expected:

```text
commit command exits 0
```

## Task 6: Restore Real Login/Register Flow In UI

**Files:**
- Modify: `src/components/LoginScreen.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Change LoginScreen props**

In `src/components/LoginScreen.tsx`, replace props with:

```ts
interface LoginScreenProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, password: string) => Promise<void>;
}
```

- [ ] **Step 2: Restore loading and validation**

Add state:

```ts
const [isSubmitting, setIsSubmitting] = useState(false);
```

Replace `handleSubmit` with:

```ts
const handleSubmit = async (e: FormEvent) => {
  e.preventDefault();
  setError(null);

  if (!email.trim()) {
    setError("请输入邮箱");
    return;
  }
  if (password.length < 8) {
    setError("密码至少需要 8 位");
    return;
  }

  setIsSubmitting(true);
  try {
    if (isLoginMode) {
      await onLogin(email, password);
    } else {
      await onRegister(email, password);
    }
  } catch (err: any) {
    setError(err.message || "操作失败");
  } finally {
    setIsSubmitting(false);
  }
};
```

- [ ] **Step 3: Disable submit while loading**

On the submit button, add:

```tsx
disabled={isSubmitting}
```

Change button text to:

```tsx
<span className="tracking-widest">{isSubmitting ? "请稍候" : isLoginMode ? "启程" : "凝结"}</span>
```

- [ ] **Step 4: Add App auth state**

In `src/App.tsx`, import:

```ts
import { getCurrentUser, login, logout, register, type AuthUser } from "./lib/authClient";
```

Add state:

```ts
const [authUser, setAuthUser] = useState<AuthUser | null>(null);
const [isCheckingAuth, setIsCheckingAuth] = useState(true);
```

- [ ] **Step 5: Bootstrap current user**

Add effect:

```ts
useEffect(() => {
  let alive = true;
  getCurrentUser()
    .then((user) => {
      if (alive) setAuthUser(user);
    })
    .finally(() => {
      if (alive) setIsCheckingAuth(false);
    });
  return () => {
    alive = false;
  };
}, []);
```

- [ ] **Step 6: Handle auth-required event**

Add effect:

```ts
useEffect(() => {
  const handler = () => {
    setAuthUser(null);
    setCards([]);
    setAllCardsPageCards([]);
  };
  window.addEventListener("auth:required", handler);
  return () => window.removeEventListener("auth:required", handler);
}, []);
```

- [ ] **Step 7: Wire login screen**

Replace the unauthenticated render branch with:

```tsx
if (isCheckingAuth) {
  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex items-center justify-center text-stone-600 dark:text-stone-300">
      正在确认登录状态...
    </div>
  );
}

if (!authUser) {
  return (
    <LoginScreen
      onLogin={async (email, password) => {
        const user = await login(email, password);
        setAuthUser(user);
      }}
      onRegister={async (email, password) => {
        const user = await register(email, password);
        setAuthUser(user);
      }}
    />
  );
}
```

- [ ] **Step 8: Add logout control**

Add a compact logout button in the authenticated header near settings:

```tsx
<button
  type="button"
  onClick={async () => {
    await logout();
    setAuthUser(null);
    setCards([]);
    setAllCardsPageCards([]);
  }}
  className="px-3 py-2 text-xs border border-stone-300/60 dark:border-stone-700/60 rounded-md text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
>
  退出
</button>
```

- [ ] **Step 9: Gate data-loading effects**

For effects that call `subscribeCards`, `loadNote`, `loadSettings`, and `loadHistoricalCardsPage`, add an early return:

```ts
if (!authUser) return;
```

Include `authUser` in their dependency arrays.

- [ ] **Step 10: Run lint and build**

Run:

```bash
npm run lint
npm run build
```

Expected:

```text
no TypeScript errors
dist generated
```

- [ ] **Step 11: Commit**

Run:

```bash
git add src/App.tsx src/components/LoginScreen.tsx
git commit -m "feat: restore authenticated login flow"
```

Expected:

```text
commit command exits 0
```

## Task 7: Render App-Owned Photo URLs

**Files:**
- Modify: `src/types.ts`
- Modify: `src/App.tsx`
- Modify: `src/lib/dbClient.ts`

- [ ] **Step 1: Add optional `photoHash` type**

In `src/types.ts`, extend `ImageCard`:

```ts
photoHash?: string;
```

- [ ] **Step 2: Save PhotoPrism hash when uploading**

Where `/api/store-image` response is handled in `src/App.tsx`, read:

```ts
const stored = await storeRes.json();
const imageUrl = stored.photoUid ? `/api/photos/${encodeURIComponent(stored.photoUid)}/full` : stored.imageUrl;
const thumbnailUrl = stored.photoUid ? `/api/photos/${encodeURIComponent(stored.photoUid)}/thumb` : stored.thumbnailUrl;
```

When creating the card, set:

```ts
imageUrl,
thumbnailUrl,
photoUid: stored.photoUid || "",
photoHash: stored.photoHash || "",
```

- [ ] **Step 3: Preserve legacy cards**

In card rendering, keep current fallback behavior:

```ts
const displayImageUrl = card.thumbnailUrl || card.imageUrl;
```

Expected:

```text
new cards use /api/photos routes; old cards with existing URLs still render
```

- [ ] **Step 4: Include `photoHash` in dbClient payloads**

Ensure `saveCard(card)` sends the full card object with `photoHash`.

Expected:

```text
no custom filtering removes photoHash before POST /api/db/cards
```

- [ ] **Step 5: Run lint and build**

Run:

```bash
npm run lint
npm run build
```

Expected:

```text
no TypeScript errors
dist generated
```

- [ ] **Step 6: Commit**

Run:

```bash
git add src/types.ts src/App.tsx src/lib/dbClient.ts
git commit -m "feat: use authenticated photo URLs"
```

Expected:

```text
commit command exits 0
```

## Task 8: Add Auth Smoke Tests

**Files:**
- Create: `scripts/auth-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create smoke script**

Create `scripts/auth-smoke.mjs`:

```js
const baseUrl = process.env.AUTH_SMOKE_BASE_URL || "http://localhost:3005";
const suffix = Date.now();
const userA = { email: `auth-a-${suffix}@example.com`, password: "password-a-12345" };
const userB = { email: `auth-b-${suffix}@example.com`, password: "password-b-12345" };

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function cookieFrom(res) {
  const raw = res.headers.get("set-cookie") || "";
  const cookie = raw.split(";")[0];
  assert(cookie.includes("inspiration_session="), "missing session cookie");
  return cookie;
}

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

async function json(res) {
  return res.json().catch(() => ({}));
}

const unauth = await request("/api/db/cards?weekId=all&page=1&pageSize=1");
assert(unauth.status === 401, `expected unauth cards 401, got ${unauth.status}`);

const regA = await request("/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(userA),
});
assert(regA.ok, `register A failed ${regA.status}: ${JSON.stringify(await json(regA))}`);
const cookieA = cookieFrom(regA);

const regB = await request("/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(userB),
});
assert(regB.ok, `register B failed ${regB.status}: ${JSON.stringify(await json(regB))}`);
const cookieB = cookieFrom(regB);

const cardId = `smoke_${suffix}`;
const saveA = await request("/api/db/cards", {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieA },
  body: JSON.stringify({
    id: cardId,
    weekId: "2026-W25",
    dayIndex: 1,
    imageUrl: "/fake-full.jpg",
    thumbnailUrl: "/fake-thumb.jpg",
    photoUid: `photo_${suffix}`,
    photoHash: `hash_${suffix}`,
    terms: ["smoke-auth"],
    decoType: "tape",
    angle: 0,
    createdAt: Date.now(),
  }),
});
assert(saveA.ok, `save A card failed ${saveA.status}: ${JSON.stringify(await json(saveA))}`);

const listA = await request("/api/db/cards?weekId=all&page=1&pageSize=10&q=smoke-auth", {
  headers: { Cookie: cookieA },
});
const bodyA = await json(listA);
assert(listA.ok, `list A failed ${listA.status}`);
assert(bodyA.total === 1, `expected A total 1, got ${bodyA.total}`);

const listB = await request("/api/db/cards?weekId=all&page=1&pageSize=10&q=smoke-auth", {
  headers: { Cookie: cookieB },
});
const bodyB = await json(listB);
assert(listB.ok, `list B failed ${listB.status}`);
assert(bodyB.total === 0, `expected B total 0, got ${bodyB.total}`);

const deleteB = await request(`/api/db/cards/${encodeURIComponent(cardId)}`, {
  method: "DELETE",
  headers: { Cookie: cookieB },
});
assert(deleteB.status === 404, `expected B delete 404, got ${deleteB.status}`);

const logoutA = await request("/api/auth/logout", {
  method: "POST",
  headers: { Cookie: cookieA },
});
assert(logoutA.ok, `logout A failed ${logoutA.status}`);

const afterLogout = await request("/api/db/cards?weekId=all&page=1&pageSize=1", {
  headers: { Cookie: cookieA },
});
assert(afterLogout.status === 401, `expected after logout 401, got ${afterLogout.status}`);

console.log("auth smoke passed");
```

- [ ] **Step 2: Ensure package script exists**

In `package.json`, ensure:

```json
{
  "auth:smoke": "node scripts/auth-smoke.mjs"
}
```

- [ ] **Step 3: Run lint and build**

Run:

```bash
npm run lint
npm run build
```

Expected:

```text
no TypeScript errors
dist generated
```

- [ ] **Step 4: Commit**

Run:

```bash
git add scripts/auth-smoke.mjs package.json
git commit -m "test: add auth smoke coverage"
```

Expected:

```text
commit command exits 0
```

## Task 9: Update Environment Documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Document auth environment variables**

Add to `.env.example`:

```env
AUTH_SESSION_DAYS=7
AUTH_COOKIE_SECURE=false
AUTH_BOOTSTRAP_EMAIL=local-admin@example.com
AUTH_BOOTSTRAP_PASSWORD=
```

- [ ] **Step 2: Document login behavior**

Add to `README.md` under production Docker:

```markdown
## Local Authentication

The production app uses local PostgreSQL-backed users and server-side sessions.
Register the first user from the login screen, or set `AUTH_BOOTSTRAP_EMAIL`
and `AUTH_BOOTSTRAP_PASSWORD` before the first Docker start to create a local
administrator account.

All card, note, settings, AI, upload, and photo proxy APIs require login.
Sessions are stored in PostgreSQL and sent to the browser as an `HttpOnly`
cookie named `inspiration_session`.
```

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected:

```text
no TypeScript errors
```

- [ ] **Step 4: Commit**

Run:

```bash
git add .env.example README.md
git commit -m "docs: document local authentication"
```

Expected:

```text
commit command exits 0
```

## Task 10: Docker And Browser Verification

**Files:**
- No source files should be modified in this task unless verification exposes a defect.

- [ ] **Step 1: Rebuild production Docker**

Run:

```bash
npm run docker:prod:detached
```

Expected:

```text
inspiration-diary-app-1 Started
```

- [ ] **Step 2: Confirm container is running**

Run:

```bash
docker compose ps
```

Expected:

```text
output contains inspiration-diary-app-1, Up, and 0.0.0.0:3005->3000/tcp
```

- [ ] **Step 3: Run auth smoke**

Run:

```bash
npm run auth:smoke
```

Expected:

```text
auth smoke passed
```

- [ ] **Step 4: Browser verification without image preview confirmation**

Open `http://localhost:3005/` in the in-app browser and verify text/state only:

- login page appears while unauthenticated
- registering a fresh email enters the app
- refreshing keeps the user logged in
- all-history page loads and shows pagination
- logout returns to login screen

- [ ] **Step 5: Final status check**

Run:

```bash
git status --short
```

Expected:

```text
no unexpected uncommitted files from auth implementation
```

- [ ] **Step 6: Commit verification fixes only if needed**

If verification required a code fix, run:

```bash
git add <fixed-files>
git commit -m "fix: stabilize local auth flow"
```

Expected:

```text
commit command exits 0
```

## Self-Review

Spec coverage:

- PostgreSQL users and sessions are covered by Tasks 1 and 2.
- Protected APIs are covered by Task 3.
- User-scoped cards, notes, settings, and pagination are covered by Task 3.
- PhotoPrism upload protection and authenticated image proxying are covered by Task 4.
- Frontend login/register, `/api/auth/me`, 401 handling, and logout are covered by Tasks 5 and 6.
- App-owned image URLs are covered by Task 7.
- Smoke verification and Docker/browser checks are covered by Tasks 8 and 10.
- Environment documentation is covered by Task 9.

Placeholder scan:

- The plan contains concrete file paths, commands, expected results, and code snippets for each code-changing task.
- The plan contains only concrete work items.

Type consistency:

- `AuthUser`, `AuthenticatedRequest`, `authFetch`, and `photoHash` names are consistent across server, client, and smoke-test tasks.
