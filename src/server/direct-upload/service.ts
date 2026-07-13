import { randomUUID } from "node:crypto";

import type pg from "pg";

import {
  detectFileKind,
  isDetectedKindCompatible,
  MAX_SIGNATURE_BYTES,
} from "./magicBytes.ts";
import type { DirectUploadGateway } from "./ossGateway.ts";
import {
  buildFinalObjectKey,
  buildPendingObjectKey,
  normalizeUploadMimeType,
  UploadPolicyError,
  validateUploadRequest,
} from "./policy.ts";
import { FINALIZED_RETENTION_MS, UploadCapacityError } from "./rateLimit.ts";
import { canTransition } from "./stateMachine.ts";
import type {
  ClaimWriter,
  PublicUploadSession,
  UploadAuthorizationRequest,
  UploadAuthorizationResponse,
  UploadCategory,
  UploadClaimResult,
  UploadPrincipal,
  UploadRepositoryClient,
  UploadSession,
  UploadSessionRepository,
  UploadStatus,
} from "./types.ts";

export type DirectUploadServiceErrorCode =
  | "not_found"
  | "rate_limited"
  | "active_limit"
  | "expired"
  | "invalid_state"
  | "invalid_request"
  | "unsafe_key_segment"
  | "unsupported_type"
  | "media_kind_mismatch"
  | "size_mismatch"
  | "size_exceeded"
  | "type_mismatch"
  | "storage_error";

export class DirectUploadServiceError extends Error {
  readonly code: DirectUploadServiceErrorCode;
  readonly httpStatus: number;

  constructor(
    code: DirectUploadServiceErrorCode,
    message: string,
    httpStatus: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DirectUploadServiceError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface DirectUploadServiceConfig {
  authorizationTtlSeconds: number;
  videoStsTtlSeconds: number;
  activeSessionsPerUser: number;
  authorizationsPerMinute: number;
  maxImageBytes: number;
  maxDocumentBytes: number;
  maxVideoBytes: number;
}

export interface DirectUploadServiceDependencies {
  repository: UploadSessionRepository;
  gateway: DirectUploadGateway;
  config: DirectUploadServiceConfig;
  now?: () => number;
  uuid?: () => string;
}

export interface DirectUploadService {
  authorize(
    user: UploadPrincipal,
    request: UploadAuthorizationRequest,
  ): Promise<UploadAuthorizationResponse>;
  complete(
    user: UploadPrincipal,
    uploadId: string,
  ): Promise<PublicUploadSession>;
  get(user: UploadPrincipal, uploadId: string): Promise<PublicUploadSession>;
  abort(user: UploadPrincipal, uploadId: string): Promise<PublicUploadSession>;
  claim<Value>(
    client: pg.PoolClient,
    user: UploadPrincipal,
    uploadId: string,
    writer: ClaimWriter<Value>,
  ): Promise<UploadClaimResult<Value>>;
}

interface DeferredServiceError {
  error: DirectUploadServiceError;
}

interface CompletedSession {
  session: UploadSession;
}

type CompletionOutcome = DeferredServiceError | CompletedSession;

function serviceError(
  code: DirectUploadServiceErrorCode,
  message: string,
  httpStatus: number,
  cause?: unknown,
): DirectUploadServiceError {
  return new DirectUploadServiceError(
    code,
    message,
    httpStatus,
    cause === undefined ? undefined : { cause },
  );
}

function mapPolicyError(error: UploadPolicyError): DirectUploadServiceError {
  switch (error.code) {
    case "size_exceeded":
      return serviceError("size_exceeded", error.message, 413, error);
    case "unsupported_type":
      return serviceError("unsupported_type", error.message, 415, error);
    case "media_kind_mismatch":
      return serviceError("media_kind_mismatch", error.message, 415, error);
    case "unsafe_key_segment":
      return serviceError("unsafe_key_segment", error.message, 400, error);
    case "invalid_request":
      return serviceError("invalid_request", error.message, 400, error);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function validateServiceConfig(config: DirectUploadServiceConfig): void {
  assertPositiveInteger(config.authorizationTtlSeconds, "authorizationTtlSeconds");
  assertPositiveInteger(config.videoStsTtlSeconds, "videoStsTtlSeconds");
  assertPositiveInteger(config.activeSessionsPerUser, "activeSessionsPerUser");
  assertPositiveInteger(config.authorizationsPerMinute, "authorizationsPerMinute");
  assertPositiveInteger(config.maxImageBytes, "maxImageBytes");
  assertPositiveInteger(config.maxDocumentBytes, "maxDocumentBytes");
  assertPositiveInteger(config.maxVideoBytes, "maxVideoBytes");
}

function sizeLimits(
  config: DirectUploadServiceConfig,
): Readonly<Record<UploadCategory, number>> {
  return {
    image: config.maxImageBytes,
    document: config.maxDocumentBytes,
    video: config.maxVideoBytes,
  };
}

function publicSession(upload: UploadSession): PublicUploadSession {
  return {
    uploadId: upload.id,
    mediaKind: upload.mediaKind,
    mimeType: upload.declaredMimeType,
    size: upload.declaredSize,
    status: upload.status,
    expiresAt: upload.expiresAt,
    ...(upload.finalObjectKey ? { finalObjectKey: upload.finalObjectKey } : {}),
    ...(upload.failureCode ? { failureCode: upload.failureCode } : {}),
  };
}

function notFound(): DirectUploadServiceError {
  return serviceError("not_found", "Upload session not found", 404);
}

function invalidState(status: UploadStatus): DirectUploadServiceError {
  return serviceError(
    "invalid_state",
    `Upload cannot be changed from ${status}`,
    409,
  );
}

async function deleteQuietly(
  gateway: DirectUploadGateway,
  keys: Array<string | null | undefined>,
): Promise<void> {
  await Promise.allSettled(
    [...new Set(keys.filter((key): key is string => Boolean(key)))].map((key) =>
      gateway.delete(key),
    ),
  );
}

function isDeferredError(
  outcome: CompletionOutcome,
): outcome is DeferredServiceError {
  return "error" in outcome;
}

export function createDirectUploadService(
  dependencies: DirectUploadServiceDependencies,
): DirectUploadService {
  validateServiceConfig(dependencies.config);
  const { repository, gateway, config } = dependencies;
  const now = dependencies.now ?? Date.now;
  const uuid = dependencies.uuid ?? randomUUID;
  const configuredSizeLimits = sizeLimits(config);

  async function failLocked(
    client: UploadRepositoryClient,
    upload: UploadSession,
    failureCode: string,
    error: DirectUploadServiceError,
    cleanupKeys: Array<string | null | undefined>,
  ): Promise<DeferredServiceError> {
    await deleteQuietly(gateway, cleanupKeys);
    await repository.updateStatus(client, {
      uploadId: upload.id,
      userId: upload.userId,
      status: "failed",
      failureCode,
      now: now(),
    });
    return { error };
  }

  return {
    async authorize(user, request) {
      let policy;
      try {
        policy = validateUploadRequest(request, configuredSizeLimits);
      } catch (error) {
        if (error instanceof UploadPolicyError) throw mapPolicyError(error);
        throw error;
      }

      const createdAt = now();
      const uploadId = uuid();
      const randomId = uuid();
      let pendingObjectKey: string;
      try {
        pendingObjectKey = buildPendingObjectKey({
          userId: user.id,
          uploadId,
          randomId,
          extension: policy.extension,
        });
      } catch (error) {
        if (error instanceof UploadPolicyError) throw mapPolicyError(error);
        throw error;
      }
      const expiresAt = createdAt + config.authorizationTtlSeconds * 1000;

      let upload: UploadSession;
      try {
        upload = await repository.reserveAuthorized({
          id: uploadId,
          userId: user.id,
          mediaKind: request.mediaKind,
          originalName: request.filename,
          declaredMimeType: policy.mimeType,
          declaredSize: request.size,
          pendingObjectKey,
          expiresAt,
          now: createdAt,
          activeLimit: config.activeSessionsPerUser,
          rateLimit: config.authorizationsPerMinute,
          rateWindowStart: createdAt - 60_000,
        });
      } catch (error) {
        if (error instanceof UploadCapacityError) {
          throw serviceError(error.code, error.message, 429, error);
        }
        throw error;
      }

      try {
        if (policy.category === "video") {
          const sts = await gateway.createMultipartCredentials({
            userId: user.id,
            objectKey: upload.pendingObjectKey,
            expiresSeconds: config.videoStsTtlSeconds,
          });
          return {
            uploadId: upload.id,
            objectKey: upload.pendingObjectKey,
            expiresAt: Math.min(upload.expiresAt, sts.expiresAt),
            strategy: "sts-multipart",
            sts,
          };
        }

        const signedPut = await gateway.createSignedPut({
          objectKey: upload.pendingObjectKey,
          mimeType: upload.declaredMimeType,
          expiresSeconds: config.authorizationTtlSeconds,
        });
        return {
          uploadId: upload.id,
          objectKey: upload.pendingObjectKey,
          expiresAt: upload.expiresAt,
          strategy: "signed-put",
          signedPut,
        };
      } catch (error) {
        await repository.markFailed(upload.id, user.id, "grant_failed", now());
        await deleteQuietly(gateway, [upload.pendingObjectKey]);
        throw serviceError(
          "storage_error",
          "Could not create the temporary upload grant",
          502,
          error,
        );
      }
    },

    async complete(user, uploadId) {
      const outcome = await repository.withLockedForOwner<CompletionOutcome>(
        uploadId,
        user.id,
        async (client, upload) => {
          if (!upload) return { error: notFound() };
          if (upload.status === "finalized" || upload.status === "claimed") {
            return { session: upload };
          }
          if (upload.status === "expired") {
            return {
              error: serviceError("expired", "Upload authorization expired", 409),
            };
          }
          if (upload.status === "failed") return { error: invalidState(upload.status) };

          if (upload.expiresAt <= now()) {
            await deleteQuietly(gateway, [upload.pendingObjectKey]);
            await repository.updateStatus(client, {
              uploadId: upload.id,
              userId: upload.userId,
              status: "expired",
              failureCode: "authorization_expired",
              now: now(),
            });
            return {
              error: serviceError("expired", "Upload authorization expired", 409),
            };
          }

          let policy;
          try {
            policy = validateUploadRequest(
              {
                mediaKind: upload.mediaKind,
                filename: upload.originalName,
                mimeType: upload.declaredMimeType,
                size: upload.declaredSize,
              },
              configuredSizeLimits,
            );
          } catch (error) {
            const mapped =
              error instanceof UploadPolicyError
                ? mapPolicyError(error)
                : serviceError("invalid_request", "Stored upload policy is invalid", 400, error);
            return failLocked(client, upload, "stored_policy_invalid", mapped, [
              upload.pendingObjectKey,
            ]);
          }

          let head: Awaited<ReturnType<DirectUploadGateway["head"]>>;
          try {
            head = await gateway.head(upload.pendingObjectKey);
          } catch (error) {
            return failLocked(
              client,
              upload,
              "head_failed",
              serviceError("storage_error", "Could not inspect the uploaded object", 502, error),
              [upload.pendingObjectKey],
            );
          }

          if (head.size > policy.maxSize) {
            return failLocked(
              client,
              upload,
              "actual_size_exceeded",
              serviceError("size_exceeded", "Uploaded object exceeds its size limit", 413),
              [upload.pendingObjectKey],
            );
          }
          if (head.size !== upload.declaredSize) {
            return failLocked(
              client,
              upload,
              "size_mismatch",
              serviceError("size_mismatch", "Uploaded object size does not match", 413),
              [upload.pendingObjectKey],
            );
          }

          let headMimeType: string;
          try {
            headMimeType = head.contentType
              ? normalizeUploadMimeType(head.contentType)
              : "";
          } catch {
            headMimeType = "";
          }
          if (headMimeType !== upload.declaredMimeType) {
            return failLocked(
              client,
              upload,
              "content_type_mismatch",
              serviceError("type_mismatch", "Uploaded object content type does not match", 415),
              [upload.pendingObjectKey],
            );
          }

          let prefix: Uint8Array;
          try {
            prefix = await gateway.readPrefix(
              upload.pendingObjectKey,
              Math.min(MAX_SIGNATURE_BYTES, upload.declaredSize),
            );
          } catch (error) {
            return failLocked(
              client,
              upload,
              "prefix_read_failed",
              serviceError("storage_error", "Could not inspect the uploaded bytes", 502, error),
              [upload.pendingObjectKey],
            );
          }
          if (!isDetectedKindCompatible(
            detectFileKind(prefix),
            upload.declaredMimeType,
          )) {
            return failLocked(
              client,
              upload,
              "signature_mismatch",
              serviceError("type_mismatch", "Uploaded object signature does not match", 415),
              [upload.pendingObjectKey],
            );
          }

          let uploaded = upload;
          if (upload.status === "authorized") {
            if (!canTransition(upload.status, "uploaded")) {
              return { error: invalidState(upload.status) };
            }
            uploaded =
              (await repository.updateStatus(client, {
                uploadId: upload.id,
                userId: upload.userId,
                status: "uploaded",
                failureCode: null,
                now: now(),
              })) ?? upload;
          } else if (upload.status !== "uploaded") {
            return { error: invalidState(upload.status) };
          }

          const finalObjectKey = buildFinalObjectKey({
            userId: uploaded.userId,
            uploadId: uploaded.id,
            mediaKind: uploaded.mediaKind,
            extension: policy.extension,
            finalizedAt: new Date(now()),
          });

          try {
            await gateway.copy(uploaded.pendingObjectKey, finalObjectKey);
            await gateway.delete(uploaded.pendingObjectKey);
          } catch (error) {
            return failLocked(
              client,
              uploaded,
              "copy_failed",
              serviceError("storage_error", "Could not finalize the uploaded object", 502, error),
              [uploaded.pendingObjectKey, finalObjectKey],
            );
          }

          const finalized = await repository.updateStatus(client, {
            uploadId: uploaded.id,
            userId: uploaded.userId,
            status: "finalized",
            finalObjectKey,
            failureCode: null,
            now: now(),
          });
          if (!finalized) return { error: notFound() };
          return { session: finalized };
        },
      );

      if (isDeferredError(outcome)) throw outcome.error;
      return publicSession(outcome.session);
    },

    async get(user, uploadId) {
      const upload = await repository.getForOwner(uploadId, user.id);
      if (!upload) throw notFound();
      return publicSession(upload);
    },

    async abort(user, uploadId) {
      const outcome = await repository.withLockedForOwner<CompletionOutcome>(
        uploadId,
        user.id,
        async (client, upload) => {
          if (!upload) return { error: notFound() };
          if (upload.status === "failed" || upload.status === "expired") {
            return { session: upload };
          }
          if (upload.status === "claimed") return { error: invalidState(upload.status) };

          try {
            await Promise.all(
              [upload.pendingObjectKey, upload.finalObjectKey]
                .filter((key): key is string => Boolean(key))
                .map((key) => gateway.delete(key)),
            );
          } catch (error) {
            await deleteQuietly(gateway, [upload.pendingObjectKey, upload.finalObjectKey]);
            const failed = await repository.updateStatus(client, {
              uploadId: upload.id,
              userId: upload.userId,
              status: "failed",
              failureCode: "abort_cleanup_failed",
              now: now(),
            });
            return {
              error: serviceError("storage_error", "Could not abort the upload cleanly", 502, error),
              ...(failed ? { session: failed } : {}),
            } as DeferredServiceError;
          }

          const failed = await repository.updateStatus(client, {
            uploadId: upload.id,
            userId: upload.userId,
            status: "failed",
            failureCode: "aborted",
            now: now(),
          });
          return failed ? { session: failed } : { error: notFound() };
        },
      );
      if (isDeferredError(outcome)) throw outcome.error;
      return publicSession(outcome.session);
    },

    async claim(client, user, uploadId, writer) {
      const repositoryClient: UploadRepositoryClient = client;
      const upload = await repository.getLockedForOwner(
        repositoryClient,
        uploadId,
        user.id,
      );
      if (!upload) throw notFound();
      if (upload.status === "claimed") {
        return { session: publicSession(upload), created: false };
      }
      if (upload.status === "expired") {
        throw serviceError("expired", "Upload authorization expired", 409);
      }
      if (upload.status !== "finalized" || !upload.finalObjectKey) {
        throw invalidState(upload.status);
      }
      if (upload.updatedAt + FINALIZED_RETENTION_MS <= now()) {
        throw serviceError("expired", "Upload authorization expired", 409);
      }

      const value = await writer(repositoryClient, upload);
      const claimed = await repository.updateStatus(repositoryClient, {
        uploadId: upload.id,
        userId: upload.userId,
        status: "claimed",
        claimedAt: now(),
        failureCode: null,
        now: now(),
      });
      if (!claimed) throw notFound();
      return { session: publicSession(claimed), created: true, value };
    },
  };
}
