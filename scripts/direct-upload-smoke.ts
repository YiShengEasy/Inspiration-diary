import { randomUUID } from "node:crypto";

import dotenv from "dotenv";

import { createOssDirectUploadGateway } from "../src/server/direct-upload/ossGateway.ts";
import { getRuntimeConfig } from "../src/server/runtimeConfig.ts";

const CONFIRMATION = "UPLOAD_3X100M_AND_DELETE_TEST_OBJECTS";
const TEST_PREFIX = "pending/smoke/";
const FILE_COUNT = 3;
const FILE_SIZE = 100 * 1024 * 1024;
const CHUNK_SIZE = 1024 * 1024;
const MAX_RSS_GROWTH = 100 * 1024 * 1024;

const envArgument = process.argv.find((argument) => argument.startsWith("--env="));
const envFile = envArgument?.slice("--env=".length);
dotenv.config(envFile ? { path: envFile } : undefined);

if (process.env.DIRECT_UPLOAD_SMOKE_CONFIRM !== CONFIRMATION) {
  throw new Error(
    `Refusing to access OSS. Set DIRECT_UPLOAD_SMOKE_CONFIRM=${CONFIRMATION} to run the destructive test-prefix-only smoke check.`,
  );
}

const config = getRuntimeConfig();
if (
  !config.oss.region ||
  !config.oss.bucket ||
  !config.oss.endpoint ||
  !config.oss.accessKeyId ||
  !config.oss.accessKeySecret
) {
  throw new Error("OSS_REGION, OSS_BUCKET, OSS_ENDPOINT and OSS credentials are required.");
}

function assertTestKey(objectKey: string): void {
  if (!objectKey.startsWith(TEST_PREFIX) || objectKey.includes("..")) {
    throw new Error(`Refusing to operate on a non-smoke object key: ${objectKey}`);
  }
}

function generatedBody(totalBytes: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(CHUNK_SIZE);
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const remaining = totalBytes - sent;
      const next = remaining >= chunk.byteLength ? chunk : chunk.subarray(0, remaining);
      sent += next.byteLength;
      controller.enqueue(next);
    },
  });
}

const gateway = createOssDirectUploadGateway(config);
const runId = randomUUID();
const objectKeys = Array.from(
  { length: FILE_COUNT },
  (_, index) => `${TEST_PREFIX}${runId}/stream-${index + 1}.bin`,
);
objectKeys.forEach(assertTestKey);

const rssBefore = process.memoryUsage().rss;
let peakRss = rssBefore;
const sampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 100);

let smokeError: unknown;
try {
  await Promise.all(
    objectKeys.map(async (objectKey) => {
      const grant = await gateway.createSignedPut({
        objectKey,
        mimeType: "application/octet-stream",
        expiresSeconds: 900,
      });
      const response = await fetch(grant.url, {
        method: "PUT",
        headers: {
          ...grant.headers,
          "content-length": String(FILE_SIZE),
        },
        body: generatedBody(FILE_SIZE),
        duplex: "half",
      } as RequestInit & { duplex: "half" });
      if (!response.ok) {
        throw new Error(`OSS upload failed with HTTP ${response.status}.`);
      }
      const head = await gateway.head(objectKey);
      if (head.size !== FILE_SIZE) {
        throw new Error(`OSS object size mismatch for ${objectKey}.`);
      }
    }),
  );
} catch (error) {
  smokeError = error;
} finally {
  clearInterval(sampler);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  const cleanupResults = await Promise.allSettled(
    objectKeys.map(async (objectKey) => {
      assertTestKey(objectKey);
      await gateway.delete(objectKey);
    }),
  );
  const cleanupFailures = cleanupResults.filter((result) => result.status === "rejected");
  if (cleanupFailures.length > 0 && smokeError === undefined) {
    smokeError = new Error(`Failed to delete ${cleanupFailures.length} smoke object(s).`);
  }
}

if (smokeError !== undefined) throw smokeError;

const rssGrowth = Math.max(0, peakRss - rssBefore);
if (rssGrowth >= MAX_RSS_GROWTH) {
  throw new Error(`Direct upload RSS grew by ${Math.round(rssGrowth / 1024 / 1024)} MiB.`);
}

console.log(JSON.stringify({
  event: "direct_upload_smoke",
  status: "ok",
  files: FILE_COUNT,
  bytesPerFile: FILE_SIZE,
  peakRssGrowthBytes: rssGrowth,
}));
