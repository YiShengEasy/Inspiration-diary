import crypto from "crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import type pg from "pg";

import type { ComboGeneration, ComboImage, ImageCard } from "../../types.ts";
import type { AuthenticatedRequest } from "../auth.ts";
import { withDatabaseTransaction } from "../database/transaction.ts";
import type { ObjectStorageProvider } from "../storage/types.ts";

interface ComboRouterDependencies {
  pool: pg.Pool;
  imageUploadMiddleware: RequestHandler;
  videoUploadMiddleware: RequestHandler;
  supportedImageMimeTypes: ReadonlySet<string>;
  supportedVideoMimeTypes: ReadonlySet<string>;
  imageStorage: ObjectStorageProvider;
  videoStorage: ObjectStorageProvider;
  comboSummarySelect: string;
  getDirectUploadId: (req: Request, field?: string) => string;
  claimDirectComboImage: (req: AuthenticatedRequest, res: Response, uploadId: string) => Promise<unknown>;
  claimDirectComboGeneration: (req: AuthenticatedRequest, res: Response, uploadId: string) => Promise<unknown>;
  getImageExtension: (filename: string, mimeType: string) => string;
  getVideoExtension: (filename: string, mimeType: string) => string;
  sanitizeStorageSegment: (value: string) => string;
  deleteImageStorageObject: (storageProvider: string, storageKey: string) => Promise<void>;
  deleteVideoStorageObject: (storageProvider: string, storageKey: string) => Promise<void>;
  normalizeImageRole: (value: unknown) => "character" | "scene" | "story" | "other";
  mapComboImageRow: (row: unknown, req: Request) => ComboImage | null;
  mapComboGenerationRow: (row: unknown, req: Request) => ComboGeneration | null;
  mapCardRows: (rows: unknown[], req: Request) => ImageCard[];
  refreshComboCardSearchText: (
    client: Pick<pg.PoolClient, "query">,
    userId: string,
    cardId: string,
  ) => Promise<void>;
  refreshKnowledgeCard: (
    client: Pick<pg.PoolClient, "query">,
    userId: string,
    cardId: string,
  ) => Promise<void>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createComboRouter(dependencies: ComboRouterDependencies): Router {
  const {
    pool,
    imageUploadMiddleware,
    videoUploadMiddleware,
    supportedImageMimeTypes,
    supportedVideoMimeTypes,
    imageStorage,
    videoStorage,
    comboSummarySelect,
    getDirectUploadId,
    claimDirectComboImage,
    claimDirectComboGeneration,
    getImageExtension,
    getVideoExtension,
    sanitizeStorageSegment,
    deleteImageStorageObject,
    deleteVideoStorageObject,
    normalizeImageRole,
    mapComboImageRow,
    mapComboGenerationRow,
    mapCardRows,
    refreshComboCardSearchText,
    refreshKnowledgeCard,
  } = dependencies;
  const router = Router();

  router.post("/combo-cards", async (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const now = Date.now();
    const id = String(req.body.id || `combo_${crypto.randomUUID()}`).trim();
    const weekId = String(req.body.weekId || "").trim();
    const dayIndex = Number.isFinite(Number(req.body.dayIndex)) ? Number(req.body.dayIndex) : 0;
    const bookId = String(req.body.bookId || "").trim();
    const title = String(req.body.title || "组合灵感").trim().slice(0, 120) || "组合灵感";
    const terms = Array.isArray(req.body.terms) && req.body.terms.length
      ? req.body.terms.map(String).map((term: string) => term.trim()).filter(Boolean).slice(0, 8)
      : ["组合灵感", "视频创作"];
    const insightNote = String(req.body.insightNote || "").trim();

    if (!id) return res.status(400).json({ error: "id is required." });
    if (!weekId) return res.status(400).json({ error: "weekId is required." });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO cards (id, user_id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash, terms, terms_text, deco_type, angle, created_at, type, md_content, md_summary, md_name, insight_note)
         VALUES ($1, $2, $3, $4, '', '', '', '', $5, $6, 'washi', 0, $7, 'combo', NULL, $8, $9, $10)`,
        [id, userId, weekId, dayIndex, terms, [...terms, title, insightNote].filter(Boolean).join(" "), now, "多图组合与视频生成记录", title, insightNote || null],
      );

      if (bookId) {
        const book = await client.query("SELECT id FROM inspiration_books WHERE id = $1 AND user_id = $2", [bookId, userId]);
        if (book.rowCount > 0) {
          await client.query(
            `INSERT INTO inspiration_book_cards (user_id, book_id, card_id, added_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, book_id, card_id) DO NOTHING`,
            [userId, bookId, id, now],
          );
          await client.query("UPDATE inspiration_books SET updated_at = $1 WHERE id = $2 AND user_id = $3", [now, bookId, userId]);
        }
      }

      await refreshKnowledgeCard(client, userId, id);
      await client.query("COMMIT");

      const cardResult = await pool.query(
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
        [id, userId],
      );
      return res.json({ card: mapCardRows(cardResult.rows, req)[0] });
    } catch (error: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);
      console.error("Combo card create error:", error);
      return res.status(500).json({ error: errorMessage(error, "Failed to create combo card.") });
    } finally {
      client.release();
    }
  });

  router.get("/cards/:id/combo", async (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const cardId = req.params.id;
    try {
      const cardResult = await pool.query(
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
         WHERE id = $1 AND user_id = $2 AND type = 'combo'`,
        [cardId, userId],
      );
      if (!cardResult.rows[0]) return res.status(404).json({ error: "Combo card not found." });
      const images = await pool.query(
        `SELECT id, card_id, role, storage_provider, storage_key, original_name, mime_type, size_bytes, sort_order, created_at
         FROM combo_images
         WHERE user_id = $1 AND card_id = $2
         ORDER BY sort_order ASC, created_at ASC`,
        [userId, cardId],
      );
      const generations = await pool.query(
        `SELECT id, card_id, prompt_note, storage_provider, storage_key, original_name, mime_type, size_bytes, duration_ms, poster_url, sort_order, created_at, updated_at
         FROM combo_generations
         WHERE user_id = $1 AND card_id = $2
         ORDER BY sort_order ASC, created_at ASC`,
        [userId, cardId],
      );
      return res.json({
        card: mapCardRows(cardResult.rows, req)[0],
        images: images.rows.map((row) => mapComboImageRow(row, req)).filter(Boolean),
        generations: generations.rows.map((row) => mapComboGenerationRow(row, req)).filter(Boolean),
      });
    } catch (error: unknown) {
      console.error("Combo detail load error:", error);
      return res.status(500).json({ error: errorMessage(error, "Failed to load combo detail.") });
    }
  });

  router.post("/cards/:id/combo/images", imageUploadMiddleware, async (req: AuthenticatedRequest, res) => {
    const directUploadId = getDirectUploadId(req);
    if (directUploadId) return claimDirectComboImage(req, res, directUploadId);
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Image file is required." });
    if (!supportedImageMimeTypes.has(file.mimetype)) {
      return res.status(400).json({ error: "仅支持 jpg、png、webp、gif 图片。" });
    }

    const userId = req.user!.id;
    const cardId = req.params.id;
    const role = normalizeImageRole(req.body.role);
    const sortOrder = Number.parseInt(String(req.body.sortOrder || "0"), 10) || 0;
    const now = Date.now();
    const imageId = `combo_img_${crypto.randomBytes(8).toString("hex")}_${now.toString(36)}`;
    const extension = getImageExtension(file.originalname || "", file.mimetype);
    const originalName = file.originalname || `${imageId}.${extension}`;
    const storageKey = `images/${sanitizeStorageSegment(userId)}/combo/${sanitizeStorageSegment(cardId)}/${imageId}.${extension}`;
    let storedImage: Awaited<ReturnType<ObjectStorageProvider["putObject"]>> | null = null;

    try {
      const card = await pool.query("SELECT id FROM cards WHERE id = $1 AND user_id = $2 AND type = 'combo'", [cardId, userId]);
      if (card.rowCount === 0) return res.status(404).json({ error: "Combo card not found." });
      storedImage = await imageStorage.putObject({ buffer: file.buffer, mimeType: file.mimetype, filename: originalName, storageKey });
      const image = await withDatabaseTransaction(pool, async (client) => {
        const result = await client.query(
          `INSERT INTO combo_images (id, user_id, card_id, role, storage_provider, storage_key, original_name, mime_type, size_bytes, sort_order, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id, card_id, role, storage_provider, storage_key, original_name, mime_type, size_bytes, sort_order, created_at`,
          [imageId, userId, cardId, role, storedImage!.storageProvider, storedImage!.storageKey, storedImage!.originalName, storedImage!.mimeType, storedImage!.sizeBytes, sortOrder, now],
        );
        await refreshComboCardSearchText(client, userId, cardId);
        return result.rows[0];
      });
      return res.json({ image: mapComboImageRow(image, req) });
    } catch (error: unknown) {
      if (storedImage) await deleteImageStorageObject(storedImage.storageProvider, storedImage.storageKey).catch(() => undefined);
      console.error("Combo image upload error:", error);
      return res.status(500).json({ error: errorMessage(error, "Failed to upload combo image.") });
    }
  });

  router.put("/cards/:id/combo/images/:imageId", async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const role = normalizeImageRole(req.body.role);
      const sortOrder = Number.parseInt(String(req.body.sortOrder || "0"), 10) || 0;
      const image = await withDatabaseTransaction(pool, async (client) => {
        const result = await client.query(
          `UPDATE combo_images
           SET role = $1, sort_order = $2
           WHERE id = $3 AND card_id = $4 AND user_id = $5
           RETURNING id, card_id, role, storage_provider, storage_key, original_name, mime_type, size_bytes, sort_order, created_at`,
          [role, sortOrder, req.params.imageId, req.params.id, userId],
        );
        if (result.rows[0]) await refreshComboCardSearchText(client, userId, req.params.id);
        return result.rows[0] || null;
      });
      if (!image) return res.status(404).json({ error: "Combo image not found." });
      return res.json({ image: mapComboImageRow(image, req) });
    } catch (error: unknown) {
      console.error("Combo image update error:", error);
      return res.status(500).json({ error: errorMessage(error, "Failed to update combo image.") });
    }
  });

  router.delete("/cards/:id/combo/images/:imageId", async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const asset = await withDatabaseTransaction(pool, async (client) => {
        const result = await client.query(
          `DELETE FROM combo_images
           WHERE id = $1 AND card_id = $2 AND user_id = $3
           RETURNING storage_provider, storage_key`,
          [req.params.imageId, req.params.id, userId],
        );
        if (result.rows[0]) await refreshComboCardSearchText(client, userId, req.params.id);
        return result.rows[0] || null;
      });
      if (!asset) return res.status(404).json({ error: "Combo image not found." });
      await deleteImageStorageObject(asset.storage_provider, asset.storage_key).catch(() => undefined);
      return res.json({ success: true });
    } catch (error: unknown) {
      console.error("Combo image delete error:", error);
      return res.status(500).json({ error: errorMessage(error, "Failed to delete combo image.") });
    }
  });

  router.post("/cards/:id/combo/generations", videoUploadMiddleware, async (req: AuthenticatedRequest, res) => {
    const directUploadId = getDirectUploadId(req);
    if (directUploadId) return claimDirectComboGeneration(req, res, directUploadId);
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Video file is required." });
    if (!supportedVideoMimeTypes.has(file.mimetype)) {
      return res.status(400).json({ error: "仅支持 mp4、mov、webm 视频。" });
    }

    const userId = req.user!.id;
    const cardId = req.params.id;
    const now = Date.now();
    const generationId = `combo_gen_${crypto.randomBytes(8).toString("hex")}_${now.toString(36)}`;
    const promptNote = String(req.body.promptNote || "").trim();
    const sortOrder = Number.parseInt(String(req.body.sortOrder || "0"), 10) || 0;
    const durationMs = Number.parseInt(String(req.body.durationMs || "0"), 10) || 0;
    const extension = getVideoExtension(file.originalname || "", file.mimetype);
    const originalName = file.originalname || `${generationId}.${extension}`;
    const storageKey = `videos/${sanitizeStorageSegment(userId)}/combo/${sanitizeStorageSegment(cardId)}/${generationId}.${extension}`;
    let storedVideo: Awaited<ReturnType<ObjectStorageProvider["putObject"]>> | null = null;

    try {
      const card = await pool.query("SELECT id FROM cards WHERE id = $1 AND user_id = $2 AND type = 'combo'", [cardId, userId]);
      if (card.rowCount === 0) return res.status(404).json({ error: "Combo card not found." });
      storedVideo = await videoStorage.putObject({ buffer: file.buffer, mimeType: file.mimetype, filename: originalName, storageKey });
      const generation = await withDatabaseTransaction(pool, async (client) => {
        const result = await client.query(
          `INSERT INTO combo_generations (id, user_id, card_id, prompt_note, storage_provider, storage_key, original_name, mime_type, size_bytes, duration_ms, poster_url, sort_order, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '', $11, $12, $12)
           RETURNING id, card_id, prompt_note, storage_provider, storage_key, original_name, mime_type, size_bytes, duration_ms, poster_url, sort_order, created_at, updated_at`,
          [generationId, userId, cardId, promptNote, storedVideo!.storageProvider, storedVideo!.storageKey, storedVideo!.originalName, storedVideo!.mimeType, storedVideo!.sizeBytes, durationMs, sortOrder, now],
        );
        await refreshComboCardSearchText(client, userId, cardId);
        return result.rows[0];
      });
      return res.json({ generation: mapComboGenerationRow(generation, req) });
    } catch (error: unknown) {
      if (storedVideo) await deleteVideoStorageObject(storedVideo.storageProvider, storedVideo.storageKey).catch(() => undefined);
      console.error("Combo generation create error:", error);
      return res.status(500).json({ error: errorMessage(error, "Failed to create combo generation.") });
    }
  });

  router.put("/cards/:id/combo/generations/:generationId", async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const promptNote = String(req.body.promptNote || "").trim();
      const sortOrder = Number.parseInt(String(req.body.sortOrder || "0"), 10) || 0;
      const durationMs = Number.parseInt(String(req.body.durationMs || "0"), 10) || 0;
      const generation = await withDatabaseTransaction(pool, async (client) => {
        const result = await client.query(
          `UPDATE combo_generations
           SET prompt_note = $1, sort_order = $2, duration_ms = $3, updated_at = $4
           WHERE id = $5 AND card_id = $6 AND user_id = $7
           RETURNING id, card_id, prompt_note, storage_provider, storage_key, original_name, mime_type, size_bytes, duration_ms, poster_url, sort_order, created_at, updated_at`,
          [promptNote, sortOrder, durationMs, Date.now(), req.params.generationId, req.params.id, userId],
        );
        if (result.rows[0]) await refreshComboCardSearchText(client, userId, req.params.id);
        return result.rows[0] || null;
      });
      if (!generation) return res.status(404).json({ error: "Combo generation not found." });
      return res.json({ generation: mapComboGenerationRow(generation, req) });
    } catch (error: unknown) {
      console.error("Combo generation update error:", error);
      return res.status(500).json({ error: errorMessage(error, "Failed to update combo generation.") });
    }
  });

  router.delete("/cards/:id/combo/generations/:generationId", async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const asset = await withDatabaseTransaction(pool, async (client) => {
        const result = await client.query(
          `DELETE FROM combo_generations
           WHERE id = $1 AND card_id = $2 AND user_id = $3
           RETURNING storage_provider, storage_key`,
          [req.params.generationId, req.params.id, userId],
        );
        if (result.rows[0]) await refreshComboCardSearchText(client, userId, req.params.id);
        return result.rows[0] || null;
      });
      if (!asset) return res.status(404).json({ error: "Combo generation not found." });
      await deleteVideoStorageObject(asset.storage_provider, asset.storage_key).catch(() => undefined);
      return res.json({ success: true });
    } catch (error: unknown) {
      console.error("Combo generation delete error:", error);
      return res.status(500).json({ error: errorMessage(error, "Failed to delete combo generation.") });
    }
  });

  return router;
}
