import type { KnowledgeNode, KnowledgeQueryable } from "./repository.ts";

export type KnowledgePreviewKind = "image" | "markdown" | "combo" | "video" | "book" | "weekly_note" | "concept";

export interface KnowledgePreview {
  kind: KnowledgePreviewKind;
  thumbnailUrls: string[];
  mediaCount: number;
}

interface CardPreviewRow {
  id: string;
  type: string | null;
  thumbnail_url: string | null;
  photo_uid: string | null;
  photo_hash: string | null;
  image_ids: string[] | null;
  combo_image_ids: string[] | null;
  video_ids: string[] | null;
}

function internalThumbnail(row: CardPreviewRow): string | null {
  if (row.photo_uid && (
    row.photo_uid.startsWith("primary-images/") ||
    row.photo_uid.startsWith("media/")
  )) {
    return `/api/objects/primary-thumb-112/${encodeURIComponent(row.photo_uid)}`;
  }
  if (row.photo_hash && /^[a-f0-9]{40}$/iu.test(row.photo_hash)) {
    return `/api/photos/hash/${encodeURIComponent(row.photo_hash)}/thumb`;
  }
  if (row.thumbnail_url?.startsWith("/")) return row.thumbnail_url;
  return null;
}

function previewKind(node: KnowledgeNode, cardType?: string | null): KnowledgePreviewKind {
  if (node.entityType === "book") return "book";
  if (node.entityType === "weekly_note") return "weekly_note";
  if (node.entityType === "concept") return "concept";
  if (cardType === "md") return "markdown";
  if (cardType === "combo") return "combo";
  if (cardType === "video") return "video";
  return "image";
}

export async function loadKnowledgePreviews(
  queryable: KnowledgeQueryable,
  userId: string,
  nodes: KnowledgeNode[],
): Promise<Map<string, KnowledgePreview>> {
  const cardIds = nodes
    .filter((node) => node.entityType === "card" && node.entityId)
    .map((node) => node.entityId!);
  const cardRows = cardIds.length === 0
    ? { rows: [] as CardPreviewRow[] }
    : await queryable.query<CardPreviewRow>(
      `SELECT
         c.id, c.type, c.thumbnail_url, c.photo_uid, c.photo_hash,
         ARRAY(
           SELECT ia.id FROM image_assets ia
           WHERE ia.user_id = $1 AND ia.card_id = c.id
           ORDER BY ia.created_at ASC LIMIT 4
         ) AS image_ids,
         ARRAY(
           SELECT ci.id FROM combo_images ci
           WHERE ci.user_id = $1 AND ci.card_id = c.id
           ORDER BY ci.sort_order ASC, ci.created_at ASC LIMIT 4
         ) AS combo_image_ids,
         ARRAY(
           SELECT va.id FROM video_assets va
           WHERE va.user_id = $1 AND va.card_id = c.id
           ORDER BY va.created_at ASC LIMIT 1
         ) AS video_ids
       FROM cards c
       WHERE c.user_id = $1 AND c.id = ANY($2::text[])`,
      [userId, cardIds],
    );
  const cards = new Map(cardRows.rows.map((row) => [row.id, row]));
  const previews = new Map<string, KnowledgePreview>();

  for (const node of nodes) {
    const card = node.entityId ? cards.get(node.entityId) : undefined;
    const kind = previewKind(node, card?.type);
    const thumbnailUrls: string[] = [];
    if (card) {
      const primary = internalThumbnail(card);
      if (primary) thumbnailUrls.push(primary);
      if (kind === "combo") {
        for (const id of card.combo_image_ids ?? []) {
          thumbnailUrls.push(`/api/combo-images/${encodeURIComponent(id)}/thumb-112`);
        }
      } else if (kind === "image") {
        for (const id of card.image_ids ?? []) {
          thumbnailUrls.push(`/api/images/${encodeURIComponent(id)}/thumb-112`);
        }
      } else if (kind === "video" && card.video_ids?.[0]) {
        thumbnailUrls.push(`/api/videos/${encodeURIComponent(card.video_ids[0])}/poster`);
      }
    }
    const uniqueThumbnails = Array.from(new Set(thumbnailUrls)).slice(0, 4);
    previews.set(node.id, {
      kind,
      thumbnailUrls: uniqueThumbnails,
      mediaCount: Math.max(uniqueThumbnails.length, kind === "markdown" || kind === "weekly_note" || kind === "concept" ? 0 : 1),
    });
  }
  return previews;
}
