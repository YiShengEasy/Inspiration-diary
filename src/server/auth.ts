import crypto from "crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import type pg from "pg";
import { createMiniSession, getMiniToken, missingRegistrationFields, revokeMiniSession } from "./miniprogramAuth";
import { exchangeWechatCode, resolveWechatPhone } from "./wechat";

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

function isMiniPasswordLoginEnabled(): boolean {
  return (
    process.env.MINI_DEBUG_PASSWORD_LOGIN === "true" ||
    process.env.WECHAT_MOCK === "true" ||
    process.env.NODE_ENV !== "production"
  );
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
    `SELECT users.id, users.email, users.phone, users.display_name, users.role, sessions.expires_at
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

async function loadUserById(pool: pg.Pool, userId: string): Promise<AuthUser | null> {
  const result = await pool.query<UserRow>(
    "SELECT id, email, phone, display_name, role FROM users WHERE id = $1",
    [userId]
  );
  return result.rows[0] ? safeUser(result.rows[0]) : null;
}

export function getSessionId(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || null;
}

export function createAuthRouter(pool: pg.Pool): Router {
  const router = Router();

  router.post("/wechat-login", async (req: Request, res: Response) => {
    try {
      const code = String(req.body.code || "").trim();
      if (!code) return res.status(400).json({ error: "缺少微信登录 code" });

      const wechat = await exchangeWechatCode(code);
      const createdAt = nowMs();
      const identityResult = await pool.query(
        `INSERT INTO wechat_identities (mini_openid, unionid, created_at, updated_at)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT (mini_openid)
         DO UPDATE SET unionid = COALESCE(EXCLUDED.unionid, wechat_identities.unionid), updated_at = EXCLUDED.updated_at
         RETURNING id, user_id, phone`,
        [wechat.openid, wechat.unionid || null, createdAt]
      );
      const identity = identityResult.rows[0];
      const token = await createMiniSession(pool, identity.id, identity.user_id || null);
      const user = identity.user_id ? await loadUserById(pool, identity.user_id) : null;
      const accountState = user ? "registered" : "wechat_logged_in_unregistered";
      return res.json({
        token,
        accountState,
        user,
        missing: missingRegistrationFields(identity),
      });
    } catch (err: unknown) {
      console.error("WeChat login error:", err);
      return res.status(500).json({ error: "微信登录失败" });
    }
  });

  router.post("/wechat-phone", async (req: Request, res: Response) => {
    try {
      const token = getMiniToken(req);
      if (!token) return res.status(401).json({ error: "未登录" });

      const phoneCode = String(req.body.code || "").trim();
      if (!phoneCode) return res.status(400).json({ error: "缺少手机号授权 code" });

      const phone = await resolveWechatPhone(phoneCode);
      const session = await pool.query("SELECT identity_id FROM mini_program_sessions WHERE id = $1", [token]);
      const identityId = session.rows[0]?.identity_id;
      if (!identityId) return res.status(401).json({ error: "登录已过期" });

      await pool.query("UPDATE wechat_identities SET phone = $1, updated_at = $2 WHERE id = $3", [
        phone.phoneNumber,
        nowMs(),
        identityId,
      ]);
      return res.json({ phone: phone.phoneNumber });
    } catch (err: unknown) {
      console.error("WeChat phone error:", err);
      return res.status(500).json({ error: "手机号授权失败" });
    }
  });

  router.post("/complete-registration", async (req: Request, res: Response) => {
    const client = await pool.connect();
    try {
      const token = getMiniToken(req);
      if (!token) return res.status(401).json({ error: "未登录" });

      const identifier = String(req.body.identifier || req.body.phone || req.body.email || "").trim();
      const password = String(req.body.password || "");
      const displayName = String(req.body.displayName || "").trim() || null;
      if (!identifier) return res.status(400).json({ error: "请输入手机号或邮箱" });
      if (password.length < 8) return res.status(400).json({ error: "密码至少需要 8 位" });

      const sessionResult = await client.query(
        `SELECT s.id AS session_id, s.identity_id, i.user_id, i.phone
         FROM mini_program_sessions s
         INNER JOIN wechat_identities i ON i.id = s.identity_id
         WHERE s.id = $1`,
        [token]
      );
      const session = sessionResult.rows[0];
      if (!session) return res.status(401).json({ error: "登录已过期" });

      const isEmailIdentifier = isEmail(identifier);
      const email = isEmailIdentifier ? normalizeEmail(identifier) : `${identifier}@phone.local`;
      const phone = isEmailIdentifier ? session.phone || null : identifier;

      await client.query("BEGIN");
      const existing = await client.query("SELECT id FROM users WHERE email = $1 OR phone = $2", [email, phone]);
      if (existing.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "账号已存在，请直接登录或更换账号" });
      }

      const passwordHash = await hashPassword(password);
      const createdAt = nowMs();
      const userResult = await client.query<UserRow>(
        `INSERT INTO users (id, email, phone, password_hash, display_name, role, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'user', $5, $5)
         RETURNING id, email, phone, display_name, role`,
        [email, phone, passwordHash, displayName, createdAt]
      );
      const user = safeUser(userResult.rows[0]);
      await client.query("UPDATE wechat_identities SET user_id = $1, updated_at = $2 WHERE id = $3", [
        user.id,
        createdAt,
        session.identity_id,
      ]);
      await client.query("UPDATE mini_program_sessions SET user_id = $1 WHERE id = $2", [user.id, token]);
      await client.query("COMMIT");
      return res.json({ user, accountState: "registered", missing: [] });
    } catch (err: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);
      console.error("Complete registration error:", err);
      return res.status(500).json({ error: "注册失败" });
    } finally {
      client.release();
    }
  });

  router.get("/account-status", async (req: Request, res: Response) => {
    const token = getMiniToken(req);
    if (!token) return res.json({ accountState: "guest", user: null, missing: ["wechatLogin"] });

    const session = await pool.query(
      `SELECT i.user_id, i.phone
       FROM mini_program_sessions s
       INNER JOIN wechat_identities i ON i.id = s.identity_id
       WHERE s.id = $1 AND s.expires_at > $2`,
      [token, nowMs()]
    );
    const row = session.rows[0];
    if (!row) return res.status(401).json({ error: "登录已过期" });

    const user = row.user_id ? await loadUserById(pool, row.user_id) : null;
    return res.json({
      accountState: user ? "registered" : "wechat_logged_in_unregistered",
      user,
      missing: missingRegistrationFields(row),
    });
  });

  router.post("/miniprogram-logout", async (req: Request, res: Response) => {
    const token = getMiniToken(req);
    if (token) await revokeMiniSession(pool, token);
    return res.json({ success: true });
  });

  router.post("/miniprogram-password-login", async (req: Request, res: Response) => {
    try {
      if (!isMiniPasswordLoginEnabled()) return res.status(404).json({ error: "调试登录未开启" });

      const rawIdentifier = String(req.body.identifier || req.body.email || req.body.phone || "").trim();
      const isEmailIdentifier = isEmail(rawIdentifier);
      const identifier = isEmailIdentifier ? normalizeEmail(rawIdentifier) : rawIdentifier;
      const password = String(req.body.password || "");
      if (!identifier) return res.status(400).json({ error: "请输入邮箱或手机号" });

      const result = await pool.query<UserRow>(
        `SELECT id, email, phone, password_hash, display_name, role
         FROM users
         WHERE ${isEmailIdentifier ? "email" : "phone"} = $1`,
        [identifier]
      );
      const row = result.rows[0];
      if (!row?.password_hash) return res.status(401).json({ error: "邮箱/手机号或密码不正确" });

      const ok = await verifyPassword(password, row.password_hash);
      if (!ok) return res.status(401).json({ error: "邮箱/手机号或密码不正确" });

      const updatedAt = nowMs();
      const identityResult = await pool.query<{ id: string }>(
        `INSERT INTO wechat_identities (mini_openid, user_id, nickname, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (mini_openid)
         DO UPDATE SET user_id = EXCLUDED.user_id, nickname = EXCLUDED.nickname, updated_at = EXCLUDED.updated_at
         RETURNING id`,
        [`debug-password-${row.id}`, row.id, row.display_name || null, updatedAt]
      );
      const token = await createMiniSession(pool, identityResult.rows[0].id, row.id);
      const user = safeUser(row);
      return res.json({ token, accountState: "registered", user, missing: [] });
    } catch (err: unknown) {
      console.error("Mini program password login error:", err);
      return res.status(500).json({ error: "调试登录失败" });
    }
  });

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
      const rawIdentifier = String(req.body.identifier || req.body.email || "").trim();
      const isEmailIdentifier = isEmail(rawIdentifier);
      const identifier = isEmailIdentifier ? normalizeEmail(rawIdentifier) : rawIdentifier;
      const password = String(req.body.password || "");
      if (!identifier) return res.status(400).json({ error: "请输入邮箱或手机号" });

      const result = await pool.query<UserRow>(
        `SELECT id, email, phone, password_hash, display_name, role
         FROM users
         WHERE ${isEmailIdentifier ? "email" : "phone"} = $1`,
        [identifier]
      );
      const row = result.rows[0];
      if (!row?.password_hash) return res.status(401).json({ error: "邮箱/手机号或密码不正确" });

      const ok = await verifyPassword(password, row.password_hash);
      if (!ok) return res.status(401).json({ error: "邮箱/手机号或密码不正确" });

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
