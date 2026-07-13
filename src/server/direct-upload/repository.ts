import type pg from "pg";

import { assertAuthorizationCapacity } from "./rateLimit.ts";
import type {
  AllowedUploadMimeType,
  UploadMediaKind,
  UploadRepositoryClient,
  UploadSession,
  UploadSessionRepository,
  UploadSessionReservation,
  UploadStatus,
  UploadStatusUpdate,
} from "./types.ts";

interface UploadSessionRow {
  id: string;
  user_id: string;
  media_kind: UploadMediaKind;
  original_name: string;
  declared_mime_type: AllowedUploadMimeType;
  declared_size: string | number;
  pending_object_key: string;
  final_object_key: string | null;
  status: UploadStatus;
  expires_at: string | number;
  claimed_at: string | number | null;
  failure_code: string | null;
  created_at: string | number;
  updated_at: string | number;
}

const UPLOAD_COLUMNS = `
  id, user_id, media_kind, original_name, declared_mime_type, declared_size,
  pending_object_key, final_object_key, status, expires_at, claimed_at,
  failure_code, created_at, updated_at
`;

function safeInteger(value: string | number, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid upload_sessions.${field}`);
  }
  return parsed;
}

function nullableSafeInteger(
  value: string | number | null,
  field: string,
): number | null {
  return value === null ? null : safeInteger(value, field);
}

function mapUploadSession(row: UploadSessionRow): UploadSession {
  return {
    id: row.id,
    userId: row.user_id,
    mediaKind: row.media_kind,
    originalName: row.original_name,
    declaredMimeType: row.declared_mime_type,
    declaredSize: safeInteger(row.declared_size, "declared_size"),
    pendingObjectKey: row.pending_object_key,
    finalObjectKey: row.final_object_key,
    status: row.status,
    expiresAt: safeInteger(row.expires_at, "expires_at"),
    claimedAt: nullableSafeInteger(row.claimed_at, "claimed_at"),
    failureCode: row.failure_code,
    createdAt: safeInteger(row.created_at, "created_at"),
    updatedAt: safeInteger(row.updated_at, "updated_at"),
  };
}

async function queryForOwner(
  client: UploadRepositoryClient,
  uploadId: string,
  userId: string,
  lock: boolean,
): Promise<UploadSession | null> {
  const result = await client.query<UploadSessionRow>(
    `SELECT ${UPLOAD_COLUMNS}
     FROM upload_sessions
     WHERE id = $1 AND user_id = $2
     ${lock ? "FOR UPDATE" : ""}`,
    [uploadId, userId],
  );
  return result.rows[0] ? mapUploadSession(result.rows[0]) : null;
}

async function updateStatus(
  client: UploadRepositoryClient,
  input: UploadStatusUpdate,
): Promise<UploadSession | null> {
  const result = await client.query<UploadSessionRow>(
    `UPDATE upload_sessions
     SET status = $3,
         final_object_key = CASE WHEN $4::boolean THEN $5 ELSE final_object_key END,
         failure_code = CASE WHEN $6::boolean THEN $7 ELSE failure_code END,
         claimed_at = CASE WHEN $8::boolean THEN $9 ELSE claimed_at END,
         updated_at = $10
     WHERE id = $1 AND user_id = $2
     RETURNING ${UPLOAD_COLUMNS}`,
    [
      input.uploadId,
      input.userId,
      input.status,
      input.finalObjectKey !== undefined,
      input.finalObjectKey ?? null,
      input.failureCode !== undefined,
      input.failureCode ?? null,
      input.claimedAt !== undefined,
      input.claimedAt ?? null,
      input.now,
    ],
  );
  return result.rows[0] ? mapUploadSession(result.rows[0]) : null;
}

export function createUploadSessionRepository(
  pool: pg.Pool,
): UploadSessionRepository {
  return {
    async reserveAuthorized(input: UploadSessionReservation) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await assertAuthorizationCapacity(client, {
          userId: input.userId,
          now: input.now,
          windowStart: input.rateWindowStart,
          activeLimit: input.activeLimit,
          rateLimit: input.rateLimit,
        });
        const result = await client.query<UploadSessionRow>(
          `INSERT INTO upload_sessions (
             id, user_id, media_kind, original_name, declared_mime_type,
             declared_size, pending_object_key, status, expires_at,
             created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'authorized', $8, $9, $9)
           RETURNING ${UPLOAD_COLUMNS}`,
          [
            input.id,
            input.userId,
            input.mediaKind,
            input.originalName,
            input.declaredMimeType,
            input.declaredSize,
            input.pendingObjectKey,
            input.expiresAt,
            input.now,
          ],
        );
        await client.query("COMMIT");
        const row = result.rows[0];
        if (!row) throw new Error("PostgreSQL did not return the reserved upload session");
        return mapUploadSession(row);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    getForOwner(uploadId, userId) {
      return queryForOwner(pool, uploadId, userId, false);
    },

    async withLockedForOwner(uploadId, userId, operation) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const upload = await queryForOwner(client, uploadId, userId, true);
        const result = await operation(client, upload);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    getLockedForOwner(client, uploadId, userId) {
      return queryForOwner(client, uploadId, userId, true);
    },

    updateStatus,

    async markFailed(uploadId, userId, failureCode, now) {
      const result = await pool.query<UploadSessionRow>(
        `UPDATE upload_sessions
         SET status = 'failed', failure_code = $3, updated_at = $4
         WHERE id = $1 AND user_id = $2
           AND status IN ('authorized', 'uploaded', 'finalized')
         RETURNING ${UPLOAD_COLUMNS}`,
        [uploadId, userId, failureCode, now],
      );
      return result.rows[0] ? mapUploadSession(result.rows[0]) : null;
    },
  };
}
