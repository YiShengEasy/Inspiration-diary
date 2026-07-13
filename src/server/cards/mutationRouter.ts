import { Router } from "express";
import type pg from "pg";

import type { AuthenticatedRequest } from "../auth.ts";
import { withDatabaseTransaction } from "../database/transaction.ts";

interface StorageAsset {
  storage_provider: string;
  storage_key: string;
}

export interface CardMutationRouterDependencies {
  pool: pg.Pool;
  knowledgeBaseEnabled: boolean;
  refreshKnowledgeCard: (client: pg.PoolClient, userId: string, cardId: string) => Promise<void>;
  deleteVideoStorageObject: (storageProvider: string, storageKey: string) => Promise<void>;
  deleteImageStorageObject: (storageProvider: string, storageKey: string) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Card operation failed";
}

export function createCardMutationRouter(deps: CardMutationRouterDependencies): Router {
  const router = Router();

  router.put("/cards/:id/favorite", async (req: AuthenticatedRequest, res) => {
    const favorite = req.body?.favorite;
    if (typeof favorite !== "boolean") return res.status(400).json({ error: "favorite boolean is required." });
    try {
      const favoritedAt = favorite ? Date.now() : null;
      const result = await deps.pool.query(
        `UPDATE cards SET is_favorite = $1, favorited_at = $2
         WHERE id = $3 AND user_id = $4 RETURNING id, is_favorite, favorited_at`,
        [favorite, favoritedAt, req.params.id, req.user!.id],
      );
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: "Card not found" });
      return res.json({
        id: row.id,
        isFavorite: Boolean(row.is_favorite),
        favoritedAt: row.favorited_at == null ? null : Number(row.favorited_at),
      });
    } catch (error: unknown) {
      console.error("Error updating card favorite:", error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.delete("/cards/:id", async (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    try {
      const result = await withDatabaseTransaction(deps.pool, async (client) => {
        const affectedBooks = await client.query<{ id: string }>(
          "SELECT id FROM inspiration_books WHERE user_id = $1 AND cover_card_id = $2",
          [userId, req.params.id],
        );
        const videoAssets = await client.query<StorageAsset>(
          "SELECT storage_provider, storage_key FROM video_assets WHERE user_id = $1 AND card_id = $2",
          [userId, req.params.id],
        );
        const imageAssets = await client.query<StorageAsset>(
          "SELECT storage_provider, storage_key FROM image_assets WHERE user_id = $1 AND card_id = $2",
          [userId, req.params.id],
        );
        const comboImages = await client.query<StorageAsset>(
          "SELECT storage_provider, storage_key FROM combo_images WHERE user_id = $1 AND card_id = $2",
          [userId, req.params.id],
        );
        const comboGenerations = await client.query<StorageAsset>(
          "SELECT storage_provider, storage_key FROM combo_generations WHERE user_id = $1 AND card_id = $2",
          [userId, req.params.id],
        );
        if (deps.knowledgeBaseEnabled) {
          await client.query(
            "DELETE FROM knowledge_nodes WHERE user_id = $1 AND entity_type = 'card' AND entity_id = $2",
            [userId, req.params.id],
          );
        }
        const deleted = await client.query("DELETE FROM cards WHERE id = $1 AND user_id = $2", [req.params.id, userId]);
        if (deleted.rowCount === 0) return null;
        for (const book of affectedBooks.rows) {
          await client.query(
            `UPDATE inspiration_books b SET cover_card_id = (
                 SELECT bc.card_id FROM inspiration_book_cards bc
                 INNER JOIN cards c ON c.id = bc.card_id AND c.user_id = $1
                 WHERE bc.user_id = $1 AND bc.book_id = $2
                   AND COALESCE(c.type, 'image') <> 'md' AND COALESCE(c.image_url, '') <> ''
                 ORDER BY bc.added_at ASC LIMIT 1), updated_at = $3
             WHERE b.id = $2 AND b.user_id = $1`,
            [userId, book.id, Date.now()],
          );
        }
        return {
          videoAssets: [...videoAssets.rows, ...comboGenerations.rows],
          imageAssets: [...imageAssets.rows, ...comboImages.rows],
        };
      });
      if (!result) return res.status(404).json({ error: "Card not found" });
      for (const asset of result.videoAssets) {
        await deps.deleteVideoStorageObject(asset.storage_provider, asset.storage_key).catch((error) => {
          console.error("Video asset cleanup error:", error);
        });
      }
      for (const asset of result.imageAssets) {
        await deps.deleteImageStorageObject(asset.storage_provider, asset.storage_key).catch((error) => {
          console.error("Image asset cleanup error:", error);
        });
      }
      return res.json({ success: true });
    } catch (error: unknown) {
      console.error("Error executing delete card query:", error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.put("/cards/:id/terms", async (req: AuthenticatedRequest, res) => {
    try {
      const found = await withDatabaseTransaction(deps.pool, async (client) => {
        const result = await client.query(
          "UPDATE cards SET terms = $1, terms_text = CONCAT_WS(' ', array_to_string($1::text[], ' '), md_name, md_summary, insight_note) WHERE id = $2 AND user_id = $3",
          [req.body.terms, req.params.id, req.user!.id],
        );
        if (result.rowCount === 0) return false;
        await deps.refreshKnowledgeCard(client, req.user!.id, req.params.id);
        return true;
      });
      return found ? res.json({ success: true }) : res.status(404).json({ error: "Card not found" });
    } catch (error: unknown) {
      console.error("Error executing update card tag terms query:", error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.put("/cards/:id/insight-note", async (req: AuthenticatedRequest, res) => {
    const insightNote = String(req.body.insightNote || "").trim().slice(0, 4000);
    try {
      const found = await withDatabaseTransaction(deps.pool, async (client) => {
        const result = await client.query(
          `UPDATE cards SET insight_note = $1,
             terms_text = CONCAT_WS(' ', array_to_string(terms, ' '), md_name, md_summary, $1::text)
           WHERE id = $2 AND user_id = $3`,
          [insightNote || null, req.params.id, req.user!.id],
        );
        if (result.rowCount === 0) return false;
        await deps.refreshKnowledgeCard(client, req.user!.id, req.params.id);
        return true;
      });
      return found ? res.json({ success: true }) : res.status(404).json({ error: "Card not found" });
    } catch (error: unknown) {
      console.error("Error updating insight note:", error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  return router;
}
