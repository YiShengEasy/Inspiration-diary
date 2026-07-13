import { Router, type Request } from "express";
import type pg from "pg";

import type { ImageAsset, ImageCard, VideoAsset } from "../../types.ts";
import type { AuthenticatedRequest } from "../auth.ts";

interface CardReadRouterDependencies {
  pool: pg.Pool;
  comboSummarySelect: string;
  comboSummarySelectForCard: string;
  mapCardRows: (rows: unknown[], req: Request) => ImageCard[];
  mapVideoAssetRow: (row: unknown, req: Request) => VideoAsset | null;
  mapImageAssetRow: (row: unknown, req: Request) => ImageAsset | null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createCardReadRouter(dependencies: CardReadRouterDependencies): Router {
  const {
    pool,
    comboSummarySelect,
    comboSummarySelectForCard,
    mapCardRows,
    mapVideoAssetRow,
    mapImageAssetRow,
  } = dependencies;
  const router = Router();

  router.get("/weeks/:weekId/summary", async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const weekId = String(req.params.weekId || "").trim();
      const statsResult = await pool.query(
        `SELECT day_index,
                COUNT(*)::int AS card_count,
                COUNT(*) FILTER (WHERE type = 'md')::int AS md_count,
                COALESCE(SUM(cardinality(terms)), 0)::int AS term_count
         FROM cards
         WHERE user_id = $1 AND week_id = $2
         GROUP BY day_index
         ORDER BY day_index ASC`,
        [userId, weekId],
      );
      const previewsResult = await pool.query(
        `WITH ranked AS (
           SELECT cards.*,
                  ROW_NUMBER() OVER (PARTITION BY day_index ORDER BY created_at DESC) AS preview_rank
           FROM cards
           WHERE user_id = $1 AND week_id = $2
         )
         SELECT c.id, c.week_id, c.day_index, c.image_url, c.thumbnail_url, c.photo_uid, c.photo_hash,
                c.terms, c.deco_type, c.angle, c.created_at, c.type, c.md_content, c.md_summary, c.md_name, c.insight_note, c.is_favorite, c.favorited_at,
                ${comboSummarySelectForCard},
                (SELECT COALESCE(json_agg(va ORDER BY va.created_at DESC), '[]'::json)
                 FROM video_assets va
                 WHERE va.user_id = c.user_id AND va.card_id = c.id) AS video_assets,
                '[]'::json AS image_assets
         FROM ranked c
         WHERE c.preview_rank <= 3
         ORDER BY c.day_index ASC, c.created_at DESC`,
        [userId, weekId],
      );
      const previews = mapCardRows(previewsResult.rows, req);
      const statsByDay = new Map(statsResult.rows.map((row) => [Number(row.day_index), row]));
      const days = Array.from({ length: 6 }, (_, dayIndex) => {
        const stats = statsByDay.get(dayIndex);
        return {
          dayIndex,
          count: Number(stats?.card_count || 0),
          previews: previews.filter((card) => Number(card.dayIndex) === dayIndex),
        };
      });
      return res.json({
        weekId,
        totalCards: statsResult.rows.reduce((sum, row) => sum + Number(row.card_count || 0), 0),
        mdCount: statsResult.rows.reduce((sum, row) => sum + Number(row.md_count || 0), 0),
        totalTerms: statsResult.rows.reduce((sum, row) => sum + Number(row.term_count || 0), 0),
        days,
      });
    } catch (error: unknown) {
      console.error("Error fetching week summary:", error);
      return res.status(500).json({ error: errorMessage(error, "Failed to fetch week summary.") });
    }
  });

  router.get("/cards", async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const weekId = req.query.weekId as string;
      const favoriteOnly = String(req.query.favorite || "").toLowerCase() === "true";
      const q = String(req.query.q || "").trim();
      const contentType = String(req.query.contentType || "all");
      const listView = String(req.query.view || "") === "list";
      const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
      const rawPageSize = Number.parseInt(String(req.query.pageSize || "12"), 10) || 12;
      const pageSize = Math.min(60, Math.max(1, rawPageSize));
      const offset = (page - 1) * pageSize;
      const whereClauses: string[] = ["user_id = $1"];
      const values: Array<string | number> = [userId];
      if (weekId && weekId !== "all") {
        values.push(weekId);
        whereClauses.push(`week_id = $${values.length}`);
      }
      const dayIndexValue = String(req.query.dayIndex ?? "").trim();
      if (dayIndexValue) {
        const dayIndex = Number.parseInt(dayIndexValue, 10);
        if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 5) {
          return res.status(400).json({ error: "dayIndex must be between 0 and 5." });
        }
        values.push(dayIndex);
        whereClauses.push(`day_index = $${values.length}`);
      }
      if (q && contentType === "tags") {
        values.push(`%${q}%`);
        whereClauses.push(`EXISTS (SELECT 1 FROM unnest(terms) AS term WHERE term ILIKE $${values.length})`);
      } else if (q) {
        values.push(`%${q}%`);
        whereClauses.push(`terms_text ILIKE $${values.length}`);
      }
      if (contentType === "image") whereClauses.push("COALESCE(type, 'image') <> 'md'");
      if (contentType === "md") whereClauses.push("type = 'md'");
      if (favoriteOnly) whereClauses.push("is_favorite = true");

      const whereSql = `WHERE ${whereClauses.join(" AND ")}`;
      const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM cards ${whereSql}`, values);
      const total = Number(countResult.rows[0]?.total || 0);

      values.push(pageSize);
      const limitParam = values.length;
      values.push(offset);
      const offsetParam = values.length;

      const imageAssetsSelect = listView
        ? "'[]'::json AS image_assets"
        : `(SELECT COALESCE(json_agg(ia ORDER BY ia.created_at DESC), '[]'::json)
           FROM image_assets ia
           WHERE ia.user_id = cards.user_id AND ia.card_id = cards.id) AS image_assets`;
      const result = await pool.query(
        `SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash, terms, deco_type, angle, created_at, type, md_content, md_summary, md_name, insight_note, is_favorite, favorited_at,
                ${comboSummarySelect},
                (SELECT COALESCE(json_agg(va ORDER BY va.created_at DESC), '[]'::json)
                 FROM video_assets va
                 WHERE va.user_id = cards.user_id AND va.card_id = cards.id) AS video_assets,
                ${imageAssetsSelect}
         FROM cards
         ${whereSql}
         ORDER BY ${weekId && weekId !== "all" && !dayIndexValue ? "day_index ASC, created_at DESC" : "created_at DESC"}
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
        values,
      );

      return res.json({
        cards: mapCardRows(result.rows, req),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (error: unknown) {
      console.error("Error executing fetch cards query:", error);
      return res.status(500).json({ error: errorMessage(error, "Failed to fetch cards.") });
    }
  });

  router.get("/cards/:id", async (req: AuthenticatedRequest, res) => {
    try {
      const result = await pool.query(
        `SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash,
                terms, deco_type, angle, created_at, type, md_content, md_summary, md_name, insight_note, is_favorite, favorited_at,
                ${comboSummarySelect},
                (SELECT COALESCE(json_agg(va ORDER BY va.created_at DESC), '[]'::json)
                 FROM video_assets va
                 WHERE va.user_id = cards.user_id AND va.card_id = cards.id) AS video_assets,
                (SELECT COALESCE(json_agg(ia ORDER BY ia.created_at DESC), '[]'::json)
                 FROM image_assets ia
                 WHERE ia.user_id = cards.user_id AND ia.card_id = cards.id) AS image_assets
         FROM cards
         WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.user!.id],
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Card not found" });
      return res.json(mapCardRows(result.rows, req)[0]);
    } catch (error: unknown) {
      console.error("Error fetching card detail:", error);
      return res.status(500).json({ error: errorMessage(error, "Failed to fetch card detail") });
    }
  });

  router.get("/cards/:id/videos", async (req: AuthenticatedRequest, res) => {
    try {
      const card = await pool.query("SELECT id FROM cards WHERE id = $1 AND user_id = $2", [req.params.id, req.user!.id]);
      if (card.rowCount === 0) return res.status(404).json({ error: "Card not found" });
      const result = await pool.query(
        `SELECT id, card_id, storage_provider, storage_key, original_name, mime_type, size_bytes, duration_ms, poster_url, created_at
         FROM video_assets
         WHERE card_id = $1 AND user_id = $2
         ORDER BY created_at DESC`,
        [req.params.id, req.user!.id],
      );
      return res.json(result.rows.map((row) => mapVideoAssetRow(row, req)));
    } catch (error: unknown) {
      console.error("Error fetching card videos:", error);
      return res.status(500).json({ error: errorMessage(error, "Failed to fetch card videos") });
    }
  });

  router.get("/cards/:id/images", async (req: AuthenticatedRequest, res) => {
    try {
      const card = await pool.query("SELECT id FROM cards WHERE id = $1 AND user_id = $2", [req.params.id, req.user!.id]);
      if (card.rowCount === 0) return res.status(404).json({ error: "Card not found" });
      const result = await pool.query(
        `SELECT id, card_id, storage_provider, storage_key, original_name, mime_type, size_bytes, created_at
         FROM image_assets
         WHERE card_id = $1 AND user_id = $2
         ORDER BY created_at DESC`,
        [req.params.id, req.user!.id],
      );
      return res.json(result.rows.map((row) => mapImageAssetRow(row, req)));
    } catch (error: unknown) {
      console.error("Error fetching card images:", error);
      return res.status(500).json({ error: errorMessage(error, "Failed to fetch card images") });
    }
  });

  return router;
}
