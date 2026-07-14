import crypto from "crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import type pg from "pg";

import type { ImageAsset, ImageCard, VideoAsset } from "../../types.ts";
import type { AuthenticatedRequest } from "../auth.ts";
import type { ImageUploadInput } from "../storage/photoprismStorage.ts";
import type { StoredPrimaryImage } from "../storage/index.ts";
import type { ObjectStorageProvider } from "../storage/types.ts";

interface LegacyUploadRouterDependencies {
  pool: pg.Pool | null;
  primaryUploadMiddleware: RequestHandler;
  videoUploadMiddleware: RequestHandler;
  imageUploadMiddleware: RequestHandler;
  supportedVideoMimeTypes: ReadonlySet<string>;
  supportedImageMimeTypes: ReadonlySet<string>;
  maxVideoUploadBytes: number;
  maxImageUploadBytes: number;
  videoStorage: ObjectStorageProvider;
  imageStorage: ObjectStorageProvider;
  normalizeImageUpload: (req: Request) => ImageUploadInput;
  storePrimaryImage: (image: ImageUploadInput) => Promise<StoredPrimaryImage>;
  primaryObjectUrl: (storageKey: string, req: Request, variant: "thumb-240" | "thumb-480" | "detail-1280" | "original") => string;
  signedImageUrl: (value: string, req: Request) => string;
  getDirectUploadId: (req: Request, field?: string) => string;
  claimDirectVideoAsset: (req: AuthenticatedRequest, res: Response, uploadId: string) => Promise<unknown>;
  claimDirectImageAsset: (req: AuthenticatedRequest, res: Response, uploadId: string) => Promise<unknown>;
  getVideoExtension: (filename: string, mimeType: string) => string;
  getImageExtension: (filename: string, mimeType: string) => string;
  sanitizeStorageSegment: (value: string) => string;
  deleteVideoStorageObject: (storageProvider: string, storageKey: string) => Promise<void>;
  deleteImageStorageObject: (storageProvider: string, storageKey: string) => Promise<void>;
  comboSummarySelect: string;
  mapCardRows: (rows: unknown[], req: Request) => ImageCard[];
  mapVideoAssetRow: (row: unknown, req: Request) => VideoAsset | null;
  mapImageAssetRow: (row: unknown, req: Request) => ImageAsset | null;
  refreshKnowledgeCard: (
    client: Pick<pg.PoolClient, "query">,
    userId: string,
    cardId: string,
  ) => Promise<void>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createLegacyUploadRouter(dependencies: LegacyUploadRouterDependencies): Router {
  const {
    pool,
    primaryUploadMiddleware,
    videoUploadMiddleware,
    imageUploadMiddleware,
    supportedVideoMimeTypes,
    supportedImageMimeTypes,
    maxVideoUploadBytes,
    maxImageUploadBytes,
    videoStorage,
    imageStorage,
    normalizeImageUpload,
    storePrimaryImage,
    primaryObjectUrl,
    signedImageUrl,
    getDirectUploadId,
    claimDirectVideoAsset,
    claimDirectImageAsset,
    getVideoExtension,
    getImageExtension,
    sanitizeStorageSegment,
    deleteVideoStorageObject,
    deleteImageStorageObject,
    comboSummarySelect,
    mapCardRows,
    mapVideoAssetRow,
    mapImageAssetRow,
    refreshKnowledgeCard,
  } = dependencies;
  const router = Router();

  router.post("/store-image", primaryUploadMiddleware, async (req, res) => {
    try {
      const stored = await storePrimaryImage(normalizeImageUpload(req));
      if (stored.storageProvider === "oss") {
        return res.json({
          photoUid: stored.storageKey,
          photoHash: "",
          storageProvider: stored.storageProvider,
          storageKey: stored.storageKey,
          imageUrl: primaryObjectUrl(stored.storageKey, req, "detail-1280"),
          thumbnail240Url: primaryObjectUrl(stored.storageKey, req, "thumb-240"),
          thumbnailUrl: primaryObjectUrl(stored.storageKey, req, "thumb-480"),
          originalImageUrl: primaryObjectUrl(stored.storageKey, req, "original"),
        });
      }
      const encodedHash = encodeURIComponent(stored.photoHash);
      const imageUrl = signedImageUrl(`/api/photos/hash/${encodedHash}/full`, req);
      const thumbnailUrl = signedImageUrl(`/api/photos/hash/${encodedHash}/thumb`, req);
      return res.json({
        photoUid: stored.photoUid,
        photoHash: stored.photoHash,
        imageUrl,
        thumbnail240Url: thumbnailUrl,
        thumbnailUrl,
        originalImageUrl: imageUrl,
      });
    } catch (error: unknown) {
      console.error("Primary image storage error:", error);
      return res.status(400).json({ error: errorMessage(error, "Primary image storage failed.") });
    }
  });

  router.post("/videos/upload", videoUploadMiddleware, async (req: AuthenticatedRequest, res) => {
    if (!pool) return res.status(503).json({ error: "PostgreSQL is not configured." });
    const directUploadId = getDirectUploadId(req);
    if (directUploadId) return claimDirectVideoAsset(req, res, directUploadId);
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Missing video upload." });
    if (!supportedVideoMimeTypes.has(file.mimetype)) {
      return res.status(400).json({ error: "仅支持 mp4、mov、webm 视频。" });
    }
    if (file.size > maxVideoUploadBytes) {
      return res.status(413).json({ error: `视频不能超过 ${Math.round(maxVideoUploadBytes / 1024 / 1024)}MB。` });
    }

    const userId = req.user!.id;
    const now = Date.now();
    const assetId = `video_${crypto.randomBytes(8).toString("hex")}_${now.toString(36)}`;
    const extension = getVideoExtension(file.originalname || "", file.mimetype);
    const storageKey = `videos/${sanitizeStorageSegment(userId)}/${assetId}.${extension}`;
    const originalName = file.originalname || `${assetId}.${extension}`;
    const cardIdInput = String(req.body.cardId || "").trim();
    const shouldCreateCard = !cardIdInput;
    const cardId = cardIdInput || String(req.body.newCardId || `card_${crypto.randomBytes(8).toString("hex")}_${now.toString(36)}`).trim();
    const weekId = String(req.body.weekId || "").trim();
    const dayIndex = Number.parseInt(String(req.body.dayIndex ?? "0"), 10);
    const bookId = String(req.body.bookId || "").trim();
    const client = await pool.connect();
    let storedVideo: Awaited<ReturnType<ObjectStorageProvider["putObject"]>> | null = null;
    try {
      storedVideo = await videoStorage.putObject({ buffer: file.buffer, mimeType: file.mimetype, filename: originalName, storageKey });
      await client.query("BEGIN");
      if (shouldCreateCard) {
        if (!weekId) {
          await client.query("ROLLBACK");
          await deleteVideoStorageObject(storedVideo.storageProvider, storedVideo.storageKey).catch(() => undefined);
          return res.status(400).json({ error: "weekId is required for standalone video cards." });
        }
        await client.query(
          `INSERT INTO cards (id, user_id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash, terms, terms_text, deco_type, angle, created_at, type, md_content, md_summary, md_name, insight_note)
           VALUES ($1, $2, $3, $4, '', '', '', '', $5, $6, 'paperclip', 0, $7, 'video', NULL, NULL, NULL, NULL)
           ON CONFLICT (id)
           DO UPDATE SET week_id = EXCLUDED.week_id, day_index = EXCLUDED.day_index, terms = EXCLUDED.terms,
                         terms_text = EXCLUDED.terms_text, created_at = EXCLUDED.created_at, type = 'video'
           WHERE cards.user_id = EXCLUDED.user_id`,
          [cardId, userId, weekId, Number.isFinite(dayIndex) ? dayIndex : 0, ["视频灵感", "待整理"], "视频灵感 待整理", now],
        );
      } else {
        const card = await client.query("SELECT id FROM cards WHERE id = $1 AND user_id = $2", [cardId, userId]);
        if (card.rowCount === 0) {
          await client.query("ROLLBACK");
          await deleteVideoStorageObject(storedVideo.storageProvider, storedVideo.storageKey).catch(() => undefined);
          return res.status(404).json({ error: "Card not found." });
        }
      }

      const assetResult = await client.query(
        `INSERT INTO video_assets (id, user_id, card_id, storage_provider, storage_key, original_name, mime_type, size_bytes, duration_ms, poster_url, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '', $10)
         RETURNING id, card_id, storage_provider, storage_key, original_name, mime_type, size_bytes, duration_ms, poster_url, created_at`,
        [assetId, userId, cardId, storedVideo.storageProvider, storedVideo.storageKey, storedVideo.originalName, storedVideo.mimeType, storedVideo.sizeBytes, Number.parseInt(String(req.body.durationMs || "0"), 10) || 0, now],
      );
      if (bookId && shouldCreateCard) {
        const book = await client.query("SELECT id FROM inspiration_books WHERE id = $1 AND user_id = $2", [bookId, userId]);
        if (book.rowCount > 0) {
          await client.query(
            `INSERT INTO inspiration_book_cards (user_id, book_id, card_id, added_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, book_id, card_id) DO NOTHING`,
            [userId, bookId, cardId, now],
          );
          await client.query("UPDATE inspiration_books SET updated_at = $1 WHERE id = $2 AND user_id = $3", [now, bookId, userId]);
        }
      }
      await refreshKnowledgeCard(client, userId, cardId);
      const cardResult = await client.query(
        `SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash, terms, deco_type, angle, created_at, type, md_content, md_summary, md_name, insight_note, is_favorite, favorited_at,
                ${comboSummarySelect},
                (SELECT COALESCE(json_agg(va ORDER BY va.created_at DESC), '[]'::json) FROM video_assets va WHERE va.user_id = cards.user_id AND va.card_id = cards.id) AS video_assets,
                (SELECT COALESCE(json_agg(ia ORDER BY ia.created_at DESC), '[]'::json) FROM image_assets ia WHERE ia.user_id = cards.user_id AND ia.card_id = cards.id) AS image_assets
         FROM cards WHERE id = $1 AND user_id = $2`,
        [cardId, userId],
      );
      await client.query("COMMIT");
      return res.json({ card: mapCardRows(cardResult.rows, req)[0], video: mapVideoAssetRow(assetResult.rows[0], req) });
    } catch (error: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (storedVideo) await deleteVideoStorageObject(storedVideo.storageProvider, storedVideo.storageKey).catch(() => undefined);
      console.error("Video upload error:", error);
      return res.status(500).json({ error: errorMessage(error, "Video upload failed.") });
    } finally {
      client.release();
    }
  });

  router.post("/images/upload", imageUploadMiddleware, async (req: AuthenticatedRequest, res) => {
    if (!pool) return res.status(503).json({ error: "PostgreSQL is not configured." });
    const directUploadId = getDirectUploadId(req);
    if (directUploadId) return claimDirectImageAsset(req, res, directUploadId);
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Missing image upload." });
    if (!supportedImageMimeTypes.has(file.mimetype)) {
      return res.status(400).json({ error: "仅支持 jpg、png、webp、gif 图片。" });
    }
    if (file.size > maxImageUploadBytes) {
      return res.status(413).json({ error: `图片不能超过 ${Math.round(maxImageUploadBytes / 1024 / 1024)}MB。` });
    }
    const userId = req.user!.id;
    const cardId = String(req.body.cardId || "").trim();
    if (!cardId) return res.status(400).json({ error: "cardId is required." });

    const now = Date.now();
    const assetId = `image_${crypto.randomBytes(8).toString("hex")}_${now.toString(36)}`;
    const extension = getImageExtension(file.originalname || "", file.mimetype);
    const storageKey = `images/${sanitizeStorageSegment(userId)}/${assetId}.${extension}`;
    const originalName = file.originalname || `${assetId}.${extension}`;
    const client = await pool.connect();
    let storedImage: Awaited<ReturnType<ObjectStorageProvider["putObject"]>> | null = null;
    try {
      storedImage = await imageStorage.putObject({ buffer: file.buffer, mimeType: file.mimetype, filename: originalName, storageKey });
      await client.query("BEGIN");
      const card = await client.query("SELECT id, type FROM cards WHERE id = $1 AND user_id = $2", [cardId, userId]);
      if (card.rowCount === 0) {
        await client.query("ROLLBACK");
        await deleteImageStorageObject(storedImage.storageProvider, storedImage.storageKey).catch(() => undefined);
        return res.status(404).json({ error: "Card not found." });
      }
      if ((card.rows[0].type || "image") !== "video") {
        await client.query("ROLLBACK");
        await deleteImageStorageObject(storedImage.storageProvider, storedImage.storageKey).catch(() => undefined);
        return res.status(400).json({ error: "只有视频卡片可以绑定图片。" });
      }
      const assetResult = await client.query(
        `INSERT INTO image_assets (id, user_id, card_id, storage_provider, storage_key, original_name, mime_type, size_bytes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, card_id, storage_provider, storage_key, original_name, mime_type, size_bytes, created_at`,
        [assetId, userId, cardId, storedImage.storageProvider, storedImage.storageKey, storedImage.originalName, storedImage.mimeType, storedImage.sizeBytes, now],
      );
      await client.query("COMMIT");
      return res.json({ image: mapImageAssetRow(assetResult.rows[0], req) });
    } catch (error: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (storedImage) await deleteImageStorageObject(storedImage.storageProvider, storedImage.storageKey).catch(() => undefined);
      console.error("Image asset upload error:", error);
      return res.status(500).json({ error: errorMessage(error, "Image upload failed.") });
    } finally {
      client.release();
    }
  });

  return router;
}
