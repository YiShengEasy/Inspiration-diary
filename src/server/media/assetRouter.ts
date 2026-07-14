import fs from "fs/promises";
import fsSync from "fs";
import { Router, type Request, type RequestHandler, type Response } from "express";
import type pg from "pg";

import type { AuthenticatedRequest } from "../auth.ts";
import { deliverOssObject, imageProcessFor, type ImageVariant, type MediaProcesses } from "../mediaDelivery.ts";
import type { MediaDeliveryMode } from "../runtimeConfig.ts";
import type { ObjectStorageProvider } from "../storage/types.ts";

interface AssetMediaRouterDependencies {
  pool: pg.Pool | null;
  requireAuth: RequestHandler;
  requireAuthOrSignedUrl: RequestHandler;
  hasValidSignedUrl: (req: Request) => boolean;
  mediaDeliveryMode: MediaDeliveryMode;
  imageProcesses: MediaProcesses;
  videoPosterProcess: string;
  ossStorage: ObjectStorageProvider | null;
  imageStorage: ObjectStorageProvider;
  videoStorage: ObjectStorageProvider;
  imageStorageKeyToLocalPath: (storageKey: string) => string;
  videoStorageKeyToLocalPath: (storageKey: string) => string;
  deleteImageStorageObject: (storageProvider: string, storageKey: string) => Promise<void>;
  deleteVideoStorageObject: (storageProvider: string, storageKey: string) => Promise<void>;
  proxySignedObjectUrl: (req: Request, res: Response, signedUrl: string) => Promise<unknown>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createAssetMediaRouter(dependencies: AssetMediaRouterDependencies): Router {
  const {
    pool,
    requireAuth,
    requireAuthOrSignedUrl,
    hasValidSignedUrl,
    mediaDeliveryMode,
    imageProcesses,
    videoPosterProcess,
    ossStorage,
    imageStorage,
    videoStorage,
    imageStorageKeyToLocalPath,
    videoStorageKeyToLocalPath,
    deleteImageStorageObject,
    deleteVideoStorageObject,
    proxySignedObjectUrl,
  } = dependencies;
  const router = Router();

  async function handleStoredImageDelivery(
    req: Request,
    res: Response,
    table: "image_assets" | "combo_images",
    variant: ImageVariant,
  ) {
    if (!pool) return res.status(503).json({ error: "PostgreSQL is not configured." });
    try {
      const imageId = req.params.imageId;
      const result = hasValidSignedUrl(req)
        ? await pool.query(
          `SELECT id, storage_provider, storage_key, original_name, mime_type, size_bytes
           FROM ${table}
           WHERE id = $1`,
          [imageId],
        )
        : await pool.query(
          `SELECT id, storage_provider, storage_key, original_name, mime_type, size_bytes
           FROM ${table}
           WHERE id = $1 AND user_id = $2`,
          [imageId, (req as AuthenticatedRequest).user!.id],
        );
      const asset = result.rows[0];
      if (!asset) return res.status(404).json({ error: "Image not found" });
      if (asset.storage_provider === "oss") {
        return await deliverOssObject({
          mode: mediaDeliveryMode,
          storage: ossStorage || imageStorage,
          storageKey: asset.storage_key,
          process: imageProcessFor(variant, imageProcesses),
          response: res,
          proxy: (signedUrl) => proxySignedObjectUrl(req, res, signedUrl),
        });
      }
      if (asset.storage_provider !== "local") {
        return res.status(501).json({ error: "Unsupported image storage provider." });
      }
      const localPath = imageStorageKeyToLocalPath(asset.storage_key);
      const stat = await fs.stat(localPath);
      res.setHeader("Content-Type", asset.mime_type || "image/jpeg");
      res.setHeader("Content-Length", String(stat.size));
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(asset.original_name || asset.id)}"`);
      return fsSync.createReadStream(localPath).pipe(res);
    } catch (error: unknown) {
      console.error(`${table} stream error:`, error);
      return res.status(500).json({ error: errorMessage(error, "Image stream failed.") });
    }
  }

  for (const variant of ["thumb-112", "thumb-240", "thumb-480", "detail-1280", "original"] as const) {
    router.get(`/images/:imageId/${variant}`, requireAuthOrSignedUrl, (req, res) =>
      handleStoredImageDelivery(req, res, "image_assets", variant));
    router.get(`/combo-images/:imageId/${variant}`, requireAuthOrSignedUrl, (req, res) =>
      handleStoredImageDelivery(req, res, "combo_images", variant));
  }
  router.get("/images/:imageId", requireAuthOrSignedUrl, (req, res) =>
    handleStoredImageDelivery(req, res, "image_assets", "original"));
  router.get("/combo-images/:imageId", requireAuthOrSignedUrl, (req, res) =>
    handleStoredImageDelivery(req, res, "combo_images", "original"));

  router.delete("/images/:imageId", requireAuth, async (req: AuthenticatedRequest, res) => {
    if (!pool) return res.status(503).json({ error: "PostgreSQL is not configured." });
    try {
      const result = await pool.query(
        `DELETE FROM image_assets
         WHERE id = $1 AND user_id = $2
         RETURNING storage_provider, storage_key`,
        [req.params.imageId, req.user!.id],
      );
      const asset = result.rows[0];
      if (!asset) return res.status(404).json({ error: "Image not found" });
      await deleteImageStorageObject(asset.storage_provider, asset.storage_key);
      return res.json({ success: true });
    } catch (error: unknown) {
      console.error("Image delete error:", error);
      return res.status(500).json({ error: errorMessage(error, "Image delete failed.") });
    }
  });

  async function handlePoster(
    req: Request,
    res: Response,
    table: "video_assets" | "combo_generations",
    id: string,
    errorLabel: string,
  ) {
    if (!pool) return res.status(503).json({ error: "PostgreSQL is not configured." });
    try {
      const result = hasValidSignedUrl(req)
        ? await pool.query(
          `SELECT id, storage_provider, storage_key, poster_url FROM ${table} WHERE id = $1`,
          [id],
        )
        : await pool.query(
          `SELECT id, storage_provider, storage_key, poster_url FROM ${table} WHERE id = $1 AND user_id = $2`,
          [id, (req as AuthenticatedRequest).user!.id],
        );
      const asset = result.rows[0];
      if (!asset) return res.status(404).json({ error: "Video not found" });
      if (asset.storage_provider === "oss") {
        return await deliverOssObject({
          mode: mediaDeliveryMode,
          storage: ossStorage || videoStorage,
          storageKey: asset.storage_key,
          process: videoPosterProcess,
          response: res,
          proxy: (signedUrl) => proxySignedObjectUrl(req, res, signedUrl),
        });
      }
      if (asset.poster_url) return res.redirect(302, asset.poster_url);
      return res.status(404).json({ error: "Video poster not found." });
    } catch (error: unknown) {
      console.error(errorLabel, error);
      return res.status(502).json({ error: errorMessage(error, "Video poster failed.") });
    }
  }

  router.get("/videos/:videoId/poster", requireAuthOrSignedUrl, (req, res) =>
    handlePoster(req, res, "video_assets", req.params.videoId, "Video poster proxy error:"));
  router.get("/combo-generations/:generationId/poster", requireAuthOrSignedUrl, (req, res) =>
    handlePoster(req, res, "combo_generations", req.params.generationId, "Combo generation poster error:"));

  async function handleVideo(
    req: Request,
    res: Response,
    table: "video_assets" | "combo_generations",
    id: string,
    errorLabel: string,
  ) {
    if (!pool) return res.status(503).json({ error: "PostgreSQL is not configured." });
    try {
      const result = hasValidSignedUrl(req)
        ? await pool.query(
          `SELECT id, storage_provider, storage_key, original_name, mime_type, size_bytes FROM ${table} WHERE id = $1`,
          [id],
        )
        : await pool.query(
          `SELECT id, storage_provider, storage_key, original_name, mime_type, size_bytes FROM ${table} WHERE id = $1 AND user_id = $2`,
          [id, (req as AuthenticatedRequest).user!.id],
        );
      const asset = result.rows[0];
      if (!asset) return res.status(404).json({ error: "Video not found" });
      if (asset.storage_provider === "oss") {
        return await deliverOssObject({
          mode: mediaDeliveryMode,
          storage: ossStorage || videoStorage,
          storageKey: asset.storage_key,
          response: res,
          proxy: (signedUrl) => proxySignedObjectUrl(req, res, signedUrl),
        });
      }
      if (asset.storage_provider !== "local") {
        return res.status(501).json({ error: "Unsupported video storage provider." });
      }

      const localPath = videoStorageKeyToLocalPath(asset.storage_key);
      const stat = await fs.stat(localPath);
      const fileSize = stat.size;
      const range = req.headers.range;
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", asset.mime_type || "video/mp4");
      res.setHeader("Cache-Control", "private, max-age=300");
      if (range) {
        const match = range.match(/bytes=(\d*)-(\d*)/);
        const start = match?.[1] ? Number.parseInt(match[1], 10) : 0;
        const end = match?.[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= fileSize) {
          res.setHeader("Content-Range", `bytes */${fileSize}`);
          return res.status(416).end();
        }
        const safeEnd = Math.min(end, fileSize - 1);
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${safeEnd}/${fileSize}`);
        res.setHeader("Content-Length", String(safeEnd - start + 1));
        return fsSync.createReadStream(localPath, { start, end: safeEnd }).pipe(res);
      }
      res.setHeader("Content-Length", String(fileSize));
      return fsSync.createReadStream(localPath).pipe(res);
    } catch (error: unknown) {
      console.error(errorLabel, error);
      return res.status(500).json({ error: errorMessage(error, "Video stream failed.") });
    }
  }

  router.get("/videos/:videoId", requireAuthOrSignedUrl, (req, res) =>
    handleVideo(req, res, "video_assets", req.params.videoId, "Video stream error:"));
  router.get("/combo-generations/:generationId/video", requireAuthOrSignedUrl, (req, res) =>
    handleVideo(req, res, "combo_generations", req.params.generationId, "Combo generation video stream error:"));

  router.delete("/videos/:videoId", requireAuth, async (req: AuthenticatedRequest, res) => {
    if (!pool) return res.status(503).json({ error: "PostgreSQL is not configured." });
    try {
      const result = await pool.query(
        `DELETE FROM video_assets
         WHERE id = $1 AND user_id = $2
         RETURNING storage_provider, storage_key`,
        [req.params.videoId, req.user!.id],
      );
      const asset = result.rows[0];
      if (!asset) return res.status(404).json({ error: "Video not found" });
      await deleteVideoStorageObject(asset.storage_provider, asset.storage_key);
      return res.json({ success: true });
    } catch (error: unknown) {
      console.error("Video delete error:", error);
      return res.status(500).json({ error: errorMessage(error, "Video delete failed.") });
    }
  });

  return router;
}
