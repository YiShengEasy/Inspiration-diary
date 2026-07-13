import { Router, type Request, type RequestHandler, type Response } from "express";
import type pg from "pg";

import type { AuthenticatedRequest } from "../auth.ts";
import { deliverOssObject, imageProcessFor, type ImageVariant, type MediaProcesses } from "../mediaDelivery.ts";
import { fetchPhotoPrismImage } from "../photoprism.ts";
import type { MediaDeliveryMode } from "../runtimeConfig.ts";
import type { ObjectStorageProvider } from "../storage/types.ts";

interface PrimaryMediaRouterDependencies {
  pool: pg.Pool | null;
  requireAuthOrSignedUrl: RequestHandler;
  hasValidSignedUrl: (req: Request) => boolean;
  mediaDeliveryMode: MediaDeliveryMode;
  imageProcesses: MediaProcesses;
  primaryStorage: ObjectStorageProvider;
  proxySignedObjectUrl: (req: Request, res: Response, signedUrl: string) => Promise<unknown>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createPrimaryMediaRouter(dependencies: PrimaryMediaRouterDependencies): Router {
  const {
    pool,
    requireAuthOrSignedUrl,
    hasValidSignedUrl,
    mediaDeliveryMode,
    imageProcesses,
    primaryStorage,
    proxySignedObjectUrl,
  } = dependencies;
  const router = Router();

  router.get("/photos/:photoUid/:variant(thumb|full)", requireAuthOrSignedUrl, async (req, res) => {
    if (!pool) return res.status(503).json({ error: "PostgreSQL is not configured." });
    try {
      const { photoUid, variant } = req.params;
      const result = hasValidSignedUrl(req)
        ? await pool.query(
          `SELECT photo_hash
           FROM cards
           WHERE photo_uid = $1
           ORDER BY created_at DESC
           LIMIT 1`,
          [photoUid],
        )
        : await pool.query(
          `SELECT photo_hash
           FROM cards
           WHERE user_id = $1 AND photo_uid = $2
           ORDER BY created_at DESC
           LIMIT 1`,
          [(req as AuthenticatedRequest).user!.id, photoUid],
        );
      const photoHash = result.rows[0]?.photo_hash;
      if (!photoHash) return res.status(404).json({ error: "Photo not found" });
      const image = await fetchPhotoPrismImage(photoHash, variant as "thumb" | "full");
      res.setHeader("Content-Type", image.contentType);
      res.setHeader("Cache-Control", "private, max-age=300");
      return res.send(image.bytes);
    } catch (error: unknown) {
      console.error("Photo proxy error:", error);
      return res.status(502).json({ error: errorMessage(error, "Photo proxy failed.") });
    }
  });

  router.get("/photos/hash/:photoHash/:variant(thumb|full)", requireAuthOrSignedUrl, async (req, res) => {
    try {
      const { photoHash, variant } = req.params;
      if (!/^[a-f0-9]{40}$/i.test(photoHash)) {
        return res.status(400).json({ error: "Invalid photo hash." });
      }
      const image = await fetchPhotoPrismImage(photoHash, variant as "thumb" | "full");
      res.setHeader("Content-Type", image.contentType);
      res.setHeader("Cache-Control", "private, max-age=300");
      return res.send(image.bytes);
    } catch (error: unknown) {
      console.error("Photo proxy error:", error);
      return res.status(502).json({ error: errorMessage(error, "Photo proxy failed.") });
    }
  });

  async function handlePrimaryObjectDelivery(req: Request, res: Response, variant: ImageVariant) {
    if (!pool) return res.status(503).json({ error: "PostgreSQL is not configured." });
    try {
      const storageKey = decodeURIComponent(req.params.storageKey || "");
      const legacyPrimaryKey = /^primary-images\/[0-9]{4}\/[0-9]{2}\/[A-Za-z0-9._-]+$/u.test(storageKey);
      const directPrimaryKey = /^media\/[A-Za-z0-9_-]+\/primary_image\/[0-9]{4}\/[0-9]{2}\/[A-Za-z0-9._-]+$/u.test(storageKey);
      if (!legacyPrimaryKey && !directPrimaryKey) {
        return res.status(400).json({ error: "Invalid object key." });
      }
      const result = hasValidSignedUrl(req)
        ? await pool.query("SELECT id FROM cards WHERE photo_uid = $1 LIMIT 1", [storageKey])
        : await pool.query(
          `SELECT id
           FROM cards
           WHERE user_id = $1 AND photo_uid = $2
           LIMIT 1`,
          [(req as AuthenticatedRequest).user!.id, storageKey],
        );
      if (result.rowCount === 0) return res.status(404).json({ error: "Object not found." });
      return await deliverOssObject({
        mode: mediaDeliveryMode,
        storage: primaryStorage,
        storageKey,
        process: imageProcessFor(variant, imageProcesses),
        response: res,
        proxy: (signedUrl) => proxySignedObjectUrl(req, res, signedUrl),
      });
    } catch (error: unknown) {
      console.error(`Primary object ${variant} proxy error:`, error);
      return res.status(502).json({ error: errorMessage(error, "Primary object proxy failed.") });
    }
  }

  router.get("/objects/primary/:storageKey", requireAuthOrSignedUrl, (req, res) =>
    handlePrimaryObjectDelivery(req, res, "original"));
  router.get("/objects/primary-thumb/:storageKey", requireAuthOrSignedUrl, (req, res) =>
    handlePrimaryObjectDelivery(req, res, "thumb-480"));
  router.get("/objects/primary-thumb-240/:storageKey", requireAuthOrSignedUrl, (req, res) =>
    handlePrimaryObjectDelivery(req, res, "thumb-240"));
  router.get("/objects/primary-detail/:storageKey", requireAuthOrSignedUrl, (req, res) =>
    handlePrimaryObjectDelivery(req, res, "detail-1280"));

  return router;
}
