import { Router } from "express";
import type pg from "pg";

import type { AuthenticatedRequest } from "../auth.ts";

function getCurrentWeekId(now = new Date()): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const days = Math.floor(
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start.getTime()) / 86_400_000,
  );
  const week = Math.ceil((days + start.getUTCDay() + 1) / 7);
  return `${now.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function createMiniprogramRouter(pool: pg.Pool): Router {
  const router = Router();

  router.get("/me", async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const [inspirationCount, weekCount] = await Promise.all([
        pool.query("SELECT COUNT(*)::int AS count FROM cards WHERE user_id = $1", [userId]),
        pool.query("SELECT COUNT(*)::int AS count FROM cards WHERE user_id = $1 AND week_id = $2", [userId, getCurrentWeekId()]),
      ]);
      return res.json({
        user: req.user,
        stats: {
          inspirationCount: inspirationCount.rows[0]?.count || 0,
          weekRecordCount: weekCount.rows[0]?.count || 0,
          toolUsageCount: 0,
        },
        sync: { status: "ready" },
      });
    } catch (error: unknown) {
      console.error("Mini program me error:", error);
      return res.status(500).json({ error: "加载我的信息失败" });
    }
  });

  router.post("/tool-usage", (_req, res) => res.json({ success: true }));
  return router;
}
