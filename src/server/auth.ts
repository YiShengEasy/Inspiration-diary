import crypto from "crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import type pg from "pg";

export interface AuthUser {
  id: string;
  email: string;
  phone?: string | null;
  displayName: string | null;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  sessionId?: string;
}

interface UserRow {
  id: string;
  email: string;
  phone?: string | null;
  display_name: string | null;
  role: string | null;
  password_hash?: string;
  expires_at?: string | number;
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

function safeUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone || null,
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
  const result = await pool.query<UserRow>(
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

export function createAuthRouter(pool: pg.Pool): Router {
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
      const result = await pool.query<UserRow>(
        `INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'user', $4, $4)
         RETURNING id, email, display_name, role`,
        [email, passwordHash, displayName, createdAt]
      );
      const user = safeUser(result.rows[0]);
      const session = await createSession(pool, user.id, req);
      setSessionCookie(res, session.id, session.expiresAt);
      return res.json({ user });
    } catch (err: unknown) {
      console.error("Auth register error:", err);
      return res.status(500).json({ error: "注册失败" });
    }
  });

  router.post("/login", async (req: Request, res: Response) => {
    try {
      const email = normalizeEmail(String(req.body.email || ""));
      const password = String(req.body.password || "");
      const result = await pool.query<UserRow>(
        "SELECT id, email, password_hash, display_name, role FROM users WHERE email = $1",
        [email]
      );
      const row = result.rows[0];
      if (!row?.password_hash) return res.status(401).json({ error: "邮箱或密码不正确" });

      const ok = await verifyPassword(password, row.password_hash);
      if (!ok) return res.status(401).json({ error: "邮箱或密码不正确" });

      const user = safeUser(row);
      const session = await createSession(pool, user.id, req);
      setSessionCookie(res, session.id, session.expiresAt);
      return res.json({ user });
    } catch (err: unknown) {
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
    } catch (err: unknown) {
      console.error("Auth middleware error:", err);
      return res.status(500).json({ error: "鉴权失败" });
    }
  };
}
