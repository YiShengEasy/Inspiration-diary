import type { DirectUploadGateway } from "./ossGateway.ts";
import type {
  UploadQueryResult,
  UploadRepositoryClient,
  UploadStatus,
} from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 100;

interface CleanupRow {
  id: string;
  user_id: string;
  status: UploadStatus;
  pending_object_key: string;
  final_object_key: string | null;
}

interface CleanupClient extends UploadRepositoryClient {
  release(): void;
}

export interface CleanupPool {
  connect(): Promise<CleanupClient>;
}

export interface UploadCleanupResult {
  scanned: number;
  expired: number;
  deletedPending: number;
  deletedFinal: number;
  restoredClaimed: number;
  failed: number;
}

export interface UploadCleanupOptions {
  pool: CleanupPool;
  gateway: Pick<DirectUploadGateway, "delete">;
  now?: number;
  batchSize?: number;
  log?: (entry: Record<string, unknown>) => void;
}

function normalizeBatchSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_BATCH_SIZE) {
    throw new Error(`Cleanup batch size must be between 1 and ${DEFAULT_BATCH_SIZE}.`);
  }
  return value;
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: number; statusCode?: number; code?: string };
  return (
    candidate.status === 404 ||
    candidate.statusCode === 404 ||
    candidate.code === "NoSuchKey" ||
    candidate.code === "NotFound"
  );
}

async function deleteIfPresent(
  gateway: Pick<DirectUploadGateway, "delete">,
  objectKey: string,
): Promise<void> {
  try {
    await gateway.delete(objectKey);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

async function hasBusinessReference(
  client: UploadRepositoryClient,
  objectKey: string,
): Promise<boolean> {
  const result = await client.query<{ is_referenced: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM cards WHERE photo_uid = $1
       UNION ALL SELECT 1 FROM image_assets WHERE storage_provider = 'oss' AND storage_key = $1
       UNION ALL SELECT 1 FROM video_assets WHERE storage_provider = 'oss' AND storage_key = $1
       UNION ALL SELECT 1 FROM combo_images WHERE storage_provider = 'oss' AND storage_key = $1
       UNION ALL SELECT 1 FROM combo_generations WHERE storage_provider = 'oss' AND storage_key = $1
       UNION ALL SELECT 1 FROM document_assets WHERE storage_provider = 'oss' AND storage_key = $1
     ) AS is_referenced`,
    [objectKey],
  );
  return result.rows[0]?.is_referenced === true;
}

async function selectCandidates(
  client: UploadRepositoryClient,
  now: number,
  cutoff: number,
  batchSize: number,
): Promise<CleanupRow[]> {
  const result: UploadQueryResult<CleanupRow> = await client.query<CleanupRow>(
    `SELECT id, user_id, status, pending_object_key, final_object_key
     FROM upload_sessions
     WHERE (status IN ('authorized', 'uploaded') AND expires_at <= $1)
        OR (status IN ('failed', 'expired') AND updated_at <= $2)
        OR (status = 'finalized' AND final_object_key IS NOT NULL AND updated_at <= $2)
     ORDER BY updated_at ASC, id ASC
     LIMIT $3
     FOR UPDATE SKIP LOCKED`,
    [now, cutoff, batchSize],
  );
  return result.rows;
}

export async function cleanupUploadSessions(
  options: UploadCleanupOptions,
): Promise<UploadCleanupResult> {
  const startedAt = Date.now();
  const now = options.now ?? startedAt;
  const cutoff = now - DAY_MS;
  const batchSize = normalizeBatchSize(options.batchSize);
  const log = options.log ?? ((entry) => console.log(JSON.stringify(entry)));
  const result: UploadCleanupResult = {
    scanned: 0,
    expired: 0,
    deletedPending: 0,
    deletedFinal: 0,
    restoredClaimed: 0,
    failed: 0,
  };
  const client = await options.pool.connect();

  try {
    await client.query("BEGIN");
    const candidates = await selectCandidates(client, now, cutoff, batchSize);
    result.scanned = candidates.length;

    for (const upload of candidates) {
      if (upload.status === "authorized" || upload.status === "uploaded") {
        try {
          await deleteIfPresent(options.gateway, upload.pending_object_key);
        } catch {
          result.failed += 1;
          continue;
        }
        await client.query(
          `UPDATE upload_sessions
           SET status = 'expired', failure_code = 'authorization_expired', updated_at = $2
           WHERE id = $1`,
          [upload.id, now],
        );
        result.deletedPending += 1;
        result.expired += 1;
        continue;
      }

      if (upload.status === "failed" || upload.status === "expired") {
        try {
          const keys = [upload.pending_object_key, upload.final_object_key]
            .filter((key): key is string => Boolean(key));
          for (const key of new Set(keys)) {
            await deleteIfPresent(options.gateway, key);
          }
        } catch {
          result.failed += 1;
          continue;
        }
        await client.query("DELETE FROM upload_sessions WHERE id = $1", [upload.id]);
        result.deletedPending += 1;
        if (upload.final_object_key) result.deletedFinal += 1;
        continue;
      }

      if (upload.status === "finalized" && upload.final_object_key) {
        if (await hasBusinessReference(client, upload.final_object_key)) {
          await client.query(
            `UPDATE upload_sessions
             SET status = 'claimed', claimed_at = COALESCE(claimed_at, $2), updated_at = $2
             WHERE id = $1`,
            [upload.id, now],
          );
          result.restoredClaimed += 1;
        } else {
          try {
            await deleteIfPresent(options.gateway, upload.final_object_key);
          } catch {
            result.failed += 1;
            continue;
          }
          await client.query("DELETE FROM upload_sessions WHERE id = $1", [upload.id]);
          result.deletedFinal += 1;
        }
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  log({
    event: "direct_upload_cleanup",
    status: result.failed === 0 ? "ok" : "partial_failure",
    durationMs: Date.now() - startedAt,
    ...result,
  });
  return result;
}
