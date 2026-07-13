import { Router, type Request, type Response } from "express";
import type pg from "pg";

import type { AuthenticatedRequest } from "../auth.ts";

interface CardUpsertRouterDependencies {
  pool: pg.Pool;
  getDirectUploadId: (req: Request, field?: string) => string;
  claimDirectPrimaryCard: (req: AuthenticatedRequest, res: Response, uploadId: string) => Promise<unknown>;
  claimDirectDocumentCard: (req: AuthenticatedRequest, res: Response, uploadId: string) => Promise<unknown>;
  normalizeInternalProxyUrl: (value: string | null | undefined) => string;
  refreshKnowledgeCard: (
    client: Pick<pg.PoolClient, "query">,
    userId: string,
    cardId: string,
  ) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCardUpsertRouter(dependencies: CardUpsertRouterDependencies): Router {
  const {
    pool,
    getDirectUploadId,
    claimDirectPrimaryCard,
    claimDirectDocumentCard,
    normalizeInternalProxyUrl,
    refreshKnowledgeCard,
  } = dependencies;
  const router = Router();

  router.post("/cards", async (req: AuthenticatedRequest, res) => {
    const directUploadId = getDirectUploadId(req);
    const documentUploadId = getDirectUploadId(req, "documentUploadId");
    if (directUploadId && documentUploadId) {
      return res.status(400).json({ error: "Only one primary upload may be claimed per card request." });
    }
    if (directUploadId) return claimDirectPrimaryCard(req, res, directUploadId);
    if (documentUploadId) return claimDirectDocumentCard(req, res, documentUploadId);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const {
        id,
        weekId,
        dayIndex,
        imageUrl,
        thumbnailUrl,
        photoUid,
        photoHash,
        terms,
        decoType,
        angle,
        createdAt,
        type,
        mdContent,
        mdSummary,
        mdName,
        insightNote,
      } = req.body;
      const safeTerms = Array.isArray(terms) ? terms : [];
      const normalizedImageUrl = normalizeInternalProxyUrl(imageUrl || "");
      const normalizedThumbnailUrl = normalizeInternalProxyUrl(thumbnailUrl || "");
      const termsText = [...safeTerms, mdName, mdSummary, insightNote]
        .filter((value) => typeof value === "string" && value.trim())
        .join(" ");
      const result = await client.query(
        `INSERT INTO cards (id, user_id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash, terms, terms_text, deco_type, angle, created_at, type, md_content, md_summary, md_name, insight_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (id)
         DO UPDATE SET week_id = EXCLUDED.week_id, day_index = EXCLUDED.day_index, image_url = EXCLUDED.image_url,
                       thumbnail_url = EXCLUDED.thumbnail_url, photo_uid = EXCLUDED.photo_uid, photo_hash = EXCLUDED.photo_hash,
                       terms = EXCLUDED.terms, terms_text = EXCLUDED.terms_text, deco_type = EXCLUDED.deco_type, angle = EXCLUDED.angle,
                       created_at = EXCLUDED.created_at, type = EXCLUDED.type, md_content = EXCLUDED.md_content,
                       md_summary = EXCLUDED.md_summary, md_name = EXCLUDED.md_name, insight_note = EXCLUDED.insight_note
         WHERE cards.user_id = EXCLUDED.user_id
         RETURNING id`,
        [
          id,
          req.user!.id,
          weekId,
          dayIndex,
          normalizedImageUrl,
          normalizedThumbnailUrl,
          photoUid || "",
          photoHash || "",
          safeTerms,
          termsText,
          decoType,
          angle,
          createdAt || Date.now(),
          type || "image",
          mdContent || null,
          mdSummary || null,
          mdName || null,
          insightNote || null,
        ],
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Card belongs to another user." });
      }
      await refreshKnowledgeCard(client, req.user!.id, id);
      await client.query("COMMIT");
      return res.json({ success: true });
    } catch (error: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);
      console.error("Error executing upsert card query:", error);
      return res.status(500).json({ error: errorMessage(error) });
    } finally {
      client.release();
    }
  });

  return router;
}
