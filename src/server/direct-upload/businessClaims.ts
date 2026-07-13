import type pg from "pg";

import type { DirectUploadService } from "./service.ts";
import type {
  PublicUploadSession,
  UploadMediaKind,
  UploadPrincipal,
  UploadSession,
} from "./types.ts";

export class DirectUploadBusinessClaimError extends Error {
  readonly code: "media_kind_mismatch" | "claimed_business_record_missing";
  readonly httpStatus: number;

  constructor(
    code: "media_kind_mismatch" | "claimed_business_record_missing",
    message: string,
    httpStatus: number,
  ) {
    super(message);
    this.name = "DirectUploadBusinessClaimError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
export interface BusinessClaimPool {
  connect(): Promise<pg.PoolClient>;
}

export interface ClaimBusinessUploadInput<Value> {
  pool: BusinessClaimPool;
  service: Pick<DirectUploadService, "claim">;
  user: UploadPrincipal;
  uploadId: string;
  expectedKinds: readonly UploadMediaKind[];
  write(client: pg.PoolClient, upload: UploadSession): Promise<Value>;
  readExisting(
    client: pg.PoolClient,
    session: PublicUploadSession,
  ): Promise<Value | null>;
}

export interface BusinessClaimResult<Value> {
  created: boolean;
  value: Value;
  session: PublicUploadSession;
}

/**
 * Claims a finalized upload and writes its business record in one PostgreSQL
 * transaction. A deterministic business id lets retries return the row that
 * was created by the first successful request.
 */
export async function claimBusinessUpload<Value>(
  input: ClaimBusinessUploadInput<Value>,
): Promise<BusinessClaimResult<Value>> {
  const client = await input.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await input.service.claim(
      client,
      input.user,
      input.uploadId,
      async (_repositoryClient, upload) => {
        if (!input.expectedKinds.includes(upload.mediaKind)) {
          throw new DirectUploadBusinessClaimError(
            "media_kind_mismatch",
            "Upload media kind is not valid for this endpoint",
            415,
          );
        }
        return input.write(client, upload);
      },
    );

    const value = result.created
      ? result.value
      : await input.readExisting(client, result.session);
    if (value == null) {
      throw new DirectUploadBusinessClaimError(
        "claimed_business_record_missing",
        "The upload was already claimed by another business record",
        409,
      );
    }

    await client.query("COMMIT");
    return { created: result.created, value, session: result.session };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
