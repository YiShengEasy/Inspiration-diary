import { createHash } from "node:crypto";

const MAX_SLUG_BASE_LENGTH = 72;

/**
 * Produces a readable slug whose suffix depends only on the entity's stable id.
 * Callers should persist the result rather than regenerating it after a title edit.
 */
export function createKnowledgeSlug(title: string, stableId: string): string {
  const base = slugifyTitle(title) || "note";
  const suffix = createHash("sha256")
    .update(stableId.trim())
    .digest("hex")
    .slice(0, 10);
  return `${base.slice(0, MAX_SLUG_BASE_LENGTH).replace(/-+$/u, "")}-${suffix}`;
}

export function slugifyTitle(title: string): string {
  return title
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-+/gu, "-");
}

export function normalizeKnowledgeSlug(slug: string): string {
  return slugifyTitle(slug);
}

export const createStableSlug = createKnowledgeSlug;
