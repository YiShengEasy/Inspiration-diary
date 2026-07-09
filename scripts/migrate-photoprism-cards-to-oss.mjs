import crypto from "crypto";
import process from "process";
import OSS from "ali-oss";
import pg from "pg";

const apply = process.argv.includes("--apply");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number.parseInt(limitArg.slice("--limit=".length), 10) || 0) : 0;

const requiredEnv = [
  "DATABASE_URL",
  "OSS_REGION",
  "OSS_BUCKET",
  "OSS_ENDPOINT",
  "OSS_ACCESS_KEY_ID",
  "OSS_ACCESS_KEY_SECRET",
  "PHOTOPRISM_INTERNAL_URL",
  "PHOTOPRISM_USERNAME",
  "PHOTOPRISM_PASSWORD",
];

const missing = requiredEnv.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: String(process.env.DATABASE_SSL || "").toLowerCase() === "true" ? { rejectUnauthorized: false } : false,
});

const oss = new OSS({
  region: process.env.OSS_REGION,
  bucket: process.env.OSS_BUCKET,
  endpoint: process.env.OSS_ENDPOINT,
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  secure: true,
});

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function extensionFromContentType(contentType) {
  const normalized = String(contentType || "").toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  return "jpg";
}

function monthPath(createdAt) {
  const date = new Date(Number(createdAt || Date.now()));
  const year = Number.isFinite(date.getTime()) ? date.getUTCFullYear() : new Date().getUTCFullYear();
  const month = String((Number.isFinite(date.getTime()) ? date.getUTCMonth() : new Date().getUTCMonth()) + 1).padStart(2, "0");
  return `${year}/${month}`;
}

function encodeObjectUrl(storageKey, variant) {
  return `/api/objects/${variant}/${encodeURIComponent(storageKey)}`;
}

async function loginPhotoPrism() {
  const internalUrl = trimTrailingSlash(process.env.PHOTOPRISM_INTERNAL_URL);
  const response = await fetch(`${internalUrl}/api/v1/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: process.env.PHOTOPRISM_USERNAME,
      password: process.env.PHOTOPRISM_PASSWORD,
    }),
  });
  if (!response.ok) throw new Error(`PhotoPrism login failed with status ${response.status}`);
  const body = await response.json();
  const token = body.access_token || body.id;
  if (!token) throw new Error("PhotoPrism login returned no token");
  return { internalUrl, token };
}

function photoPrismHeaders(token) {
  return {
    "X-Auth-Token": token,
    "X-Session-ID": token,
    "X-Client-Version": "inspiration-diary-migration",
  };
}

async function loadPhotoPrismConfig(ctx) {
  const response = await fetch(`${ctx.internalUrl}/api/v1/config`, {
    headers: photoPrismHeaders(ctx.token),
  });
  if (!response.ok) throw new Error(`PhotoPrism config failed with status ${response.status}`);
  const body = await response.json();
  const downloadToken = body.downloadToken || body.DownloadToken;
  if (!downloadToken) throw new Error("PhotoPrism config returned no download token");
  return { downloadToken };
}

function sourceUrlFor(row, ctx, photoConfig) {
  if (row.photo_hash) {
    return `${ctx.internalUrl}/api/v1/dl/${encodeURIComponent(row.photo_hash)}?t=${encodeURIComponent(photoConfig.downloadToken)}`;
  }
  const relativeHashMatch = String(row.image_url || "").match(/^\/api\/photos\/hash\/([^/]+)\//);
  if (relativeHashMatch) {
    return `${ctx.internalUrl}/api/v1/dl/${encodeURIComponent(relativeHashMatch[1])}?t=${encodeURIComponent(photoConfig.downloadToken)}`;
  }
  if (/^https?:\/\//i.test(row.image_url || "")) {
    try {
      const url = new URL(row.image_url);
      const internal = new URL(ctx.internalUrl);
      if (url.pathname.startsWith("/api/v1/")) {
        url.protocol = internal.protocol;
        url.host = internal.host;
        return url.toString();
      }
    } catch {
      return "";
    }
  }
  return "";
}

async function fetchImageBytes(sourceUrl) {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`source fetch failed with status ${response.status}`);
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType };
}

async function loadRows() {
  const sql = `
    SELECT id, user_id, week_id, day_index, photo_uid, photo_hash, image_url, thumbnail_url, created_at
    FROM cards
    WHERE (
        COALESCE(photo_hash, '') <> ''
        OR image_url ~ '^https?://[^/]+/api/v1/'
        OR image_url ~ '^/api/photos/hash/'
      )
      AND COALESCE(photo_uid, '') NOT LIKE 'primary-images/%'
      AND id NOT LIKE 'smoke_%'
      AND COALESCE(photo_uid, '') NOT LIKE 'photo_%'
      AND COALESCE(photo_hash, '') NOT LIKE 'hash_%'
    ORDER BY created_at ASC
    ${limit > 0 ? `LIMIT ${limit}` : ""}
  `;
  const result = await pool.query(sql);
  return result.rows;
}

async function processRow(row, ctx, photoConfig) {
  const sourceUrl = sourceUrlFor(row, ctx, photoConfig);
  if (!sourceUrl) return { row, status: "no-source", bytes: 0 };

  const fetched = await fetchImageBytes(sourceUrl);
  const ext = extensionFromContentType(fetched.contentType);
  const digest = crypto.createHash("sha1").update(fetched.buffer).digest("hex").slice(0, 16);
  const storageKey = `primary-images/${monthPath(row.created_at)}/${row.id}-${digest}.${ext}`;

  if (!apply) {
    return {
      row,
      status: "dry-run",
      bytes: fetched.buffer.length,
      contentType: fetched.contentType,
      storageKey,
    };
  }

  await oss.put(storageKey, fetched.buffer, {
    headers: {
      "Content-Type": fetched.contentType,
    },
  });
  await oss.head(storageKey);
  await pool.query(
    `UPDATE cards
     SET photo_uid = $1,
         photo_hash = '',
         image_url = $2,
         thumbnail_url = $3
     WHERE id = $4`,
    [
      storageKey,
      encodeObjectUrl(storageKey, "primary"),
      encodeObjectUrl(storageKey, "primary-thumb"),
      row.id,
    ]
  );

  return {
    row,
    status: "migrated",
    bytes: fetched.buffer.length,
    contentType: fetched.contentType,
    storageKey,
  };
}

try {
  const ctx = await loginPhotoPrism();
  const photoConfig = await loadPhotoPrismConfig(ctx);
  const rows = await loadRows();
  const results = [];
  for (const row of rows) {
    try {
      results.push(await processRow(row, ctx, photoConfig));
    } catch (err) {
      results.push({
        row,
        status: "error",
        bytes: 0,
        error: err instanceof Error ? err.message : String(err),
      });
      if (apply) break;
    }
  }

  const summary = results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    acc.bytes[item.status] = (acc.bytes[item.status] || 0) + item.bytes;
    return acc;
  }, { bytes: {} });

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    totalRows: rows.length,
    summary,
    items: results.map((item) => ({
      cardId: item.row.id,
      weekId: item.row.week_id,
      oldPhotoUid: item.row.photo_uid || "",
      oldPhotoHash: item.row.photo_hash || "",
      status: item.status,
      bytes: item.bytes,
      contentType: item.contentType || "",
      storageKey: item.storageKey || "",
      error: item.error || "",
    })),
  }, null, 2));

  if (results.some((item) => item.status === "error" || item.status === "no-source")) {
    process.exit(2);
  }
} finally {
  await pool.end();
}
