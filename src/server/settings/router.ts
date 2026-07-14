import { Router } from "express";
import type pg from "pg";

import type { AuthenticatedRequest } from "../auth.ts";
import { withDatabaseTransaction } from "../database/transaction.ts";

const SERVER_ONLY_AI_KEYS = new Set([
  "custom_provider",
  "custom_gemini_api_key",
  "custom_gemini_base_url",
  "custom_gemini_model",
  "custom_anthropic_auth_token",
  "custom_anthropic_base_url",
  "custom_anthropic_model",
  "custom_thirdparty_api_key",
  "custom_thirdparty_base_url",
  "custom_thirdparty_model",
  "custom_thirdparty_thinking",
]);

export function createSettingsRouter(pool: pg.Pool): Router {
  const router = Router();

  router.get("/settings", async (req: AuthenticatedRequest, res) => {
    try {
      const result = await pool.query("SELECT key, value FROM settings WHERE user_id = $1", [req.user!.id]);
      const settings: Record<string, string> = {};
      for (const row of result.rows) {
        if (!SERVER_ONLY_AI_KEYS.has(row.key)) settings[row.key] = row.value;
      }
      return res.json(settings);
    } catch (error: unknown) {
      console.error("Error fetching settings:", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load settings" });
    }
  });

  router.post("/settings", async (req: AuthenticatedRequest, res) => {
    try {
      const entries = Object.entries(req.body as Record<string, string>);
      if (entries.some(([key]) => SERVER_ONLY_AI_KEYS.has(key))) {
        return res.status(400).json({ error: "AI provider configuration is server-only." });
      }
      const now = Date.now();
      await withDatabaseTransaction(pool, async (client) => {
        for (const [key, value] of entries) {
          await client.query(
            `INSERT INTO settings (user_id, key, value, updated_at) VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
            [req.user!.id, key, value, now],
          );
        }
      });
      return res.json({ success: true });
    } catch (error: unknown) {
      console.error("Error saving settings:", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save settings" });
    }
  });

  return router;
}
