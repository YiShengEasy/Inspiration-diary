import express from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { Readable } from "stream";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import pg from "pg";
import multer from "multer";
import mammoth from "mammoth";
import compression from "compression";
import { createAuthRouter, type AuthenticatedRequest } from "./src/server/auth";
import { normalizeImageUpload } from "./src/server/upload";
import { getRuntimeConfig, validateRuntimeConfig } from "./src/server/runtimeConfig";
import { createImageAssetStorage, createVideoStorage, storePrimaryImage } from "./src/server/storage";
import type { ImageVariant, MediaProcesses } from "./src/server/mediaDelivery";
import { createOssDirectUploadGateway } from "./src/server/direct-upload/ossGateway";
import { createUploadSessionRepository } from "./src/server/direct-upload/repository";
import { createDirectUploadRouter } from "./src/server/direct-upload/router";
import {
  createDirectUploadService,
  DirectUploadServiceError,
  type DirectUploadService,
} from "./src/server/direct-upload/service";
import {
  claimBusinessUpload,
  DirectUploadBusinessClaimError,
} from "./src/server/direct-upload/businessClaims";
import type { DirectUploadGateway } from "./src/server/direct-upload/ossGateway";
import { createKnowledgeRouter } from "./src/server/knowledge/router";
import { createKnowledgeService } from "./src/server/knowledge/service";
import { getRuntimeCapabilities } from "./src/server/runtimeCapabilities";
import { withDatabaseTransaction } from "./src/server/database/transaction";
import { createMiniprogramRouter } from "./src/server/miniprogram/router";
import { createNotesRouter } from "./src/server/notes/router";
import { createRequirePostgresAuth } from "./src/server/postgresAuth";
import { createSettingsRouter } from "./src/server/settings/router";
import { createBooksRouter } from "./src/server/books/router";
import { createCardMutationRouter } from "./src/server/cards/mutationRouter";
import { createCardReadRouter } from "./src/server/cards/readRouter";
import { createCardUpsertRouter } from "./src/server/cards/upsertRouter";
import { createComboRouter } from "./src/server/combo/router";
import { createAssetMediaRouter } from "./src/server/media/assetRouter";
import { createPrimaryMediaRouter } from "./src/server/media/primaryRouter";

dotenv.config();
dotenv.config({
  path: process.env.APP_ENV_FILE
    ? process.env.APP_ENV_FILE
    : process.env.APP_ENV
    ? `.env.${process.env.APP_ENV}`
    : process.env.NODE_ENV === "production"
      ? ".env.production"
      : ".env.local",
  override: false,
});

const runtimeConfig = getRuntimeConfig();
const runtimeConfigErrors = validateRuntimeConfig(runtimeConfig);
if (runtimeConfigErrors.length > 0) {
  throw new Error(`Invalid runtime configuration:\n${runtimeConfigErrors.join("\n")}`);
}

const app = express();
const PORT = runtimeConfig.port;
const MAX_VIDEO_UPLOAD_BYTES = Number.parseInt(process.env.MAX_VIDEO_UPLOAD_BYTES || String(100 * 1024 * 1024), 10);
const MAX_IMAGE_ASSET_UPLOAD_BYTES = Number.parseInt(process.env.MAX_IMAGE_ASSET_UPLOAD_BYTES || String(25 * 1024 * 1024), 10);
const MAX_DOCUMENT_UPLOAD_BYTES = Number.parseInt(process.env.MAX_DOCUMENT_UPLOAD_BYTES || String(20 * 1024 * 1024), 10);
const DIRECT_DOCUMENT_HARD_LIMIT_BYTES = 20 * 1024 * 1024;
const MAX_DOCUMENT_TEXT_CHARS = Number.parseInt(process.env.MAX_DOCUMENT_TEXT_CHARS || "300000", 10);
const OSS_IMAGE_PROCESSES: MediaProcesses = {
  "thumb-240": process.env.OSS_THUMB_240_PROCESS || "image/resize,w_240/quality,Q_70/format,webp",
  "thumb-480": process.env.OSS_THUMB_480_PROCESS || process.env.OSS_PRIMARY_THUMB_PROCESS || "image/resize,w_480/quality,Q_75/format,webp",
  "detail-1280": process.env.OSS_DETAIL_1280_PROCESS || "image/resize,w_1280/quality,Q_82/format,webp",
};
const OSS_VIDEO_POSTER_PROCESS = process.env.OSS_VIDEO_POSTER_PROCESS || "video/snapshot,t_1000,f_jpg,w_720";
const VIDEO_UPLOAD_ROOT = path.isAbsolute(runtimeConfig.localStorage.videoUploadRoot)
  ? runtimeConfig.localStorage.videoUploadRoot
  : path.join(process.cwd(), runtimeConfig.localStorage.videoUploadRoot);
const IMAGE_ASSET_UPLOAD_ROOT = path.isAbsolute(runtimeConfig.localStorage.imageAssetUploadRoot)
  ? runtimeConfig.localStorage.imageAssetUploadRoot
  : path.join(process.cwd(), runtimeConfig.localStorage.imageAssetUploadRoot);
const videoStorage = createVideoStorage({
  ...runtimeConfig,
  localStorage: {
    ...runtimeConfig.localStorage,
    videoUploadRoot: VIDEO_UPLOAD_ROOT,
  },
});
const imageAssetStorage = createImageAssetStorage({
  ...runtimeConfig,
  localStorage: {
    ...runtimeConfig.localStorage,
    imageAssetUploadRoot: IMAGE_ASSET_UPLOAD_ROOT,
  },
});
let directOssStorage: ReturnType<typeof createVideoStorage> | null = null;
const SUPPORTED_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 1,
  },
});
const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_VIDEO_UPLOAD_BYTES,
    files: 1,
  },
});
const imageAssetUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_ASSET_UPLOAD_BYTES,
    files: 1,
  },
});
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_DOCUMENT_UPLOAD_BYTES,
    files: 1,
  },
});
let directDocumentExtractionActive = false;

function getCompletionsUrl(baseUrl: string): string {
  let url = baseUrl.trim();
  if (!url.endsWith("/chat/completions") && !url.endsWith("/chat/completions/")) {
    if (url.endsWith("/")) {
      url = url + "chat/completions";
    } else {
      url = url + "/chat/completions";
    }
  }
  return url;
}

function cleanJsonText(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  return cleaned.trim();
}

function limitTermsResponse(parsedData: any): { terms: string[] } {
  const terms = Array.isArray(parsedData?.terms)
    ? parsedData.terms
        .filter((term: unknown): term is string => typeof term === "string")
        .map((term: string) => term.trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];

  return { terms };
}

function normalizeBookHints(value: unknown): string[] {
  let rawValue = value;
  if (typeof value === "string") {
    try {
      rawValue = JSON.parse(value);
    } catch {
      rawValue = value.split(/\r?\n|；|;/);
    }
  }

  if (!Array.isArray(rawValue)) return [];
  return rawValue
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const record = item as { title?: unknown; description?: unknown };
        return [record.title, record.description]
          .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
          .join("：");
      }
      return "";
    })
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, 20);
}

function buildBookHintPrompt(hints: string[]): string {
  if (hints.length === 0) return "";
  return ` When choosing terms, compare the content with these inspiration book names/descriptions and prefer their matching nouns when genuinely relevant: ${hints.join("；")}. Do not force a match if the content is unrelated.`;
}

function normalizeCustomTagHints(value: unknown): string[] {
  let rawValue = value;
  if (typeof value === "string") {
    try {
      rawValue = JSON.parse(value);
    } catch {
      rawValue = value.split(/\r?\n|,|，|；|;|、/);
    }
  }

  if (!Array.isArray(rawValue)) return [];
  const seen = new Set<string>();
  return rawValue
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 200);
}

function buildCustomTagHintPrompt(hints: string[]): string {
  if (hints.length === 0) return "";
  return ` The user maintains this custom tag library: ${hints.join("；")}. If the content is genuinely related, prefer exact terms from this library or generate very close variants. Do not force unrelated custom tags.`;
}

function getVideoExtension(filename: string, mimeType: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mov")) return "mov";
  if (lower.endsWith(".webm")) return "webm";
  if (lower.endsWith(".mp4")) return "mp4";
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType === "video/webm") return "webm";
  return "mp4";
}

function getImageExtension(filename: string, mimeType: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".webp")) return "webp";
  if (lower.endsWith(".gif")) return "gif";
  if (lower.endsWith(".jpeg")) return "jpeg";
  if (lower.endsWith(".jpg")) return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "jpg";
}

function getDocumentKind(filename: string, mimeType: string): "markdown" | "text" | "pdf" | "docx" | null {
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown") || mimeType === "text/markdown") return "markdown";
  if (lowerName.endsWith(".txt") || mimeType === "text/plain") return "text";
  if (lowerName.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (
    lowerName.endsWith(".docx") ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  return null;
}

function cleanExtractedDocumentText(text: string): { text: string; truncated: boolean } {
  const cleaned = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  if (cleaned.length <= MAX_DOCUMENT_TEXT_CHARS) {
    return { text: cleaned, truncated: false };
  }
  return { text: cleaned.slice(0, MAX_DOCUMENT_TEXT_CHARS).trim(), truncated: true };
}

async function extractDocumentText(file: Express.Multer.File, filenameOverride = ""): Promise<{ text: string; kind: string; truncated: boolean }> {
  const filename = filenameOverride || file.originalname || "";
  const kind = getDocumentKind(filename, file.mimetype || "");
  if (!kind) {
    throw new Error("不支持的文档格式，请上传 Markdown、TXT、PDF 或 DOCX。");
  }

  let rawText = "";
  if (kind === "markdown" || kind === "text") {
    rawText = file.buffer.toString("utf8");
  } else if (kind === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
    try {
      const parsed = await parser.getText();
      rawText = parsed.text || "";
    } finally {
      await parser.destroy();
    }
  } else if (kind === "docx") {
    const parsed = await mammoth.extractRawText({ buffer: file.buffer });
    rawText = parsed.value || "";
  }

  const result = cleanExtractedDocumentText(rawText);
  if (!result.text) {
    throw new Error(kind === "pdf" ? "没有从 PDF 中读取到可复制文本，扫描件暂不支持 OCR。" : "文档内容为空或无法读取。");
  }
  return { text: result.text, kind, truncated: result.truncated };
}

function sanitizeStorageSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function storageKeyToLocalPath(storageKey: string): string {
  const normalized = path.normalize(storageKey).replace(/^(\.\.(\/|\\|$))+/, "");
  const relativeKey = normalized.replace(/^videos[\/\\]/, "");
  return path.join(VIDEO_UPLOAD_ROOT, relativeKey);
}

function imageStorageKeyToLocalPath(storageKey: string): string {
  const normalized = path.normalize(storageKey).replace(/^(\.\.(\/|\\|$))+/, "");
  const relativeKey = normalized.replace(/^images[\/\\]/, "");
  return path.join(IMAGE_ASSET_UPLOAD_ROOT, relativeKey);
}

async function deleteVideoStorageObject(storageProvider: string, storageKey: string): Promise<void> {
  if (!storageKey) return;
  if (storageProvider === "oss") {
    await (directOssStorage || videoStorage).deleteObject(storageKey);
    return;
  }
  await fs.unlink(storageKeyToLocalPath(storageKey)).catch(() => undefined);
}

async function deleteImageAssetStorageObject(storageProvider: string, storageKey: string): Promise<void> {
  if (!storageKey) return;
  if (storageProvider === "oss") {
    await (directOssStorage || imageAssetStorage).deleteObject(storageKey);
    return;
  }
  await fs.unlink(imageStorageKeyToLocalPath(storageKey)).catch(() => undefined);
}

function getRequestOrigin(req: express.Request): string {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol || "http";
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || req.get("host") || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function absoluteUrl(value: string | null | undefined, req: express.Request): string {
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("data:") || value.startsWith("wxfile://")) return value;
  if (!value.startsWith("/")) return value;
  return `${getRequestOrigin(req)}${value}`;
}

const IMAGE_URL_TTL_SECONDS = Math.max(60, Number.parseInt(process.env.IMAGE_URL_TTL_SECONDS || "900", 10) || 900);
const signablePathPrefixes = ["/api/photos/", "/api/objects/", "/api/videos/", "/api/images/", "/api/combo-images/", "/api/combo-generations/"];

function isSignableInternalPath(pathname: string): boolean {
  return signablePathPrefixes.some((prefix) => pathname.startsWith(prefix));
}

function normalizeInternalProxyUrl(value: string | null | undefined): string {
  if (!value) return "";
  if (value.startsWith("/")) {
    const [pathname] = value.split("?");
    return isSignableInternalPath(pathname) ? pathname : value;
  }
  if (!/^https?:\/\//i.test(value)) return value;

  try {
    const url = new URL(value);
    return isSignableInternalPath(url.pathname) ? url.pathname : value;
  } catch {
    return value;
  }
}

function getImageSigningSecret(): string {
  return (
    process.env.IMAGE_URL_SIGNING_SECRET ||
    process.env.AUTH_SESSION_SECRET ||
    process.env.DATABASE_URL ||
    "inspiration-diary-local-image-signing"
  );
}

function signImagePath(pathname: string, expiresAt: number): string {
  return crypto
    .createHmac("sha256", getImageSigningSecret())
    .update(`${pathname}:${expiresAt}`)
    .digest("base64url");
}

function hasValidSignedImageUrl(req: express.Request): boolean {
  const expValue = Array.isArray(req.query.exp) ? req.query.exp[0] : req.query.exp;
  const sigValue = Array.isArray(req.query.sig) ? req.query.sig[0] : req.query.sig;
  if (typeof expValue !== "string" || typeof sigValue !== "string") return false;

  const expiresAt = Number(expValue);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  const expected = signImagePath(req.path, expiresAt);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(sigValue);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function signedImageUrl(value: string | null | undefined, req: express.Request): string {
  const resolved = absoluteUrl(value, req);
  if (!resolved || !/^https?:\/\//i.test(resolved)) return resolved;

  const origin = getRequestOrigin(req);
  let url: URL;
  try {
    url = new URL(resolved);
  } catch {
    return resolved;
  }

  const requestOrigin = new URL(origin);
  if (!isSignableInternalPath(url.pathname)) {
    return resolved;
  }

  url.protocol = requestOrigin.protocol;
  url.host = requestOrigin.host;
  const expiresAt = Date.now() + IMAGE_URL_TTL_SECONDS * 1000;
  url.searchParams.delete("miniToken");
  url.searchParams.delete("mini_session");
  url.searchParams.delete("token");
  url.searchParams.set("exp", String(expiresAt));
  url.searchParams.set("sig", signImagePath(url.pathname, expiresAt));
  return url.toString();
}

async function proxySignedObjectUrl(req: express.Request, res: express.Response, signedUrl: string) {
  const headers: Record<string, string> = {};
  const range = req.headers.range;
  if (typeof range === "string" && range) headers.Range = range;

  const upstream = await fetch(signedUrl, { headers });
  if (!upstream.ok && upstream.status !== 206) {
    const message = await upstream.text().catch(() => "");
    return res.status(upstream.status).send(message || "Object proxy failed.");
  }

  res.status(upstream.status);
  for (const header of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }
  res.setHeader("Cache-Control", "private, max-age=300");

  if (!upstream.body) return res.end();
  return Readable.fromWeb(upstream.body as any).pipe(res);
}

function mapVideoAssetRow(row: any, req: express.Request) {
  if (!row) return null;
  const isOssVideo = row.storage_provider === "oss" && Boolean(row.storage_key);
  return {
    id: row.id,
    cardId: row.card_id || "",
    storageProvider: row.storage_provider || "local",
    storageKey: row.storage_key || "",
    videoUrl: signedImageUrl(`/api/videos/${encodeURIComponent(row.id)}`, req),
    originalName: row.original_name || "video",
    mimeType: row.mime_type || "video/mp4",
    sizeBytes: Number(row.size_bytes || 0),
    durationMs: Number(row.duration_ms || 0),
    posterUrl: isOssVideo ? signedImageUrl(`/api/videos/${encodeURIComponent(row.id)}/poster`, req) : row.poster_url || "",
    createdAt: Number(row.created_at || 0),
  };
}

function mapVideoAssetsValue(value: any, req: express.Request) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => mapVideoAssetRow(item, req)).filter(Boolean);
}

function mapImageAssetRow(row: any, req: express.Request) {
  if (!row) return null;
  const originalUrl = signedImageUrl(`/api/images/${encodeURIComponent(row.id)}/original`, req);
  const isOssImage = row.storage_provider === "oss" && Boolean(row.storage_key);
  return {
    id: row.id,
    cardId: row.card_id || "",
    storageProvider: row.storage_provider || "local",
    storageKey: row.storage_key || "",
    thumbnail240Url: isOssImage ? signedImageUrl(`/api/images/${encodeURIComponent(row.id)}/thumb-240`, req) : originalUrl,
    thumbnailUrl: isOssImage ? signedImageUrl(`/api/images/${encodeURIComponent(row.id)}/thumb-480`, req) : originalUrl,
    imageUrl: isOssImage ? signedImageUrl(`/api/images/${encodeURIComponent(row.id)}/detail-1280`, req) : originalUrl,
    originalImageUrl: originalUrl,
    originalName: row.original_name || "image",
    mimeType: row.mime_type || "image/jpeg",
    sizeBytes: Number(row.size_bytes || 0),
    createdAt: Number(row.created_at || 0),
  };
}

function mapImageAssetsValue(value: any, req: express.Request) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => mapImageAssetRow(item, req)).filter(Boolean);
}

function normalizeComboImageRole(value: unknown): "character" | "scene" | "story" | "other" {
  return value === "character" || value === "scene" || value === "story" || value === "other" ? value : "other";
}

function mapComboImageRow(row: any, req: express.Request) {
  if (!row) return null;
  const originalUrl = signedImageUrl(`/api/combo-images/${encodeURIComponent(row.id)}/original`, req);
  const isOssImage = row.storage_provider === "oss" && Boolean(row.storage_key);
  return {
    id: row.id,
    cardId: row.card_id || "",
    role: normalizeComboImageRole(row.role),
    storageProvider: row.storage_provider || "local",
    storageKey: row.storage_key || "",
    thumbnail240Url: isOssImage ? signedImageUrl(`/api/combo-images/${encodeURIComponent(row.id)}/thumb-240`, req) : originalUrl,
    thumbnailUrl: isOssImage ? signedImageUrl(`/api/combo-images/${encodeURIComponent(row.id)}/thumb-480`, req) : originalUrl,
    imageUrl: isOssImage ? signedImageUrl(`/api/combo-images/${encodeURIComponent(row.id)}/detail-1280`, req) : originalUrl,
    originalImageUrl: originalUrl,
    originalName: row.original_name || "image",
    mimeType: row.mime_type || "image/jpeg",
    sizeBytes: Number(row.size_bytes || 0),
    sortOrder: Number(row.sort_order || 0),
    createdAt: Number(row.created_at || 0),
  };
}

function mapComboGenerationRow(row: any, req: express.Request) {
  if (!row) return null;
  const isOssVideo = row.storage_provider === "oss" && Boolean(row.storage_key);
  return {
    id: row.id,
    cardId: row.card_id || "",
    promptNote: row.prompt_note || "",
    storageProvider: row.storage_provider || "local",
    storageKey: row.storage_key || "",
    videoUrl: signedImageUrl(`/api/combo-generations/${encodeURIComponent(row.id)}/video`, req),
    originalName: row.original_name || "video",
    mimeType: row.mime_type || "video/mp4",
    sizeBytes: Number(row.size_bytes || 0),
    durationMs: Number(row.duration_ms || 0),
    posterUrl: isOssVideo
      ? signedImageUrl(`/api/combo-generations/${encodeURIComponent(row.id)}/poster`, req)
      : row.poster_url ? signedImageUrl(row.poster_url, req) : "",
    sortOrder: Number(row.sort_order || 0),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

function comboSummarySelectFor(alias: string): string {
  return `
    (SELECT ci.id
     FROM combo_images ci
     WHERE ci.user_id = ${alias}.user_id AND ci.card_id = ${alias}.id
     ORDER BY CASE ci.role WHEN 'character' THEN 0 ELSE 1 END, ci.sort_order ASC, ci.created_at ASC
     LIMIT 1) AS combo_cover_image_id,
    (SELECT COUNT(*)::int FROM combo_images ci WHERE ci.user_id = ${alias}.user_id AND ci.card_id = ${alias}.id) AS combo_image_count,
    (SELECT COUNT(*)::int FROM combo_generations cg WHERE cg.user_id = ${alias}.user_id AND cg.card_id = ${alias}.id) AS combo_generation_count
  `;
}

const comboSummarySelectSql = comboSummarySelectFor("cards");
const comboSummarySelectSqlForC = comboSummarySelectFor("c");
const comboSummarySelectSqlForC2 = comboSummarySelectFor("c2");

async function refreshComboCardSearchText(client: Pick<pg.PoolClient, "query">, userId: string, cardId: string): Promise<void> {
  const cardResult = await client.query(
    `SELECT terms, md_name, md_summary, insight_note
     FROM cards
     WHERE id = $1 AND user_id = $2`,
    [cardId, userId]
  );
  const card = cardResult.rows[0];
  if (!card) return;

  const comboTextResult = await client.query(
    `SELECT COALESCE(string_agg(text_part, ' '), '') AS combo_text
     FROM (
       SELECT role AS text_part
       FROM combo_images
       WHERE user_id = $1 AND card_id = $2
       UNION ALL
       SELECT prompt_note AS text_part
       FROM combo_generations
       WHERE user_id = $1 AND card_id = $2
       UNION ALL
       SELECT original_name AS text_part
       FROM combo_generations
       WHERE user_id = $1 AND card_id = $2
     ) parts
     WHERE COALESCE(text_part, '') <> ''`,
    [userId, cardId]
  );
  const termsText = [
    ...(Array.isArray(card.terms) ? card.terms : []),
    card.md_name,
    card.md_summary,
    card.insight_note,
    comboTextResult.rows[0]?.combo_text,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ");

  await client.query("UPDATE cards SET terms_text = $1 WHERE id = $2 AND user_id = $3", [termsText, cardId, userId]);
  await refreshKnowledgeCard(client, userId, cardId);
}

async function refreshKnowledgeCard(
  client: Pick<pg.PoolClient, "query">,
  userId: string,
  cardId: string,
): Promise<void> {
  if (!runtimeConfig.knowledgeBaseEnabled) return;
  const result = await createKnowledgeService(client).indexCard(userId, cardId);
  if (result.status === "not_found") {
    throw new Error("Knowledge source card was not found after persistence.");
  }
}

function primaryObjectUrl(storageKey: string, req: express.Request, variant: ImageVariant) {
  const routeByVariant: Record<ImageVariant, string> = {
    "thumb-240": "primary-thumb-240",
    "thumb-480": "primary-thumb",
    "detail-1280": "primary-detail",
    original: "primary",
  };
  return signedImageUrl(`/api/objects/${routeByVariant[variant]}/${encodeURIComponent(storageKey)}`, req);
}

function shouldUseOssPrimaryProxy(row: any) {
  if (typeof row.photo_uid !== "string") return false;
  return (
    (runtimeConfig.primaryImageStorageProvider === "oss" && row.photo_uid.startsWith("primary-images/")) ||
    row.photo_uid.includes("/primary_image/")
  );
}

function mapCardRows(rows: any[], req: express.Request) {
  return rows.map((row) => {
    const usesOssPrimary = shouldUseOssPrimaryProxy(row);
    const fallbackImageUrl = signedImageUrl(row.image_url, req);
    const fallbackThumbnailUrl = signedImageUrl(row.thumbnail_url, req) || fallbackImageUrl;
    return {
      id: row.id,
      weekId: row.week_id,
      dayIndex: row.day_index,
      imageUrl: usesOssPrimary ? primaryObjectUrl(row.photo_uid, req, "detail-1280") : fallbackImageUrl,
      thumbnail240Url: usesOssPrimary ? primaryObjectUrl(row.photo_uid, req, "thumb-240") : fallbackThumbnailUrl,
      thumbnailUrl: usesOssPrimary ? primaryObjectUrl(row.photo_uid, req, "thumb-480") : fallbackThumbnailUrl,
      originalImageUrl: usesOssPrimary ? primaryObjectUrl(row.photo_uid, req, "original") : fallbackImageUrl,
      photoUid: row.photo_uid || "",
      photoHash: row.photo_hash || "",
      terms: row.terms || [],
      decoType: row.deco_type,
      angle: Number(row.angle),
      createdAt: Number(row.created_at),
      type: row.type || "image",
      mdContent: row.md_content || "",
      mdSummary: row.md_summary || "",
      mdName: row.md_name || "",
      insightNote: row.insight_note || "",
      isFavorite: Boolean(row.is_favorite),
      favoritedAt: row.favorited_at == null ? null : Number(row.favorited_at),
      videoAssets: mapVideoAssetsValue(row.video_assets, req),
      imageAssets: mapImageAssetsValue(row.image_assets, req),
      comboSummary: (row.type || "image") === "combo" ? {
        coverImageUrl: row.combo_cover_image_id ? signedImageUrl(`/api/combo-images/${encodeURIComponent(row.combo_cover_image_id)}/thumb-480`, req) : "",
        coverDetailImageUrl: row.combo_cover_image_id ? signedImageUrl(`/api/combo-images/${encodeURIComponent(row.combo_cover_image_id)}/detail-1280`, req) : "",
        coverOriginalImageUrl: row.combo_cover_image_id ? signedImageUrl(`/api/combo-images/${encodeURIComponent(row.combo_cover_image_id)}/original`, req) : "",
        imageCount: Number(row.combo_image_count || 0),
        generationCount: Number(row.combo_generation_count || 0),
      } : undefined,
    };
  });
}

function mapBookRow(row: any, req: express.Request) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    cardCount: Number(row.card_count || 0),
    coverCardId: row.cover_card_id || "",
    coverCard: row.cover_card ? mapCardRows([row.cover_card], req)[0] : null,
  };
}

app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const apiKey = process.env.GEMINI_API_KEY;
const defaultThirdPartyBaseUrl = process.env.THIRD_PARTY_BASE_URL || process.env.OPENAI_COMPATIBLE_BASE_URL || "";
const defaultThirdPartyApiKey = process.env.THIRD_PARTY_API_KEY || process.env.OPENAI_API_KEY || "";
const defaultThirdPartyModel = process.env.THIRD_PARTY_MODEL || "doubao-seed-2.0-code";
const defaultThirdPartyThinking = process.env.THIRD_PARTY_THINKING === "true";
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
} else if (!defaultThirdPartyApiKey || !defaultThirdPartyBaseUrl) {
  console.warn("No default AI provider is configured. Set THIRD_PARTY_BASE_URL and THIRD_PARTY_API_KEY, or configure AI settings in the app.");
}

// ==========================================
// PostgreSQL Database Connection & CRUD routes
// ==========================================
const { Pool } = pg;
const dbType = runtimeConfig.databaseType;
let pgPool: pg.Pool | null = null;
let directUploadService: DirectUploadService | null = null;
let directUploadGateway: DirectUploadGateway | null = null;

if (dbType === "postgres") {
  console.log("Configuring server database for local/remote PostgreSQL...");
  pgPool = new Pool({
    connectionString: runtimeConfig.databaseUrl,
    ssl: runtimeConfig.databaseSsl ? { rejectUnauthorized: false } : false
  });

  // Initialize Postgres relational tables asynchronously on boot
  const initDb = async () => {
    try {
      const client = await pgPool!.connect();
      try {
        console.log("Initializing PostgreSQL database schema...");
        await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            display_name TEXT,
            role TEXT NOT NULL DEFAULT 'user',
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL
          );
        `);
        await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(40);");
        await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;");
        await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users(phone) WHERE phone IS NOT NULL AND phone <> '';");
        await client.query(`
          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at BIGINT NOT NULL,
            expires_at BIGINT NOT NULL,
            last_seen_at BIGINT NOT NULL,
            user_agent TEXT
          );
        `);
        await client.query("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);");
        await client.query(`
          CREATE TABLE IF NOT EXISTS wechat_identities (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            mini_openid TEXT NOT NULL UNIQUE,
            unionid TEXT,
            phone TEXT,
            nickname TEXT,
            avatar_url TEXT,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL
          );
        `);
        await client.query("CREATE INDEX IF NOT EXISTS idx_wechat_identities_user_id ON wechat_identities(user_id);");
        await client.query(`
          CREATE TABLE IF NOT EXISTS mini_program_sessions (
            id TEXT PRIMARY KEY,
            identity_id UUID NOT NULL REFERENCES wechat_identities(id) ON DELETE CASCADE,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            created_at BIGINT NOT NULL,
            expires_at BIGINT NOT NULL,
            last_seen_at BIGINT NOT NULL
          );
        `);
        await client.query("CREATE INDEX IF NOT EXISTS idx_mini_program_sessions_user_id ON mini_program_sessions(user_id);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_mini_program_sessions_expires_at ON mini_program_sessions(expires_at);");
        await client.query(`
          CREATE TABLE IF NOT EXISTS notes (
            week_id VARCHAR(50) PRIMARY KEY,
            note TEXT,
            height INTEGER,
            updated_at BIGINT
          );
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS cards (
            id VARCHAR(50) PRIMARY KEY,
            week_id VARCHAR(50) NOT NULL,
            day_index INTEGER NOT NULL,
            image_url TEXT NOT NULL,
            terms TEXT[] NOT NULL,
            deco_type VARCHAR(50),
            angle NUMERIC,
            created_at BIGINT
          );
        `);
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS photo_uid TEXT;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS photo_hash TEXT;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS terms_text TEXT;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'image';");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS md_content TEXT;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS md_summary TEXT;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS md_name VARCHAR(255);");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS insight_note TEXT;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS favorited_at BIGINT;");
        await client.query(`
          UPDATE cards
          SET image_url = split_part(regexp_replace(image_url, '^https?://[^/]+', ''), '?', 1)
          WHERE image_url ~ '^https?://[^/]+/api/(photos|objects|videos|images|combo-images|combo-generations)/';
        `);
        await client.query(`
          UPDATE cards
          SET thumbnail_url = split_part(regexp_replace(thumbnail_url, '^https?://[^/]+', ''), '?', 1)
          WHERE thumbnail_url ~ '^https?://[^/]+/api/(photos|objects|videos|images|combo-images|combo-generations)/';
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS video_assets (
            id VARCHAR(80) PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            card_id VARCHAR(50) REFERENCES cards(id) ON DELETE CASCADE,
            storage_provider VARCHAR(20) NOT NULL DEFAULT 'local',
            storage_key TEXT NOT NULL,
            original_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes BIGINT NOT NULL,
            duration_ms BIGINT DEFAULT 0,
            poster_url TEXT,
            created_at BIGINT NOT NULL
          );
        `);
        await client.query("CREATE INDEX IF NOT EXISTS idx_video_assets_user_card ON video_assets(user_id, card_id, created_at DESC);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_video_assets_storage_key ON video_assets(storage_provider, storage_key);");
        await client.query(`
          CREATE TABLE IF NOT EXISTS image_assets (
            id VARCHAR(80) PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            card_id VARCHAR(50) REFERENCES cards(id) ON DELETE CASCADE,
            storage_provider VARCHAR(20) NOT NULL DEFAULT 'local',
            storage_key TEXT NOT NULL,
            original_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes BIGINT NOT NULL,
            created_at BIGINT NOT NULL
          );
        `);
        await client.query("CREATE INDEX IF NOT EXISTS idx_image_assets_user_card ON image_assets(user_id, card_id, created_at DESC);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_image_assets_storage_key ON image_assets(storage_provider, storage_key);");
        await client.query(`
          CREATE TABLE IF NOT EXISTS combo_images (
            id VARCHAR(80) PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            card_id VARCHAR(50) NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
            role VARCHAR(20) NOT NULL DEFAULT 'other',
            storage_provider VARCHAR(20) NOT NULL DEFAULT 'local',
            storage_key TEXT NOT NULL,
            original_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes BIGINT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at BIGINT NOT NULL
          );
        `);
        await client.query("CREATE INDEX IF NOT EXISTS idx_combo_images_user_card ON combo_images(user_id, card_id, sort_order, created_at);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_combo_images_storage_key ON combo_images(storage_provider, storage_key);");
        await client.query(`
          CREATE TABLE IF NOT EXISTS combo_generations (
            id VARCHAR(80) PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            card_id VARCHAR(50) NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
            prompt_note TEXT NOT NULL DEFAULT '',
            storage_provider VARCHAR(20) NOT NULL DEFAULT 'local',
            storage_key TEXT NOT NULL,
            original_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes BIGINT NOT NULL,
            duration_ms BIGINT DEFAULT 0,
            poster_url TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL
          );
        `);
        await client.query("CREATE INDEX IF NOT EXISTS idx_combo_generations_user_card ON combo_generations(user_id, card_id, sort_order, created_at);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_combo_generations_storage_key ON combo_generations(storage_provider, storage_key);");
        await client.query("UPDATE cards SET terms_text = CONCAT_WS(' ', array_to_string(terms, ' '), md_name, md_summary, insight_note) WHERE terms_text IS NULL OR terms_text = '';");
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_created_at_desc ON cards (created_at DESC);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_week_created_at ON cards (week_id, created_at);");
        try {
          await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
          await client.query("CREATE INDEX IF NOT EXISTS idx_cards_terms_text_trgm ON cards USING gin (terms_text gin_trgm_ops);");
        } catch (indexErr) {
          console.warn("PostgreSQL trigram index setup skipped:", indexErr);
        }
        console.log("PostgreSQL schema successfully verified/created.");
        await client.query(`
          CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(100) PRIMARY KEY,
            value TEXT,
            updated_at BIGINT
          );
        `);
        await client.query("ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;");
        await client.query("ALTER TABLE settings ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;");
        await client.query(`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1
              FROM pg_constraint
              WHERE conrelid = 'notes'::regclass
                AND conname = 'notes_pkey'
            ) THEN
              ALTER TABLE notes DROP CONSTRAINT notes_pkey;
            END IF;
          END $$;
        `);
        await client.query(`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1
              FROM pg_constraint
              WHERE conrelid = 'settings'::regclass
                AND conname = 'settings_pkey'
            ) THEN
              ALTER TABLE settings DROP CONSTRAINT settings_pkey;
            END IF;
          END $$;
        `);
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_created_at ON cards(user_id, created_at DESC);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_week_created_at ON cards(user_id, week_id, created_at);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_photo_uid ON cards(user_id, photo_uid);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_favorite_created_at ON cards(user_id, is_favorite, created_at DESC);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_favorited_at ON cards(user_id, favorited_at DESC);");
        await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_user_week ON notes(user_id, week_id);");
        await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_user_key ON settings(user_id, key);");
        await client.query(`
          CREATE TABLE IF NOT EXISTS inspiration_books (
            id TEXT PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            description TEXT,
            cover_card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL
          );
        `);
        await client.query("ALTER TABLE inspiration_books ADD COLUMN IF NOT EXISTS cover_card_id TEXT REFERENCES cards(id) ON DELETE SET NULL;");
        await client.query(`
          CREATE TABLE IF NOT EXISTS inspiration_book_cards (
            book_id TEXT NOT NULL REFERENCES inspiration_books(id) ON DELETE CASCADE,
            card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            added_at BIGINT NOT NULL
          );
        `);
        await client.query("CREATE INDEX IF NOT EXISTS idx_inspiration_books_user_updated_at ON inspiration_books(user_id, updated_at DESC);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_inspiration_books_user_cover_card ON inspiration_books(user_id, cover_card_id);");
        await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_inspiration_book_cards_unique ON inspiration_book_cards(user_id, book_id, card_id);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_inspiration_book_cards_user_book_added_at ON inspiration_book_cards(user_id, book_id, added_at DESC);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_inspiration_book_cards_user_card ON inspiration_book_cards(user_id, card_id);");
        await client.query(`
          CREATE TABLE IF NOT EXISTS book_suggestion_feedback (
            id TEXT PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
            suggested_book_id TEXT REFERENCES inspiration_books(id) ON DELETE SET NULL,
            selected_book_id TEXT REFERENCES inspiration_books(id) ON DELETE SET NULL,
            action TEXT NOT NULL,
            matched_terms JSONB NOT NULL DEFAULT '[]'::jsonb,
            score REAL NOT NULL DEFAULT 0,
            created_at BIGINT NOT NULL
          );
        `);
        await client.query("CREATE INDEX IF NOT EXISTS idx_book_suggestion_feedback_user_created_at ON book_suggestion_feedback(user_id, created_at DESC);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_book_suggestion_feedback_user_card ON book_suggestion_feedback(user_id, card_id);");
        const userCount = await client.query("SELECT COUNT(*)::int AS count FROM users");
        if (Number(userCount.rows[0]?.count || 0) === 0) {
          const bootstrapEmail = process.env.AUTH_BOOTSTRAP_EMAIL || "local-admin@example.com";
          const bootstrapPassword = process.env.AUTH_BOOTSTRAP_PASSWORD;
          if (!bootstrapPassword) {
            console.warn("AUTH_BOOTSTRAP_PASSWORD is not set. Existing data will be assigned after first registration.");
          } else {
            const bcrypt = await import("bcryptjs");
            const passwordHash = await bcrypt.default.hash(bootstrapPassword, 12);
            await client.query(
              `INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
               VALUES (gen_random_uuid(), $1, $2, 'Local Admin', 'admin', $3, $3)
               ON CONFLICT (email) DO NOTHING`,
              [bootstrapEmail.trim().toLowerCase(), passwordHash, Date.now()]
            );
          }
        }

        const ownerResult = await client.query("SELECT id FROM users ORDER BY created_at ASC LIMIT 1");
        const ownerId = ownerResult.rows[0]?.id;
        if (ownerId) {
          await client.query("UPDATE notes SET user_id = $1 WHERE user_id IS NULL", [ownerId]);
          await client.query("UPDATE cards SET user_id = $1 WHERE user_id IS NULL", [ownerId]);
          await client.query("UPDATE settings SET user_id = $1 WHERE user_id IS NULL", [ownerId]);
        }
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("PostgreSQL database connection/init error:", err);
    }
  };
  initDb();
}

if (pgPool) {
  app.use("/api/auth", createAuthRouter(pgPool));
}

const requirePostgresAuth = createRequirePostgresAuth(pgPool);

if (runtimeConfig.directUpload.mode === "off") {
  app.use(
    "/api/uploads",
    createDirectUploadRouter({
      mode: "off",
      service: {
        authorize: async () => undefined,
        complete: async () => undefined,
        get: async () => undefined,
        abort: async () => undefined,
      },
    }),
  );
} else if (pgPool) {
  directUploadGateway = createOssDirectUploadGateway(runtimeConfig);
  directOssStorage = createVideoStorage({
    ...runtimeConfig,
    videoStorageProvider: "oss",
  });
  directUploadService = createDirectUploadService({
    repository: createUploadSessionRepository(pgPool),
    gateway: directUploadGateway,
    config: {
      authorizationTtlSeconds: runtimeConfig.directUpload.authorizationTtlSeconds,
      videoStsTtlSeconds: runtimeConfig.directUpload.videoStsTtlSeconds,
      activeSessionsPerUser: runtimeConfig.directUpload.activeSessionsPerUser,
      authorizationsPerMinute: runtimeConfig.directUpload.authorizationsPerMinute,
      maxImageBytes: runtimeConfig.directUpload.maxImageBytes,
      maxDocumentBytes: runtimeConfig.directUpload.maxDocumentBytes,
      maxVideoBytes: runtimeConfig.directUpload.maxVideoBytes,
    },
    log: (entry) => console.log(JSON.stringify(entry)),
  });
  app.use(
    "/api/uploads",
    requirePostgresAuth,
    createDirectUploadRouter({
      mode: runtimeConfig.directUpload.mode,
      service: directUploadService,
    }),
  );
}

app.get("/api/runtime-capabilities", requirePostgresAuth, (_req, res) => {
  return res.json(getRuntimeCapabilities(runtimeConfig));
});

app.use(
  "/api/knowledge",
  requirePostgresAuth,
  createKnowledgeRouter({
    mode: runtimeConfig.knowledgeBaseEnabled,
    ...(pgPool ? { pool: pgPool } : {}),
  }),
);

function getDirectUploadId(req: express.Request, field = "uploadId"): string {
  if (!req.is("application/json")) return "";
  const value = req.body?.[field];
  return typeof value === "string" ? value.trim() : "";
}

function directBusinessId(prefix: string, uploadId: string): string {
  return `${prefix}_${uploadId.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 80);
}

function sendDirectUploadBusinessError(
  res: express.Response,
  error: unknown,
  fallbackMessage: string,
) {
  if (
    error instanceof DirectUploadServiceError ||
    error instanceof DirectUploadBusinessClaimError
  ) {
    return res.status(error.httpStatus).json({ error: error.message, code: error.code });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ error: fallbackMessage });
}

function requireDirectBusinessUpload(res: express.Response): DirectUploadService | null {
  if (!directUploadService || !pgPool) {
    res.status(404).json({ error: "Direct upload is not available." });
    return null;
  }
  return directUploadService;
}

async function claimDirectImageAsset(req: AuthenticatedRequest, res: express.Response, uploadId: string) {
  const service = requireDirectBusinessUpload(res);
  if (!service || !pgPool) return;
  const userId = req.user!.id;
  const cardId = String(req.body.cardId || "").trim();
  if (!cardId) return res.status(400).json({ error: "cardId is required." });
  const assetId = directBusinessId("image", uploadId);
  try {
    const claimed = await claimBusinessUpload({
      pool: pgPool,
      service,
      user: req.user!,
      uploadId,
      expectedKinds: ["image_asset"],
      write: async (client, upload) => {
        const card = await client.query("SELECT id, type FROM cards WHERE id = $1 AND user_id = $2", [cardId, userId]);
        if (card.rowCount === 0) throw new DirectUploadBusinessClaimError("claimed_business_record_missing", "Card not found.", 404);
        if ((card.rows[0].type || "image") !== "video") {
          throw new DirectUploadBusinessClaimError("claimed_business_record_missing", "只有视频卡片可以绑定图片。", 400);
        }
        const result = await client.query(
          `INSERT INTO image_assets (id, user_id, card_id, storage_provider, storage_key, original_name, mime_type, size_bytes, created_at)
           VALUES ($1, $2, $3, 'oss', $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING
           RETURNING id, card_id, storage_provider, storage_key, original_name, mime_type, size_bytes, created_at`,
          [assetId, userId, cardId, upload.finalObjectKey, upload.originalName, upload.declaredMimeType, upload.declaredSize, Date.now()],
        );
        if (!result.rows[0]) throw new DirectUploadBusinessClaimError("claimed_business_record_missing", "Image upload was already assigned.", 409);
        return result.rows[0];
      },
      readExisting: async (client, session) => {
        const result = await client.query(
          `SELECT id, card_id, storage_provider, storage_key, original_name, mime_type, size_bytes, created_at
           FROM image_assets WHERE id = $1 AND user_id = $2 AND card_id = $3 AND storage_key = $4`,
          [assetId, userId, cardId, session.finalObjectKey || ""],
        );
        return result.rows[0] || null;
      },
    });
    return res.json({ image: mapImageAssetRow(claimed.value, req) });
  } catch (error) {
    return sendDirectUploadBusinessError(res, error, "Image upload claim failed.");
  }
}

async function claimDirectVideoAsset(req: AuthenticatedRequest, res: express.Response, uploadId: string) {
  const service = requireDirectBusinessUpload(res);
  if (!service || !pgPool) return;
  const userId = req.user!.id;
  const now = Date.now();
  const assetId = directBusinessId("video", uploadId);
  const cardIdInput = String(req.body.cardId || "").trim();
  const shouldCreateCard = !cardIdInput;
  const cardId = cardIdInput || String(req.body.newCardId || `card_${crypto.randomBytes(8).toString("hex")}_${now.toString(36)}`).trim();
  const weekId = String(req.body.weekId || "").trim();
  const dayIndex = Number.parseInt(String(req.body.dayIndex ?? "0"), 10);
  const bookId = String(req.body.bookId || "").trim();
  const durationMs = Number.parseInt(String(req.body.durationMs || "0"), 10) || 0;
  if (shouldCreateCard && !weekId) {
    return res.status(400).json({ error: "weekId is required for standalone video cards." });
  }

  const selectCard = async (client: Pick<pg.PoolClient, "query">) => client.query(
    `SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash, terms, deco_type, angle, created_at, type, md_content, md_summary, md_name, insight_note, is_favorite, favorited_at,
            ${comboSummarySelectSql},
            (SELECT COALESCE(json_agg(va ORDER BY va.created_at DESC), '[]'::json)
             FROM video_assets va WHERE va.user_id = cards.user_id AND va.card_id = cards.id) AS video_assets,
            (SELECT COALESCE(json_agg(ia ORDER BY ia.created_at DESC), '[]'::json)
             FROM image_assets ia WHERE ia.user_id = cards.user_id AND ia.card_id = cards.id) AS image_assets
     FROM cards WHERE id = $1 AND user_id = $2`,
    [cardId, userId],
  );

  try {
    const claimed = await claimBusinessUpload({
      pool: pgPool,
      service,
      user: req.user!,
      uploadId,
      expectedKinds: ["video"],
      write: async (client, upload) => {
        if (shouldCreateCard) {
          const createdCard = await client.query(
            `INSERT INTO cards (id, user_id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash, terms, terms_text, deco_type, angle, created_at, type, md_content, md_summary, md_name, insight_note)
             VALUES ($1, $2, $3, $4, '', '', '', '', $5, $6, 'paperclip', 0, $7, 'video', NULL, NULL, NULL, NULL)
             ON CONFLICT (id)
             DO UPDATE SET week_id = EXCLUDED.week_id, day_index = EXCLUDED.day_index, terms = EXCLUDED.terms,
                           terms_text = EXCLUDED.terms_text, created_at = EXCLUDED.created_at, type = 'video'
             WHERE cards.user_id = EXCLUDED.user_id
             RETURNING id`,
            [cardId, userId, weekId, Number.isFinite(dayIndex) ? dayIndex : 0, ["视频灵感", "待整理"], "视频灵感 待整理", now],
          );
          if (!createdCard.rows[0]) {
            throw new DirectUploadBusinessClaimError("claimed_business_record_missing", "Card belongs to another user.", 409);
          }
        } else {
          const card = await client.query("SELECT id FROM cards WHERE id = $1 AND user_id = $2", [cardId, userId]);
          if (card.rowCount === 0) throw new DirectUploadBusinessClaimError("claimed_business_record_missing", "Card not found.", 404);
        }

        const asset = await client.query(
          `INSERT INTO video_assets (id, user_id, card_id, storage_provider, storage_key, original_name, mime_type, size_bytes, duration_ms, poster_url, created_at)
           VALUES ($1, $2, $3, 'oss', $4, $5, $6, $7, $8, '', $9)
           ON CONFLICT (id) DO NOTHING
           RETURNING id, card_id, storage_provider, storage_key, original_name, mime_type, size_bytes, duration_ms, poster_url, created_at`,
          [assetId, userId, cardId, upload.finalObjectKey, upload.originalName, upload.declaredMimeType, upload.declaredSize, durationMs, now],
        );
        if (!asset.rows[0]) throw new DirectUploadBusinessClaimError("claimed_business_record_missing", "Video upload was already assigned.", 409);

        if (bookId && shouldCreateCard) {
          const book = await client.query("SELECT id FROM inspiration_books WHERE id = $1 AND user_id = $2", [bookId, userId]);
          if (book.rowCount > 0) {
            await client.query(
              `INSERT INTO inspiration_book_cards (user_id, book_id, card_id, added_at)
               VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, book_id, card_id) DO NOTHING`,
              [userId, bookId, cardId, now],
            );
            await client.query("UPDATE inspiration_books SET updated_at = $1 WHERE id = $2 AND user_id = $3", [now, bookId, userId]);
          }
        }
        await refreshKnowledgeCard(client, userId, cardId);
        const card = await selectCard(client);
        return { asset: asset.rows[0], card: card.rows[0] };
      },
      readExisting: async (client, session) => {
        const asset = await client.query(
          `SELECT id, card_id, storage_provider, storage_key, original_name, mime_type, size_bytes, duration_ms, poster_url, created_at
           FROM video_assets WHERE id = $1 AND user_id = $2 AND card_id = $3 AND storage_key = $4`,
          [assetId, userId, cardId, session.finalObjectKey || ""],
        );
        if (!asset.rows[0]) return null;
        const card = await selectCard(client);
        return card.rows[0] ? { asset: asset.rows[0], card: card.rows[0] } : null;
      },
    });
    return res.json({
      card: mapCardRows([claimed.value.card], req)[0],
      video: mapVideoAssetRow(claimed.value.asset, req),
    });
  } catch (error) {
    return sendDirectUploadBusinessError(res, error, "Video upload claim failed.");
  }
}

function normalizedCardInput(req: AuthenticatedRequest) {
  const body = req.body || {};
  const safeTerms = Array.isArray(body.terms) ? body.terms : [];
  const termsText = [...safeTerms, body.mdName, body.mdSummary, body.insightNote]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ");
  return {
    id: String(body.id || "").trim(),
    weekId: String(body.weekId || "").trim(),
    dayIndex: Number.parseInt(String(body.dayIndex ?? "0"), 10) || 0,
    terms: safeTerms,
    termsText,
    decoType: body.decoType,
    angle: Number(body.angle || 0),
    createdAt: Number(body.createdAt || Date.now()),
    type: String(body.type || "image"),
    mdContent: body.mdContent || null,
    mdSummary: body.mdSummary || null,
    mdName: body.mdName || null,
    insightNote: body.insightNote || null,
  };
}

async function upsertDirectCard(
  client: Pick<pg.PoolClient, "query">,
  userId: string,
  input: ReturnType<typeof normalizedCardInput>,
  primaryStorageKey: string,
) {
  if (!input.id || !input.weekId) {
    throw new DirectUploadBusinessClaimError("claimed_business_record_missing", "Card id and weekId are required.", 400);
  }
  const result = await client.query(
    `INSERT INTO cards (id, user_id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash, terms, terms_text, deco_type, angle, created_at, type, md_content, md_summary, md_name, insight_note)
     VALUES ($1, $2, $3, $4, '', '', $5, '', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (id)
     DO UPDATE SET week_id = EXCLUDED.week_id, day_index = EXCLUDED.day_index, image_url = EXCLUDED.image_url,
                   thumbnail_url = EXCLUDED.thumbnail_url, photo_uid = EXCLUDED.photo_uid, photo_hash = EXCLUDED.photo_hash,
                   terms = EXCLUDED.terms, terms_text = EXCLUDED.terms_text, deco_type = EXCLUDED.deco_type, angle = EXCLUDED.angle,
                   created_at = EXCLUDED.created_at, type = EXCLUDED.type, md_content = EXCLUDED.md_content,
                   md_summary = EXCLUDED.md_summary, md_name = EXCLUDED.md_name, insight_note = EXCLUDED.insight_note
     WHERE cards.user_id = EXCLUDED.user_id
     RETURNING id, photo_uid`,
    [
      input.id,
      userId,
      input.weekId,
      input.dayIndex,
      primaryStorageKey,
      input.terms,
      input.termsText,
      input.decoType,
      input.angle,
      input.createdAt,
      input.type,
      input.mdContent,
      input.mdSummary,
      input.mdName,
      input.insightNote,
    ],
  );
  if (result.rows[0]) await refreshKnowledgeCard(client, userId, input.id);
  return result;
}

async function claimDirectPrimaryCard(req: AuthenticatedRequest, res: express.Response, uploadId: string) {
  const service = requireDirectBusinessUpload(res);
  if (!service || !pgPool) return;
  const userId = req.user!.id;
  const card = normalizedCardInput(req);
  try {
    await claimBusinessUpload({
      pool: pgPool,
      service,
      user: req.user!,
      uploadId,
      expectedKinds: ["primary_image"],
      write: async (client, upload) => {
        const result = await upsertDirectCard(client, userId, card, upload.finalObjectKey || "");
        if (!result.rows[0]) throw new DirectUploadBusinessClaimError("claimed_business_record_missing", "Card belongs to another user.", 409);
        return result.rows[0];
      },
      readExisting: async (client, session) => {
        const result = await client.query(
          "SELECT id, photo_uid FROM cards WHERE id = $1 AND user_id = $2 AND photo_uid = $3",
          [card.id, userId, session.finalObjectKey || ""],
        );
        return result.rows[0] || null;
      },
    });
    return res.json({ success: true });
  } catch (error) {
    return sendDirectUploadBusinessError(res, error, "Card image claim failed.");
  }
}

async function claimDirectDocumentCard(req: AuthenticatedRequest, res: express.Response, uploadId: string) {
  const service = requireDirectBusinessUpload(res);
  if (!service || !pgPool) return;
  const userId = req.user!.id;
  const card = normalizedCardInput(req);
  const documentId = directBusinessId("document", uploadId);
  try {
    await claimBusinessUpload({
      pool: pgPool,
      service,
      user: req.user!,
      uploadId,
      expectedKinds: ["document"],
      write: async (client, upload) => {
        const cardResult = await upsertDirectCard(client, userId, card, "");
        if (!cardResult.rows[0]) throw new DirectUploadBusinessClaimError("claimed_business_record_missing", "Card belongs to another user.", 409);
        const asset = await client.query(
          `INSERT INTO document_assets (id, user_id, card_id, storage_provider, storage_key, original_name, mime_type, size_bytes, created_at)
           VALUES ($1, $2, $3, 'oss', $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING
           RETURNING id, storage_key`,
          [documentId, userId, card.id, upload.finalObjectKey, upload.originalName, upload.declaredMimeType, upload.declaredSize, Date.now()],
        );
        if (!asset.rows[0]) throw new DirectUploadBusinessClaimError("claimed_business_record_missing", "Document upload was already assigned.", 409);
        await refreshKnowledgeCard(client, userId, card.id);
        return asset.rows[0];
      },
      readExisting: async (client, session) => {
        const result = await client.query(
          `SELECT id, storage_key FROM document_assets
           WHERE id = $1 AND user_id = $2 AND card_id = $3 AND storage_key = $4`,
          [documentId, userId, card.id, session.finalObjectKey || ""],
        );
        return result.rows[0] || null;
      },
    });
    return res.json({ success: true });
  } catch (error) {
    return sendDirectUploadBusinessError(res, error, "Document claim failed.");
  }
}

async function claimDirectComboImage(req: AuthenticatedRequest, res: express.Response, uploadId: string) {
  const service = requireDirectBusinessUpload(res);
  if (!service || !pgPool) return;
  const userId = req.user!.id;
  const cardId = req.params.id;
  const role = normalizeComboImageRole(req.body.role);
  const sortOrder = Number.parseInt(String(req.body.sortOrder || "0"), 10) || 0;
  const imageId = directBusinessId("combo_img", uploadId);
  try {
    const claimed = await claimBusinessUpload({
      pool: pgPool,
      service,
      user: req.user!,
      uploadId,
      expectedKinds: ["combo_image"],
      write: async (client, upload) => {
        const card = await client.query("SELECT id FROM cards WHERE id = $1 AND user_id = $2 AND type = 'combo'", [cardId, userId]);
        if (card.rowCount === 0) throw new DirectUploadBusinessClaimError("claimed_business_record_missing", "Combo card not found.", 404);
        const result = await client.query(
          `INSERT INTO combo_images (id, user_id, card_id, role, storage_provider, storage_key, original_name, mime_type, size_bytes, sort_order, created_at)
           VALUES ($1, $2, $3, $4, 'oss', $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING
           RETURNING id, card_id, role, storage_provider, storage_key, original_name, mime_type, size_bytes, sort_order, created_at`,
          [imageId, userId, cardId, role, upload.finalObjectKey, upload.originalName, upload.declaredMimeType, upload.declaredSize, sortOrder, Date.now()],
        );
        if (!result.rows[0]) throw new DirectUploadBusinessClaimError("claimed_business_record_missing", "Combo image was already assigned.", 409);
        await refreshComboCardSearchText(client as pg.PoolClient, userId, cardId);
        return result.rows[0];
      },
      readExisting: async (client, session) => {
        const result = await client.query(
          `SELECT id, card_id, role, storage_provider, storage_key, original_name, mime_type, size_bytes, sort_order, created_at
           FROM combo_images WHERE id = $1 AND user_id = $2 AND card_id = $3 AND storage_key = $4`,
          [imageId, userId, cardId, session.finalObjectKey || ""],
        );
        return result.rows[0] || null;
      },
    });
    return res.json({ image: mapComboImageRow(claimed.value, req) });
  } catch (error) {
    return sendDirectUploadBusinessError(res, error, "Combo image upload claim failed.");
  }
}

async function claimDirectComboGeneration(req: AuthenticatedRequest, res: express.Response, uploadId: string) {
  const service = requireDirectBusinessUpload(res);
  if (!service || !pgPool) return;
  const userId = req.user!.id;
  const cardId = req.params.id;
  const promptNote = String(req.body.promptNote || req.body.prompt || "").trim();
  const sortOrder = Number.parseInt(String(req.body.sortOrder || "0"), 10) || 0;
  const durationMs = Number.parseInt(String(req.body.durationMs || "0"), 10) || 0;
  const generationId = directBusinessId("combo_gen", uploadId);
  try {
    const claimed = await claimBusinessUpload({
      pool: pgPool,
      service,
      user: req.user!,
      uploadId,
      expectedKinds: ["combo_video"],
      write: async (client, upload) => {
        const card = await client.query("SELECT id FROM cards WHERE id = $1 AND user_id = $2 AND type = 'combo'", [cardId, userId]);
        if (card.rowCount === 0) throw new DirectUploadBusinessClaimError("claimed_business_record_missing", "Combo card not found.", 404);
        const now = Date.now();
        const result = await client.query(
          `INSERT INTO combo_generations (id, user_id, card_id, prompt_note, storage_provider, storage_key, original_name, mime_type, size_bytes, duration_ms, poster_url, sort_order, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'oss', $5, $6, $7, $8, $9, '', $10, $11, $11)
           ON CONFLICT (id) DO NOTHING
           RETURNING id, card_id, prompt_note, storage_provider, storage_key, original_name, mime_type, size_bytes, duration_ms, poster_url, sort_order, created_at, updated_at`,
          [generationId, userId, cardId, promptNote, upload.finalObjectKey, upload.originalName, upload.declaredMimeType, upload.declaredSize, durationMs, sortOrder, now],
        );
        if (!result.rows[0]) throw new DirectUploadBusinessClaimError("claimed_business_record_missing", "Combo generation was already assigned.", 409);
        await refreshComboCardSearchText(client as pg.PoolClient, userId, cardId);
        return result.rows[0];
      },
      readExisting: async (client, session) => {
        const result = await client.query(
          `SELECT id, card_id, prompt_note, storage_provider, storage_key, original_name, mime_type, size_bytes, duration_ms, poster_url, sort_order, created_at, updated_at
           FROM combo_generations WHERE id = $1 AND user_id = $2 AND card_id = $3 AND storage_key = $4`,
          [generationId, userId, cardId, session.finalObjectKey || ""],
        );
        return result.rows[0] || null;
      },
    });
    return res.json({ generation: mapComboGenerationRow(claimed.value, req) });
  } catch (error) {
    return sendDirectUploadBusinessError(res, error, "Combo generation upload claim failed.");
  }
}

if (pgPool) {
  app.use("/api/miniprogram", requirePostgresAuth, createMiniprogramRouter(pgPool));
} else {
  app.use("/api/miniprogram", requirePostgresAuth);
}

app.post("/api/documents/extract-text", requirePostgresAuth, documentUpload.single("document"), async (req, res) => {
  try {
    const directUploadId = getDirectUploadId(req);
    if (directUploadId) {
      if (!directUploadService || !directUploadGateway) {
        return res.status(404).json({ error: "Direct upload is not available." });
      }
      if (directDocumentExtractionActive) {
        return res.status(429).json({ error: "已有文档正在解析，请稍后重试。" });
      }
      directDocumentExtractionActive = true;
      try {
        const authReq = req as AuthenticatedRequest;
        const session = await directUploadService.get(authReq.user!, directUploadId);
        if (session.mediaKind !== "document") {
          return res.status(415).json({ error: "Upload media kind is not a document." });
        }
        if (session.status !== "finalized" || !session.finalObjectKey) {
          return res.status(409).json({ error: "Document upload is not finalized." });
        }
        if (session.size > DIRECT_DOCUMENT_HARD_LIMIT_BYTES) {
          return res.status(413).json({ error: "文档不能超过 20MB。" });
        }
        const bytes = await directUploadGateway.readObject(
          session.finalObjectKey,
          DIRECT_DOCUMENT_HARD_LIMIT_BYTES,
        );
        if (bytes.byteLength !== session.size || bytes.byteLength > DIRECT_DOCUMENT_HARD_LIMIT_BYTES) {
          return res.status(413).json({ error: "文档大小校验失败。" });
        }
        const filename = String(req.body?.filename || "文档").trim();
        const buffer = Buffer.from(bytes);
        const file = {
          fieldname: "document",
          originalname: filename,
          encoding: "7bit",
          mimetype: session.mimeType,
          size: buffer.length,
          buffer,
          destination: "",
          filename,
          path: "",
          stream: Readable.from(buffer),
        } satisfies Express.Multer.File;
        const extracted = await extractDocumentText(file, filename);
        return res.json({
          filename,
          mimeType: session.mimeType,
          sizeBytes: session.size,
          ...extracted,
        });
      } finally {
        directDocumentExtractionActive = false;
      }
    }

    if (!req.file) {
      return res.status(400).json({ error: "请上传文档文件。" });
    }

    const filename = String(req.body?.filename || req.file.originalname || "文档").trim();
    const extracted = await extractDocumentText(req.file, filename);
    return res.json({
      filename,
      mimeType: req.file.mimetype || "",
      sizeBytes: req.file.size || req.file.buffer.length,
      ...extracted,
    });
  } catch (err: any) {
    console.error("Document text extraction error:", err);
    if (err instanceof DirectUploadServiceError) {
      return res.status(err.httpStatus).json({ error: err.message, code: err.code });
    }
    return res.status(400).json({ error: err.message || "文档文本提取失败。" });
  }
});

app.post("/api/analyze-image", requirePostgresAuth, upload.single("image"), async (req, res) => {
  try {
    const provider = (req.headers["x-provider"] as string | undefined) || "gemini";
    const customApiKey = req.headers["x-api-key"] as string | undefined;
    const customModelName = req.headers["x-model-name"] as string | undefined;
    const customGeminiBaseUrl = req.headers["x-gemini-base-url"] as string | undefined;
    const thinkingEnabled = req.headers["x-thinking-enabled"] === "true";
    const bookHintPrompt = buildBookHintPrompt(normalizeBookHints(req.body?.bookHints));
    const customTagHintPrompt = buildCustomTagHintPrompt(normalizeCustomTagHints(req.body?.customTagHints));

    console.log("=== API LOG: Analyze Image Request ===");
    console.log("provider:", provider);
    console.log("has customApiKey:", !!customApiKey, customApiKey ? `(length: ${customApiKey.length})` : "(empty)");
    console.log("customModelName:", customModelName);
    console.log("customGeminiBaseUrl:", customGeminiBaseUrl);
    console.log("=====================================");

    const image = normalizeImageUpload(req);
    let rawBase64 = image.dataUrl;
    let actualMimeType = image.mimeType;

    if (rawBase64.includes(";base64,")) {
      const parts = rawBase64.split(";base64,");
      rawBase64 = parts[1];
      const match = parts[0].match(/data:(.*);base64/);
      if (match) {
        actualMimeType = match[1];
      }
    }

    if (provider === "anthropic") {
      const anthropicApiKey = customApiKey || process.env.ANTHROPIC_AUTH_TOKEN;
      if (!anthropicApiKey) {
        return res.status(400).json({ error: "Anthropic API Key is not configured. Please supply it in Settings." });
      }

      const customBaseUrl = (req.headers["x-anthropic-base-url"] as string | undefined) || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
      let anthropicUrl = customBaseUrl;
      if (!anthropicUrl.endsWith("/messages") && !anthropicUrl.endsWith("/messages/")) {
        if (anthropicUrl.endsWith("/")) {
          anthropicUrl = anthropicUrl + "v1/messages";
        } else {
          anthropicUrl = anthropicUrl + "/v1/messages";
        }
      }

      const selectedModel = customModelName || "claude-3-5-sonnet-20241022";

      console.log(`Routing image analysis to Anthropic endpoint: ${anthropicUrl} using model: ${selectedModel}`);

      const anthropicResponse = await fetch(anthropicUrl, {
        method: "POST",
        headers: {
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: selectedModel,
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: actualMimeType,
                    data: rawBase64,
                  },
                },
                {
                  type: "text",
                  text: "You are a creative inspiration research assistant. Analyze this uploaded image to extract evocative artistic inspirations, creative concepts, design styles, mood terms, color palettes, and visual keywords (e.g. '复古工业风', '赛博朋克色调', '温柔莫兰迪色', '温暖松弛感', 'Wabi-Sabi 侘寂', 'Mid-century Modern', etc.). " +
                        bookHintPrompt +
                        customTagHintPrompt +
                        "Provide exactly 5 highly relevant, inspirational, and creative keywords in Chinese (or standard English hybrid terms if highly descriptive) to help the user catalog their visual inspiration. " +
                        "Reply ONLY with a raw JSON object of the format: {\"terms\": [\"term1\", \"term2\", ...]} without any markdown code backticks or other text."
                }
              ]
            }
          ]
        })
      });

      if (!anthropicResponse.ok) {
        const errText = await anthropicResponse.text();
        console.error("Anthropic service error response:", errText);
        return res.status(anthropicResponse.status).json({ error: `Anthropic API: ${errText}` });
      }

      const responseDoc: any = await anthropicResponse.json();
      const rawText = responseDoc.content?.[0]?.text || "{}";
      const cleanedText = cleanJsonText(rawText);
      const parsedData = JSON.parse(cleanedText || '{"terms": []}');
      return res.json(limitTermsResponse(parsedData));

    } else {
      // Check if custom base url is a third-party non-Google gateway
      const thirdPartyBaseUrl = (customGeminiBaseUrl || defaultThirdPartyBaseUrl).trim();
      const isThirdParty = thirdPartyBaseUrl &&
        (!thirdPartyBaseUrl.toLowerCase().includes("googleapis.com") && !thirdPartyBaseUrl.toLowerCase().includes("google.com"));

      if (isThirdParty) {
        const activeApiKey = (customApiKey || defaultThirdPartyApiKey || apiKey || "").trim();
        if (!activeApiKey) {
          return res.status(400).json({ error: "Third-party API key is not defined. Please configure your API key in Settings." });
        }

        const completionsUrl = getCompletionsUrl(thirdPartyBaseUrl);
        const selectedModel = (customModelName || defaultThirdPartyModel).trim();

        console.log(`Routing image analysis via OpenAI/Third-party protocol to: ${completionsUrl} using model: ${selectedModel}`);

        const isVolcengineResponsesFormat = completionsUrl.includes("/responses");
        let payload: any;

        if (isVolcengineResponsesFormat) {
          payload = {
            model: selectedModel,
            input: [
              {
                role: "user",
                content: [
                  {
                    type: "input_image",
                    image_url: `data:${actualMimeType};base64,${rawBase64}`
                  },
                  {
                    type: "input_text",
                    text: "You are a creative inspiration research assistant. Analyze this uploaded screenshot or design reference image. " +
                          "Extract evocative artistic inspirations, creative concepts, design styles, mood terms, color palettes, and visual keywords (e.g., '复古工业风', '赛博朋克色调', '温柔莫兰迪色', '温暖松弛感', 'Wabi-Sabi 侘寂', 'Mid-century Modern'). " +
                          bookHintPrompt +
                          customTagHintPrompt +
                          "Return exactly 5 highly relevant and imaginative keywords in Chinese (or standard English descriptors) as a JSON list in the key 'terms' to capture the visual inspiration. " +
                          "Respond ONLY with a raw JSON object of the format: {\"terms\": [\"term1\", \"term2\", ...]} without any markdown code backticks or other text."
                  }
                ]
              }
            ]
          };
        } else {
          payload = {
            model: selectedModel,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "You are a creative inspiration research assistant. Analyze this uploaded screenshot or design reference image. " +
                          "Extract evocative artistic inspirations, creative concepts, design styles, mood terms, color palettes, and visual keywords (e.g., '复古工业风', '赛博朋克色调', '温柔莫兰迪色', '温暖松弛感', 'Wabi-Sabi 侘寂', 'Mid-century Modern'). " +
                          bookHintPrompt +
                          customTagHintPrompt +
                          "Return exactly 5 highly relevant and imaginative keywords in Chinese (or standard English descriptors) as a JSON list in the key 'terms' to capture the visual inspiration. " +
                          "Respond ONLY with a raw JSON object of the format: {\"terms\": [\"term1\", \"term2\", ...]} without any markdown code backticks or other text."
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${actualMimeType};base64,${rawBase64}`
                    }
                  }
                ]
              }
            ]
          };
        }

        // Apply thinking mode based on user preference header
        const isArkOrDoubaoOrDeepseek = /doubao|ark|volces|volcengine|deepseek/i.test(selectedModel) || /volces|ark|volcengine|deepseek/i.test(completionsUrl);
        const effectiveThinkingEnabled = req.headers["x-thinking-enabled"] === undefined ? defaultThirdPartyThinking : thinkingEnabled;
        if (isArkOrDoubaoOrDeepseek && !isVolcengineResponsesFormat) {
          payload.thinking = {
            type: effectiveThinkingEnabled ? "enabled" : "disabled"
          };
        }

        const thirdPartyResponse = await fetch(completionsUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${activeApiKey}`,
          },
          body: JSON.stringify(payload),
        });

        if (!thirdPartyResponse.ok) {
          const errText = await thirdPartyResponse.text();
          console.error("Third-party completions service error response:", errText);
          return res.status(thirdPartyResponse.status).json({ error: `Third-party API Error: ${errText}` });
        }

        const responseDoc: any = await thirdPartyResponse.json();
        const rawText = responseDoc.choices?.[0]?.message?.content || responseDoc.choices?.[0]?.text || responseDoc.output || "{}";
        const cleanedText = cleanJsonText(rawText);
        const parsedData = JSON.parse(cleanedText || '{"terms": []}');
        return res.json(limitTermsResponse(parsedData));

      } else {
        // Default: Google Gemini API Flow
        const activeApiKey = customApiKey || apiKey;
        if (!activeApiKey) {
          return res.status(500).json({ error: "Gemini API key is not defined. Please configure your API key in Settings." });
        }

        const activeAiOptions: any = {
          apiKey: activeApiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build-custom',
            }
          }
        };

        if (customGeminiBaseUrl) {
          activeAiOptions.baseURL = customGeminiBaseUrl;
        }

        const activeAi = new GoogleGenAI(activeAiOptions);

        const selectedModel = customModelName || "gemini-3.5-flash";

        const imagePart = {
          inlineData: {
            mimeType: actualMimeType,
            data: rawBase64,
          },
        };

        const textPart = {
          text: "You are a creative inspiration research assistant. Analyze this uploaded screenshot or design reference image. " +
                "Extract evocative artistic inspirations, creative concepts, design styles, mood terms, color palettes, and visual keywords (e.g., '复古工业风', '赛博朋克色调', '温柔莫兰迪色', '温暖松弛感', 'Wabi-Sabi 侘寂', 'Mid-century Modern'). " +
                bookHintPrompt +
                customTagHintPrompt +
                "Return exactly 5 highly relevant and imaginative keywords in Chinese (or standard English descriptors) as a JSON list in the key 'terms' to capture the visual inspiration."
        };

        const response = await activeAi.models.generateContent({
          model: selectedModel,
          contents: { parts: [imagePart, textPart] },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                terms: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Exactly 5 professional design terminology keywords inspired by the image."
                }
              },
              required: ["terms"]
            }
          }
        });

        const cleanedText = cleanJsonText(response.text || '{"terms": []}');
        const parsedData = JSON.parse(cleanedText);
        return res.json(limitTermsResponse(parsedData));
      }
    }
  } catch (error: any) {
    console.error("Error analyzing image:", error);
    return res.status(500).json({ error: error.message || "An error occurred while analyzing the image." });
  }
});

app.post("/api/store-image", requirePostgresAuth, upload.single("image"), async (req, res) => {
  try {
    const image = normalizeImageUpload(req);
    const stored = await storePrimaryImage(runtimeConfig, image);
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
  } catch (error: any) {
    console.error("Primary image storage error:", error);
    return res.status(400).json({ error: error.message || "Primary image storage failed." });
  }
});

app.post("/api/videos/upload", requirePostgresAuth, videoUpload.single("video"), async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  const authReq = req as AuthenticatedRequest;
  const directUploadId = getDirectUploadId(req);
  if (directUploadId) {
    return claimDirectVideoAsset(authReq, res, directUploadId);
  }
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "Missing video upload." });
  }
  if (!SUPPORTED_VIDEO_MIME_TYPES.has(file.mimetype)) {
    return res.status(400).json({ error: "仅支持 mp4、mov、webm 视频。" });
  }
  if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
    return res.status(413).json({ error: `视频不能超过 ${Math.round(MAX_VIDEO_UPLOAD_BYTES / 1024 / 1024)}MB。` });
  }

  const userId = authReq.user!.id;
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

  const client = await pgPool.connect();
  let storedVideo: Awaited<ReturnType<typeof videoStorage.putObject>> | null = null;
  try {
    storedVideo = await videoStorage.putObject({
      buffer: file.buffer,
      mimeType: file.mimetype,
      filename: originalName,
      storageKey,
    });

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
        [cardId, userId, weekId, Number.isFinite(dayIndex) ? dayIndex : 0, ["视频灵感", "待整理"], "视频灵感 待整理", now]
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
      [
        assetId,
        userId,
        cardId,
        storedVideo.storageProvider,
        storedVideo.storageKey,
        storedVideo.originalName,
        storedVideo.mimeType,
        storedVideo.sizeBytes,
        Number.parseInt(String(req.body.durationMs || "0"), 10) || 0,
        now,
      ]
    );

    if (bookId && shouldCreateCard) {
      const book = await client.query("SELECT id FROM inspiration_books WHERE id = $1 AND user_id = $2", [bookId, userId]);
      if (book.rowCount > 0) {
        await client.query(
          `INSERT INTO inspiration_book_cards (user_id, book_id, card_id, added_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, book_id, card_id) DO NOTHING`,
          [userId, bookId, cardId, now]
        );
        await client.query("UPDATE inspiration_books SET updated_at = $1 WHERE id = $2 AND user_id = $3", [now, bookId, userId]);
      }
    }

    await refreshKnowledgeCard(client, userId, cardId);

    const cardResult = await client.query(
      `SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash, terms, deco_type, angle, created_at, type, md_content, md_summary, md_name, insight_note, is_favorite, favorited_at,
              ${comboSummarySelectSql},
              (SELECT COALESCE(json_agg(va ORDER BY va.created_at DESC), '[]'::json)
               FROM video_assets va
               WHERE va.user_id = cards.user_id AND va.card_id = cards.id) AS video_assets,
              (SELECT COALESCE(json_agg(ia ORDER BY ia.created_at DESC), '[]'::json)
               FROM image_assets ia
               WHERE ia.user_id = cards.user_id AND ia.card_id = cards.id) AS image_assets
       FROM cards
       WHERE id = $1 AND user_id = $2`,
      [cardId, userId]
    );

    await client.query("COMMIT");
    return res.json({
      card: mapCardRows(cardResult.rows, req)[0],
      video: mapVideoAssetRow(assetResult.rows[0], req),
    });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (storedVideo) {
      await deleteVideoStorageObject(storedVideo.storageProvider, storedVideo.storageKey).catch(() => undefined);
    }
    console.error("Video upload error:", err);
    return res.status(500).json({ error: err.message || "Video upload failed." });
  } finally {
    client.release();
  }
});

app.post("/api/images/upload", requirePostgresAuth, imageAssetUpload.single("image"), async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  const authReq = req as AuthenticatedRequest;
  const directUploadId = getDirectUploadId(req);
  if (directUploadId) {
    return claimDirectImageAsset(authReq, res, directUploadId);
  }
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "Missing image upload." });
  }
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(file.mimetype)) {
    return res.status(400).json({ error: "仅支持 jpg、png、webp、gif 图片。" });
  }
  if (file.size > MAX_IMAGE_ASSET_UPLOAD_BYTES) {
    return res.status(413).json({ error: `图片不能超过 ${Math.round(MAX_IMAGE_ASSET_UPLOAD_BYTES / 1024 / 1024)}MB。` });
  }

  const userId = authReq.user!.id;
  const cardId = String(req.body.cardId || "").trim();
  if (!cardId) {
    return res.status(400).json({ error: "cardId is required." });
  }

  const now = Date.now();
  const assetId = `image_${crypto.randomBytes(8).toString("hex")}_${now.toString(36)}`;
  const extension = getImageExtension(file.originalname || "", file.mimetype);
  const storageKey = `images/${sanitizeStorageSegment(userId)}/${assetId}.${extension}`;
  const originalName = file.originalname || `${assetId}.${extension}`;
  const client = await pgPool.connect();
  let storedImage: Awaited<ReturnType<typeof imageAssetStorage.putObject>> | null = null;

  try {
    storedImage = await imageAssetStorage.putObject({
      buffer: file.buffer,
      mimeType: file.mimetype,
      filename: originalName,
      storageKey,
    });

    await client.query("BEGIN");
    const card = await client.query("SELECT id, type FROM cards WHERE id = $1 AND user_id = $2", [cardId, userId]);
    if (card.rowCount === 0) {
      await client.query("ROLLBACK");
      await deleteImageAssetStorageObject(storedImage.storageProvider, storedImage.storageKey).catch(() => undefined);
      return res.status(404).json({ error: "Card not found." });
    }
    if ((card.rows[0].type || "image") !== "video") {
      await client.query("ROLLBACK");
      await deleteImageAssetStorageObject(storedImage.storageProvider, storedImage.storageKey).catch(() => undefined);
      return res.status(400).json({ error: "只有视频卡片可以绑定图片。" });
    }

    const assetResult = await client.query(
      `INSERT INTO image_assets (id, user_id, card_id, storage_provider, storage_key, original_name, mime_type, size_bytes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, card_id, storage_provider, storage_key, original_name, mime_type, size_bytes, created_at`,
      [
        assetId,
        userId,
        cardId,
        storedImage.storageProvider,
        storedImage.storageKey,
        storedImage.originalName,
        storedImage.mimeType,
        storedImage.sizeBytes,
        now,
      ]
    );

    await client.query("COMMIT");
    return res.json({ image: mapImageAssetRow(assetResult.rows[0], req) });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (storedImage) {
      await deleteImageAssetStorageObject(storedImage.storageProvider, storedImage.storageKey).catch(() => undefined);
    }
    console.error("Image asset upload error:", err);
    return res.status(500).json({ error: err.message || "Image upload failed." });
  } finally {
    client.release();
  }
});

app.post("/api/summarize-md", requirePostgresAuth, async (req, res) => {
  try {
    const { markdown } = req.body;
    if (typeof markdown !== "string" || !markdown.trim()) {
      return res.status(400).json({ error: "Missing markdown content." });
    }

    const fallbackSummary = markdown
      .split(/\r?\n/)
      .map((line: string) => line.replace(/^#{1,6}\s*/, "").replace(/^[-*+]\s+/, "").trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(" ")
      .replace(/\s+/g, " ")
      .slice(0, 220);

    const fallbackInsightSource = fallbackSummary || markdown
      .replace(/[#>*_`~\-[\]()]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);

    const fallback = {
      summary: fallbackSummary || "已保存 Markdown 手稿，点击卡片查看完整内容。",
      terms: ["文档手稿", "资料整理"],
      insightNote: fallbackInsightSource
        ? `初步分析：这份文档主要围绕“${fallbackInsightSource}”展开，可结合实际目标进一步提炼重点和行动项。`
        : "初步分析：文档已保存，可结合实际目标进一步提炼重点和行动项。",
    };

    const provider = (req.headers["x-provider"] as string | undefined) || "gemini";
    const customApiKey = req.headers["x-api-key"] as string | undefined;
    const customModelName = req.headers["x-model-name"] as string | undefined;
    const customGeminiBaseUrl = req.headers["x-gemini-base-url"] as string | undefined;
    const thinkingEnabled = req.headers["x-thinking-enabled"] === "true";
    const bookHints = normalizeBookHints(req.body?.bookHints);
    const customTagHints = normalizeCustomTagHints(req.body?.customTagHints);

    const prompt = [
      "你是一个文档整理与知识标签助手，不要按图片视觉风格分析。",
      "请阅读下面的文档内容，提炼文档的核心主题、结论、行动方向、项目线索和知识领域。",
      "输出必须是严格 JSON：{\"summary\":\"中文摘要，2到3句话\",\"terms\":[\"标签1\",\"标签2\",...],\"insightNote\":\"核心观点、启发和行动建议\"}。",
      "summary 要客观概括内容；insightNote 要进一步提炼核心观点、可借鉴启发和可执行建议，不要简单重复摘要，也不要虚构文档没有的信息。",
      "terms 必须正好 5 个，优先使用中文短标签；标签应描述文档内容，不要使用“光影、色彩、构图、视觉风格”等图片分析词，除非文档本身明确讨论这些主题。",
      customTagHints.length > 0
        ? `用户维护了自定义标签库：${customTagHints.join("；")}。如果内容确实相关，请优先使用这些标签库中的原词或非常接近的变体。不要强行使用无关标签。`
        : "",
      bookHints.length > 0
        ? `如果内容确实相关，请优先参考这些灵感册名称/描述中的名词来生成标签：${bookHints.join("；")}。不要强行匹配无关灵感册。`
        : "",
      "",
      "文档内容：",
      markdown.slice(0, 12000),
    ].join("\n");

    const normalizeResult = (rawText: string) => {
      const parsed = JSON.parse(cleanJsonText(rawText) || "{}");
      const summary = typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : fallback.summary;
      const terms = Array.isArray(parsed.terms)
        ? parsed.terms
            .filter((term: unknown): term is string => typeof term === "string" && term.trim().length > 0)
            .map((term: string) => term.trim())
            .slice(0, 5)
        : fallback.terms;
      const insightNote = typeof parsed.insightNote === "string" && parsed.insightNote.trim()
        ? parsed.insightNote.trim()
        : fallback.insightNote;
      return {
        summary,
        terms: terms.length > 0 ? terms : fallback.terms,
        insightNote,
      };
    };

    try {
      if (provider === "anthropic") {
        const anthropicApiKey = customApiKey || process.env.ANTHROPIC_AUTH_TOKEN;
        if (!anthropicApiKey) return res.json(fallback);

        const customBaseUrl = (req.headers["x-anthropic-base-url"] as string | undefined) || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
        let anthropicUrl = customBaseUrl;
        if (!anthropicUrl.endsWith("/messages") && !anthropicUrl.endsWith("/messages/")) {
          anthropicUrl = anthropicUrl.endsWith("/") ? anthropicUrl + "v1/messages" : anthropicUrl + "/v1/messages";
        }

        const anthropicResponse = await fetch(anthropicUrl, {
          method: "POST",
          headers: {
            "x-api-key": anthropicApiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: customModelName || "claude-3-5-sonnet-20241022",
            max_tokens: 1200,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        if (!anthropicResponse.ok) return res.json(fallback);
        const doc: any = await anthropicResponse.json();
        return res.json(normalizeResult(doc.content?.[0]?.text || "{}"));
      }

      const thirdPartyBaseUrl = (customGeminiBaseUrl || defaultThirdPartyBaseUrl).trim();
      const isThirdParty = thirdPartyBaseUrl &&
        (!thirdPartyBaseUrl.toLowerCase().includes("googleapis.com") && !thirdPartyBaseUrl.toLowerCase().includes("google.com"));

      if (isThirdParty) {
        const activeApiKey = (customApiKey || defaultThirdPartyApiKey || apiKey || "").trim();
        if (!activeApiKey) return res.json(fallback);

        const completionsUrl = getCompletionsUrl(thirdPartyBaseUrl);
        const selectedModel = (customModelName || defaultThirdPartyModel).trim();
        const payload: any = {
          model: selectedModel,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1200,
        };
        const isArkOrDoubaoOrDeepseek = /doubao|ark|volces|volcengine|deepseek/i.test(selectedModel) || /volces|ark|volcengine|deepseek/i.test(completionsUrl);
        const effectiveThinkingEnabled = req.headers["x-thinking-enabled"] === undefined ? defaultThirdPartyThinking : thinkingEnabled;
        if (isArkOrDoubaoOrDeepseek) {
          payload.thinking = { type: effectiveThinkingEnabled ? "enabled" : "disabled" };
        }

        const thirdPartyResponse = await fetch(completionsUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${activeApiKey}`,
          },
          body: JSON.stringify(payload),
        });

        if (!thirdPartyResponse.ok) return res.json(fallback);
        const doc: any = await thirdPartyResponse.json();
        return res.json(normalizeResult(doc.choices?.[0]?.message?.content || doc.choices?.[0]?.text || "{}"));
      }

      const activeApiKey = customApiKey || apiKey;
      if (!activeApiKey) return res.json(fallback);

      const activeAi = new GoogleGenAI({
        apiKey: activeApiKey,
        ...(customGeminiBaseUrl ? { baseURL: customGeminiBaseUrl } : {}),
        httpOptions: { headers: { "User-Agent": "aistudio-build-custom" } },
      } as any);

      const response = await activeAi.models.generateContent({
        model: customModelName || "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              terms: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              insightNote: { type: Type.STRING },
            },
            required: ["summary", "terms", "insightNote"],
          },
        },
      });

      return res.json(normalizeResult(response.text || "{}"));
    } catch (aiError) {
      console.warn("Markdown AI summary skipped:", aiError);
      return res.json(fallback);
    }
  } catch (error: any) {
    console.error("Markdown summary error:", error);
    return res.status(500).json({ error: error.message || "Markdown summary failed." });
  }
});

app.post("/api/test-model", requirePostgresAuth, async (req, res) => {
  try {
    const provider = (req.headers["x-provider"] as string | undefined) || "gemini";
    const customApiKey = req.headers["x-api-key"] as string | undefined;
    const customModelName = req.headers["x-model-name"] as string | undefined;
    const customGeminiBaseUrl = req.headers["x-gemini-base-url"] as string | undefined;
    const thinkingEnabled = req.headers["x-thinking-enabled"] === "true";

    // We will run a text test AND a vision test and return both statuses
    let textStatus = { ok: false, error: "", response: "" };
    let visionStatus = { ok: false, error: "", response: "" };

    const testPrompt = "Reply with exactly 'OK'";
    // 16x16 pixels PNG to satisfy minimum size requirement of at least 14 pixels
    const tinyImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAALElEQVR42mNk+M9QDwOMjIxtbW3E6sGlhoGBgY8bVz0yGBUYoIEBCgYGBgC3DwscLgbvggAAAABJRU5ErkJggg==";

    if (provider === "anthropic") {
      const anthropicApiKey = customApiKey || process.env.ANTHROPIC_AUTH_TOKEN;
      if (!anthropicApiKey) {
        return res.status(400).json({ error: "Anthropic API Key is not configured." });
      }

      const customBaseUrl = (req.headers["x-anthropic-base-url"] as string | undefined) || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
      let anthropicUrl = customBaseUrl;
      if (!anthropicUrl.endsWith("/messages") && !anthropicUrl.endsWith("/messages/")) {
        if (anthropicUrl.endsWith("/")) {
          anthropicUrl = anthropicUrl + "v1/messages";
        } else {
          anthropicUrl = anthropicUrl + "/v1/messages";
        }
      }

      const selectedModel = customModelName || "claude-3-5-sonnet-20241022";

      // 1. Text test
      try {
        const textRes = await fetch(anthropicUrl, {
          method: "POST",
          headers: {
            "x-api-key": anthropicApiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: selectedModel,
            max_tokens: 50,
            messages: [{ role: "user", content: testPrompt }]
          })
        });

        if (textRes.ok) {
          const doc: any = await textRes.json();
          textStatus.ok = true;
          textStatus.response = doc.content?.[0]?.text?.trim() || "OK";
        } else {
          textStatus.error = await textRes.text();
        }
      } catch (err: any) {
        textStatus.error = err.message || String(err);
      }

      // 2. Vision test
      try {
        const visionRes = await fetch(anthropicUrl, {
          method: "POST",
          headers: {
            "x-api-key": anthropicApiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: selectedModel,
            max_tokens: 50,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: "image/png",
                      data: tinyImageBase64
                    }
                  },
                  {
                    type: "text",
                    text: testPrompt
                  }
                ]
              }
            ]
          })
        });

        if (visionRes.ok) {
          const doc: any = await visionRes.json();
          visionStatus.ok = true;
          visionStatus.response = doc.content?.[0]?.text?.trim() || "OK";
        } else {
          visionStatus.error = await visionRes.text();
        }
      } catch (err: any) {
        visionStatus.error = err.message || String(err);
      }

    } else {
      // Gemini or Third-party OpenAI provider
      const thirdPartyBaseUrl = (customGeminiBaseUrl || defaultThirdPartyBaseUrl).trim();
      const activeApiKey = customApiKey || defaultThirdPartyApiKey || process.env.GEMINI_API_KEY;
      const isThirdParty = thirdPartyBaseUrl &&
        (!thirdPartyBaseUrl.toLowerCase().includes("googleapis.com") && !thirdPartyBaseUrl.toLowerCase().includes("google.com"));

      if (isThirdParty) {
        if (!activeApiKey) {
          return res.status(400).json({ error: "Third-party API key is not configured." });
        }

        const completionsUrl = getCompletionsUrl(thirdPartyBaseUrl);
        const selectedModel = (customModelName || defaultThirdPartyModel).trim();

        console.log(`Running diagnostic tests via OpenAI/Third-party directly to: ${completionsUrl} using model: ${selectedModel}`);

        const isArkOrDoubaoOrDeepseek = /doubao|ark|volces|volcengine|deepseek/i.test(selectedModel) || /volces|ark|volcengine|deepseek/i.test(completionsUrl);
        const isVolcengineResponsesFormat = completionsUrl.includes("/responses");
        const activeApiKeyTrimmed = (activeApiKey || "").trim();
        const effectiveThinkingEnabled = req.headers["x-thinking-enabled"] === undefined ? defaultThirdPartyThinking : thinkingEnabled;

        // 1. Text test
        try {
          let textPayload: any;
          if (isVolcengineResponsesFormat) {
            textPayload = {
              model: selectedModel,
              input: [
                {
                  role: "user",
                  content: [
                    {
                      type: "input_text",
                      text: testPrompt
                    }
                  ]
                }
              ]
            };
          } else {
            textPayload = {
              model: selectedModel,
              messages: [{ role: "user", content: testPrompt }],
              max_tokens: 50,
            };
            if (isArkOrDoubaoOrDeepseek) {
              textPayload.thinking = { type: effectiveThinkingEnabled ? "enabled" : "disabled" };
            }
          }

          const textRes = await fetch(completionsUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${activeApiKeyTrimmed}`,
            },
            body: JSON.stringify(textPayload)
          });

          if (textRes.ok) {
            const doc: any = await textRes.json();
            const textResponse = doc.choices?.[0]?.message?.content?.trim() || doc.choices?.[0]?.text?.trim() || doc.output?.trim() || "OK";
            textStatus.ok = true;
            textStatus.response = textResponse;
          } else {
            textStatus.error = await textRes.text();
          }
        } catch (err: any) {
          textStatus.error = err.message || String(err);
        }

        // 2. Vision test
        try {
          let visionPayload: any;
          if (isVolcengineResponsesFormat) {
            visionPayload = {
              model: selectedModel,
              input: [
                {
                  role: "user",
                  content: [
                    {
                      type: "input_image",
                      image_url: `data:image/png;base64,${tinyImageBase64}`
                    },
                    {
                      type: "input_text",
                      text: testPrompt
                    }
                  ]
                }
              ]
            };
          } else {
            visionPayload = {
              model: selectedModel,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: testPrompt
                    },
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:image/png;base64,${tinyImageBase64}`
                      }
                    }
                  ]
                }
              ],
              max_tokens: 50,
            };
            if (isArkOrDoubaoOrDeepseek) {
              visionPayload.thinking = { type: effectiveThinkingEnabled ? "enabled" : "disabled" };
            }
          }

          const visionRes = await fetch(completionsUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${activeApiKeyTrimmed}`,
            },
            body: JSON.stringify(visionPayload)
          });

          if (visionRes.ok) {
            const doc: any = await visionRes.json();
            const visionResponse = doc.choices?.[0]?.message?.content?.trim() || doc.choices?.[0]?.text?.trim() || doc.output?.trim() || "OK";
            visionStatus.ok = true;
            visionStatus.response = visionResponse;
          } else {
            visionStatus.error = await visionRes.text();
          }
        } catch (err: any) {
          visionStatus.error = err.message || String(err);
        }

      } else {
        // Standard Google Gemini provider
        if (!activeApiKey) {
          return res.status(400).json({ error: "Gemini API key is not configured." });
        }

        const activeAiOptions: any = {
          apiKey: activeApiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        };

        if (customGeminiBaseUrl) {
          activeAiOptions.baseURL = customGeminiBaseUrl;
        }

        const activeAi = new GoogleGenAI(activeAiOptions);
        const selectedModel = customModelName || "gemini-3.5-flash";

        // 1. Text test
        try {
          const response = await activeAi.models.generateContent({
            model: selectedModel,
            contents: testPrompt
          });
          textStatus.ok = true;
          textStatus.response = response.text || "OK";
        } catch (err: any) {
          textStatus.error = err.message || String(err);
        }

        // 2. Vision test
        try {
          const imagePart = {
            inlineData: {
              data: tinyImageBase64,
              mimeType: "image/png"
            }
          };
          const textPart = { text: testPrompt };

          const response = await activeAi.models.generateContent({
            model: selectedModel,
            contents: { parts: [imagePart, textPart] }
          });
          visionStatus.ok = true;
          visionStatus.response = response.text || "OK";
        } catch (err: any) {
          visionStatus.error = err.message || String(err);
        }
      }
    }

    return res.json({
      provider,
      model: customModelName || (provider === "anthropic" ? "claude-3-5-sonnet-20241022" : "gemini-3.5-flash"),
      textStatus,
      visionStatus,
      sentPrompt: testPrompt,
      sentImage: `data:image/png;base64,${tinyImageBase64}`,
    });

  } catch (error: any) {
    console.error("Error in diagnostics:", error);
    return res.status(500).json({ error: error.message || "An error occurred during connection self-test." });
  }
});

if (pgPool) {
  app.use("/api/db", requirePostgresAuth, createNotesRouter(pgPool));
} else {
  app.use("/api/db/notes", requirePostgresAuth);
}

if (pgPool) {
  app.use("/api/db", requirePostgresAuth, createCardReadRouter({
    pool: pgPool,
    comboSummarySelect: comboSummarySelectSql,
    comboSummarySelectForCard: comboSummarySelectSqlForC,
    mapCardRows,
    mapVideoAssetRow,
    mapImageAssetRow,
  }));
}
if (pgPool) {
  app.use("/api/db", requirePostgresAuth, createBooksRouter({
    pool: pgPool,
    comboSummarySelectForCard: comboSummarySelectSqlForC,
    comboSummarySelectForCoverCard: comboSummarySelectSqlForC2,
    mapBookRow,
    mapCardRows,
  }));
}
if (pgPool) {
  app.use("/api/db", requirePostgresAuth, createComboRouter({
    pool: pgPool,
    imageUploadMiddleware: imageAssetUpload.single("image"),
    videoUploadMiddleware: videoUpload.single("video"),
    supportedImageMimeTypes: SUPPORTED_IMAGE_MIME_TYPES,
    supportedVideoMimeTypes: SUPPORTED_VIDEO_MIME_TYPES,
    imageStorage: imageAssetStorage,
    videoStorage,
    comboSummarySelect: comboSummarySelectSql,
    getDirectUploadId,
    claimDirectComboImage,
    claimDirectComboGeneration,
    getImageExtension,
    getVideoExtension,
    sanitizeStorageSegment,
    deleteImageStorageObject: deleteImageAssetStorageObject,
    deleteVideoStorageObject,
    normalizeImageRole: normalizeComboImageRole,
    mapComboImageRow,
    mapComboGenerationRow,
    mapCardRows,
    refreshComboCardSearchText,
    refreshKnowledgeCard,
  }));
}
if (pgPool) {
  app.use("/api/db", requirePostgresAuth, createCardUpsertRouter({
    pool: pgPool,
    getDirectUploadId,
    claimDirectPrimaryCard,
    claimDirectDocumentCard,
    normalizeInternalProxyUrl,
    refreshKnowledgeCard,
  }));
}
function requirePostgresAuthOrSignedPhoto(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (hasValidSignedImageUrl(req)) {
    next();
    return;
  }
  requirePostgresAuth(req as AuthenticatedRequest, res, next);
}

const primaryMediaStorage = directOssStorage || createVideoStorage({
  ...runtimeConfig,
  videoStorageProvider: "oss",
});

app.use("/api", createAssetMediaRouter({
  pool: pgPool,
  requireAuth: requirePostgresAuth,
  requireAuthOrSignedUrl: requirePostgresAuthOrSignedPhoto,
  hasValidSignedUrl: hasValidSignedImageUrl,
  mediaDeliveryMode: runtimeConfig.mediaDeliveryMode,
  imageProcesses: OSS_IMAGE_PROCESSES,
  videoPosterProcess: OSS_VIDEO_POSTER_PROCESS,
  ossStorage: directOssStorage,
  imageStorage: imageAssetStorage,
  videoStorage,
  imageStorageKeyToLocalPath,
  videoStorageKeyToLocalPath: storageKeyToLocalPath,
  deleteImageStorageObject: deleteImageAssetStorageObject,
  deleteVideoStorageObject,
  proxySignedObjectUrl,
}));

app.use("/api", createPrimaryMediaRouter({
  pool: pgPool,
  requireAuthOrSignedUrl: requirePostgresAuthOrSignedPhoto,
  hasValidSignedUrl: hasValidSignedImageUrl,
  mediaDeliveryMode: runtimeConfig.mediaDeliveryMode,
  imageProcesses: OSS_IMAGE_PROCESSES,
  primaryStorage: primaryMediaStorage,
  proxySignedObjectUrl,
}));

if (pgPool) {
  app.use("/api/db", requirePostgresAuth, createCardMutationRouter({
    pool: pgPool,
    knowledgeBaseEnabled: runtimeConfig.knowledgeBaseEnabled,
    refreshKnowledgeCard,
    deleteVideoStorageObject,
    deleteImageStorageObject: deleteImageAssetStorageObject,
  }));
}
if (pgPool) {
  app.use("/api/db", requirePostgresAuth, createSettingsRouter(pgPool));
} else {
  app.use("/api/db/settings", requirePostgresAuth);
}

if (!pgPool) app.use("/api/db", requirePostgresAuth);

app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    return res.status(413).json({
      error: err.code === "LIMIT_FILE_SIZE" ? "文件过大，请压缩后重试" : err.message,
    });
  }
  return next(err);
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, {
      maxAge: "1y",
      immutable: true,
      setHeaders: (res, filePath) => {
        const fileName = path.basename(filePath);
        if (fileName === "index.html") {
          res.setHeader("Cache-Control", "no-cache");
        } else if (!/[.-][a-zA-Z0-9_-]{8,}\.(?:js|css|woff2?|png|jpe?g|webp|svg)$/i.test(fileName)) {
          res.setHeader("Cache-Control", "public, max-age=86400");
        }
      },
    }));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
