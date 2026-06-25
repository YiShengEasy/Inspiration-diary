import crypto from "crypto";
import type { Request } from "express";
import type pg from "pg";
import type { AuthUser } from "./auth";

export type MiniAccountState = "guest" | "wechat_logged_in_unregistered" | "registered";

export interface MiniAuthResult {
  token: string;
  accountState: MiniAccountState;
  user: AuthUser | null;
  identityId: string;
  missing: string[];
}

export function nowMs(): number {
  return Date.now();
}

function miniSessionTtlMs(): number {
  const days = Number.parseInt(process.env.MINI_SESSION_DAYS || "30", 10);
  return Math.max(1, days) * 24 * 60 * 60 * 1000;
}

export function getMiniToken(req: Request): string | null {
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim() || null;

  const headerToken = req.headers["x-mini-session"];
  if (Array.isArray(headerToken)) return headerToken[0]?.trim() || null;
  if (typeof headerToken === "string" && headerToken.trim()) return headerToken.trim();

  const queryToken = req.query.miniToken || req.query.mini_session || req.query.token;
  if (Array.isArray(queryToken)) return String(queryToken[0] || "").trim() || null;
  return typeof queryToken === "string" && queryToken.trim() ? queryToken.trim() : null;
}

export async function createMiniSession(pool: pg.Pool, identityId: string, userId: string | null): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const createdAt = nowMs();
  const expiresAt = createdAt + miniSessionTtlMs();

  await pool.query(
    `INSERT INTO mini_program_sessions (id, identity_id, user_id, created_at, expires_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $4)`,
    [token, identityId, userId, createdAt, expiresAt]
  );

  return token;
}

export async function loadMiniSessionUser(pool: pg.Pool, token: string): Promise<AuthUser | null> {
  const result = await pool.query(
    `SELECT users.id, users.email, users.phone, users.display_name, users.role, sessions.expires_at
     FROM mini_program_sessions sessions
     INNER JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = $1`,
    [token]
  );
  const row = result.rows[0];
  if (!row) return null;

  if (Number(row.expires_at) <= nowMs()) {
    await pool.query("DELETE FROM mini_program_sessions WHERE id = $1", [token]);
    return null;
  }

  await pool.query("UPDATE mini_program_sessions SET last_seen_at = $1 WHERE id = $2", [nowMs(), token]);
  return {
    id: row.id,
    email: row.email,
    phone: row.phone || null,
    displayName: row.display_name || null,
    role: row.role || "user",
  };
}

export async function revokeMiniSession(pool: pg.Pool, token: string): Promise<void> {
  await pool.query("DELETE FROM mini_program_sessions WHERE id = $1", [token]);
}

export function missingRegistrationFields(row: { user_id?: string | null; phone?: string | null }): string[] {
  return row.user_id ? [] : row.phone ? ["password"] : ["phoneOrEmail", "password"];
}
