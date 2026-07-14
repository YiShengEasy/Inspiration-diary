import { Router, type Response } from "express";
import type pg from "pg";

import { requireAuth, type AuthenticatedRequest } from "../auth";
import { createInviteCode, hashInviteCode } from "../inviteCodes";

const DEFAULT_INVITE_DAYS = 7;
const DEFAULT_BATCH_SIZE = 10;

function requireAdmin(req: AuthenticatedRequest, res: Response): boolean {
  if (req.user?.role === "admin") return true;
  res.status(403).json({ error: "需要管理员权限" });
  return false;
}

export function createInviteCodesRouter(pool: pg.Pool): Router {
  const router = Router();
  router.use(requireAuth(pool));

  router.get("/", async (req: AuthenticatedRequest, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const result = await pool.query(
        `SELECT ic.id, ic.code_hint, ic.code_value AS code, ic.created_at, ic.expires_at, ic.used_at, ic.revoked_at,
                used_user.email AS used_by_email
         FROM invite_codes ic
         LEFT JOIN users used_user ON used_user.id = ic.used_by_user_id
         ORDER BY ic.created_at DESC
         LIMIT 100`,
      );
      return res.json({ inviteCodes: result.rows });
    } catch (error) {
      console.error("List invite codes error:", error);
      return res.status(500).json({ error: "邀请码列表加载失败" });
    }
  });

  router.post("/", async (req: AuthenticatedRequest, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const client = await pool.connect();
    try {
      const now = Date.now();
      const expiresAt = now + DEFAULT_INVITE_DAYS * 24 * 60 * 60 * 1000;
      const inviteCodes: Array<Record<string, unknown>> = [];
      await client.query("BEGIN");
      for (let index = 0; index < DEFAULT_BATCH_SIZE; index += 1) {
        const code = createInviteCode();
        const result = await client.query(
          `INSERT INTO invite_codes (id, code_hash, code_hint, code_value, created_by_user_id, created_at, expires_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
           RETURNING id, code_hint, created_at, expires_at`,
          [hashInviteCode(code), code.slice(-4), code, req.user!.id, now + index, expiresAt],
        );
        inviteCodes.push({ ...result.rows[0], code });
      }
      await client.query("COMMIT");
      return res.status(201).json({ inviteCodes });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      console.error("Create invite code error:", error);
      return res.status(500).json({ error: "邀请码生成失败" });
    } finally {
      client.release();
    }
  });

  router.delete("/:id", async (req: AuthenticatedRequest, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const result = await pool.query(
        `UPDATE invite_codes
         SET revoked_at = $1
         WHERE id = $2 AND used_at IS NULL AND revoked_at IS NULL
         RETURNING id`,
        [Date.now(), req.params.id],
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "邀请码不存在或无法撤销" });
      return res.json({ success: true });
    } catch (error) {
      console.error("Revoke invite code error:", error);
      return res.status(500).json({ error: "邀请码撤销失败" });
    }
  });

  return router;
}
