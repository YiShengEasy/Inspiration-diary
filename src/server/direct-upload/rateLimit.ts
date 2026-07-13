import type { UploadRepositoryClient } from "./types.ts";

export type UploadCapacityErrorCode = "active_limit" | "rate_limited";
export const FINALIZED_RETENTION_MS = 24 * 60 * 60 * 1000;

export class UploadCapacityError extends Error {
  readonly code: UploadCapacityErrorCode;

  constructor(code: UploadCapacityErrorCode, message: string) {
    super(message);
    this.name = "UploadCapacityError";
    this.code = code;
  }
}

export interface AuthorizationCapacityInput {
  userId: string;
  now: number;
  windowStart: number;
  activeLimit: number;
  rateLimit: number;
}

function readCount(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name} count returned by PostgreSQL`);
  }
  return parsed;
}

/**
 * Serializes authorization for one tenant owner. Counts are read from
 * PostgreSQL, so restarts and multiple Node workers cannot bypass limits.
 * The caller must already be inside a transaction.
 */
export async function assertAuthorizationCapacity(
  client: UploadRepositoryClient,
  input: AuthorizationCapacityInput,
): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.userId]);

  await client.query(
    `UPDATE upload_sessions
     SET status = 'expired', failure_code = 'authorization_expired', updated_at = $2
     WHERE user_id = $1
       AND status IN ('authorized', 'uploaded')
       AND expires_at <= $2`,
    [input.userId, input.now],
  );

  const result = await client.query<{
    active_count: string | number;
    recent_count: string | number;
  }>(
    `SELECT
       COUNT(*) FILTER (
         WHERE (
           status IN ('authorized', 'uploaded') AND expires_at > $2
         ) OR (
           status = 'finalized' AND updated_at > $4
         )
       ) AS active_count,
       COUNT(*) FILTER (WHERE created_at >= $3) AS recent_count
     FROM upload_sessions
     WHERE user_id = $1`,
    [
      input.userId,
      input.now,
      input.windowStart,
      input.now - FINALIZED_RETENTION_MS,
    ],
  );

  const row = result.rows[0];
  const activeCount = readCount(row?.active_count ?? 0, "active upload");
  const recentCount = readCount(row?.recent_count ?? 0, "recent authorization");

  if (activeCount >= input.activeLimit) {
    throw new UploadCapacityError(
      "active_limit",
      `Active upload session limit (${input.activeLimit}) reached`,
    );
  }
  if (recentCount >= input.rateLimit) {
    throw new UploadCapacityError(
      "rate_limited",
      `Authorization limit (${input.rateLimit}/minute) reached`,
    );
  }
}
