import { Router } from "express";
import type pg from "pg";

import type { AuthenticatedRequest } from "../auth.ts";

export function createNotesRouter(pool: pg.Pool): Router {
  const router = Router();

  router.get("/notes/:weekId", async (req: AuthenticatedRequest, res) => {
    try {
      const result = await pool.query(
        "SELECT week_id, note, height, updated_at FROM notes WHERE user_id = $1 AND week_id = $2",
        [req.user!.id, req.params.weekId],
      );
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: "Note not found" });
      return res.json({
        weekId: row.week_id,
        note: row.note,
        height: row.height,
        updatedAt: Number(row.updated_at),
      });
    } catch (error: unknown) {
      console.error("Error executing fetch note query:", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch note" });
    }
  });

  router.post("/notes", async (req: AuthenticatedRequest, res) => {
    try {
      const { weekId, note, height } = req.body;
      await pool.query(
        `INSERT INTO notes (user_id, week_id, note, height, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, week_id)
         DO UPDATE SET note = EXCLUDED.note, height = EXCLUDED.height, updated_at = EXCLUDED.updated_at`,
        [req.user!.id, weekId, note, height, Date.now()],
      );
      return res.json({ success: true });
    } catch (error: unknown) {
      console.error("Error executing upsert note query:", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save note" });
    }
  });

  return router;
}
