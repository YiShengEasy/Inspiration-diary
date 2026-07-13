import dotenv from "dotenv";
import pg from "pg";

import { cleanupUploadSessions } from "../src/server/direct-upload/cleanup.ts";
import { createOssDirectUploadGateway } from "../src/server/direct-upload/ossGateway.ts";
import { getRuntimeConfig, validateRuntimeConfig } from "../src/server/runtimeConfig.ts";

const envArgument = process.argv.find((argument) => argument.startsWith("--env="));
const envFile = envArgument?.slice("--env=".length);
dotenv.config(envFile ? { path: envFile } : undefined);

const config = getRuntimeConfig();
const configErrors = validateRuntimeConfig(config);
if (config.databaseType !== "postgres") {
  configErrors.push("Upload cleanup requires DATABASE_TYPE=postgres.");
}
if (!config.oss.region || !config.oss.bucket || !config.oss.endpoint) {
  configErrors.push("Upload cleanup requires OSS_REGION, OSS_BUCKET, and OSS_ENDPOINT.");
}
if (!config.oss.accessKeyId || !config.oss.accessKeySecret) {
  configErrors.push("Upload cleanup requires OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET.");
}
if (configErrors.length > 0) {
  throw new Error(`Invalid cleanup configuration:\n${[...new Set(configErrors)].join("\n")}`);
}

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
});

try {
  await cleanupUploadSessions({
    pool,
    gateway: createOssDirectUploadGateway(config),
  });
} finally {
  await pool.end();
}
