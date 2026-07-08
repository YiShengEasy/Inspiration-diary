import fs from "fs/promises";
import path from "path";
import process from "process";
import OSS from "ali-oss";
import pg from "pg";

const apply = process.argv.includes("--apply");
const uploadsRoot = process.env.MIGRATE_UPLOADS_ROOT || "/app/uploads";

const requiredEnv = [
  "DATABASE_URL",
  "OSS_REGION",
  "OSS_BUCKET",
  "OSS_ENDPOINT",
  "OSS_ACCESS_KEY_ID",
  "OSS_ACCESS_KEY_SECRET",
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

const tables = [
  { table: "video_assets", kind: "video" },
  { table: "image_assets", kind: "image" },
  { table: "combo_images", kind: "image" },
  { table: "combo_generations", kind: "video" },
];

function localPathFor(storageKey) {
  const normalized = path.normalize(storageKey).replace(/^(\.\.(\/|\\|$))+/, "");
  return path.join(uploadsRoot, normalized);
}

async function fileInfo(storageKey) {
  const localPath = localPathFor(storageKey);
  try {
    const stat = await fs.stat(localPath);
    if (!stat.isFile()) return { exists: false, localPath, size: 0 };
    return { exists: true, localPath, size: stat.size };
  } catch {
    return { exists: false, localPath, size: 0 };
  }
}

async function loadRows() {
  const rows = [];
  for (const { table, kind } of tables) {
    const result = await pool.query(
      `SELECT $1::text AS table_name, $2::text AS kind, id, storage_key, original_name, mime_type, size_bytes
       FROM ${table}
       WHERE storage_provider = 'local'
       ORDER BY created_at ASC`,
      [table, kind]
    );
    rows.push(...result.rows);
  }
  return rows;
}

async function uploadAndMark(row) {
  const info = await fileInfo(row.storage_key);
  if (!info.exists) {
    return { row, status: "missing", ...info };
  }
  if (Number(row.size_bytes || 0) !== info.size) {
    return { row, status: "size-mismatch", ...info };
  }
  if (!apply) {
    return { row, status: "dry-run", ...info };
  }

  await oss.put(row.storage_key, info.localPath, {
    headers: {
      "Content-Type": row.mime_type || "application/octet-stream",
    },
  });
  await oss.head(row.storage_key);
  await pool.query(
    `UPDATE ${row.table_name}
     SET storage_provider = 'oss'
     WHERE id = $1 AND storage_provider = 'local'`,
    [row.id]
  );
  return { row, status: "migrated", ...info };
}

try {
  const rows = await loadRows();
  const results = [];
  for (const row of rows) {
    results.push(await uploadAndMark(row));
  }

  const summary = results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    acc.bytes[item.status] = (acc.bytes[item.status] || 0) + item.size;
    return acc;
  }, { bytes: {} });

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    uploadsRoot,
    totalRows: rows.length,
    summary,
    items: results.map((item) => ({
      table: item.row.table_name,
      id: item.row.id,
      storageKey: item.row.storage_key,
      localPath: item.localPath,
      dbSize: Number(item.row.size_bytes || 0),
      fileSize: item.size,
      status: item.status,
    })),
  }, null, 2));

  if (results.some((item) => item.status === "missing" || item.status === "size-mismatch")) {
    process.exit(2);
  }
} finally {
  await pool.end();
}
