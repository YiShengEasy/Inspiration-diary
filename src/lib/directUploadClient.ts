import type {
  StsMultipartGrant,
  UploadAuthorizationResponse,
  UploadMediaKind,
} from "../server/direct-upload/types.ts";

const MULTIPART_PARALLEL = 3;
const MULTIPART_PART_SIZE = 1_048_576;

export interface DirectUploadOptions {
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
}

export interface DirectUploadResult {
  uploadId: string;
  finalObjectKey: string;
}

export interface MultipartUploadClient {
  multipartUpload(
    objectKey: string,
    file: File,
    options: {
      parallel: number;
      partSize: number;
      mime: string;
      progress: (ratio: number) => void;
    },
  ): Promise<unknown>;
  cancel(): void;
}

export type MultipartUploadClientFactory = (
  grant: StsMultipartGrant,
) => MultipartUploadClient | Promise<MultipartUploadClient>;

export interface DirectUploadClientDependencies {
  fetch?: typeof fetch;
  createMultipartClient?: MultipartUploadClientFactory;
}

type UploadPhase = "authorize" | "object-upload" | "complete";

export class DirectUploadUnavailableError extends Error {
  readonly code = "direct_upload_unavailable";
  readonly status = 404;

  constructor() {
    super("Direct upload is unavailable");
    this.name = "DirectUploadUnavailableError";
  }
}

export class DirectUploadRequestError extends Error {
  readonly code = "direct_upload_request_failed";

  constructor(
    message: string,
    readonly status: number,
    readonly phase: UploadPhase,
  ) {
    super(message);
    this.name = "DirectUploadRequestError";
  }
}

export function isDirectUploadUnavailable(
  error: unknown,
): error is DirectUploadUnavailableError {
  return error instanceof DirectUploadUnavailableError;
}

function createAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("The upload was aborted", "AbortError");
  }
  const error = new Error("The upload was aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

async function defaultMultipartClientFactory(
  grant: StsMultipartGrant,
): Promise<MultipartUploadClient> {
  const { default: OSS } = await import("ali-oss");
  return new OSS({
    region: grant.region,
    bucket: grant.bucket,
    endpoint: grant.endpoint,
    accessKeyId: grant.accessKeyId,
    accessKeySecret: grant.accessKeySecret,
    stsToken: grant.securityToken,
    secure: true,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readPublicError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  if (isRecord(body) && typeof body.error === "string" && body.error.trim()) {
    return body.error.trim();
  }
  return response.statusText || `HTTP ${response.status}`;
}

function parseAuthorization(value: unknown): UploadAuthorizationResponse {
  if (!isRecord(value)) throw new Error("Invalid direct upload authorization");

  const strategy = value.strategy;
  const signedPut = value.signedPut;
  const sts = value.sts;
  if (
    typeof value.uploadId !== "string" ||
    typeof value.objectKey !== "string" ||
    typeof value.expiresAt !== "number" ||
    (strategy !== "signed-put" && strategy !== "sts-multipart") ||
    (strategy === "signed-put" &&
      (!isRecord(signedPut) ||
        typeof signedPut.url !== "string" ||
        !isRecord(signedPut.headers))) ||
    (strategy === "sts-multipart" &&
      (!isRecord(sts) ||
        typeof sts.region !== "string" ||
        typeof sts.bucket !== "string" ||
        typeof sts.endpoint !== "string" ||
        typeof sts.accessKeyId !== "string" ||
        typeof sts.accessKeySecret !== "string" ||
        typeof sts.securityToken !== "string"))
  ) {
    throw new Error("Invalid direct upload authorization");
  }

  return value as unknown as UploadAuthorizationResponse;
}

function parseCompletion(value: unknown, uploadId: string): DirectUploadResult {
  if (
    !isRecord(value) ||
    value.uploadId !== uploadId ||
    typeof value.finalObjectKey !== "string" ||
    value.finalObjectKey.length === 0
  ) {
    throw new Error("Invalid direct upload completion");
  }
  return { uploadId, finalObjectKey: value.finalObjectKey };
}

function createProgressReporter(callback?: (ratio: number) => void) {
  let lastRatio = -1;
  return (ratio: number): void => {
    const next = Math.max(lastRatio, Math.min(1, Math.max(0, ratio)));
    if (next === lastRatio) return;
    lastRatio = next;
    try {
      callback?.(next);
    } catch {
      // UI progress handlers must not interrupt a successfully running upload.
    }
  };
}

export function createDirectUploadClient(
  dependencies: DirectUploadClientDependencies = {},
): {
  uploadDirect: (
    file: File,
    mediaKind: UploadMediaKind,
    options?: DirectUploadOptions,
  ) => Promise<DirectUploadResult>;
} {
  const request = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const createMultipartClient =
    dependencies.createMultipartClient ?? defaultMultipartClientFactory;

  async function requestAbort(uploadId: string): Promise<void> {
    await request(`/api/uploads/${encodeURIComponent(uploadId)}/abort`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => undefined);
  }

  return {
    async uploadDirect(file, mediaKind, options = {}) {
      throwIfAborted(options.signal);
      const reportProgress = createProgressReporter(options.onProgress);
      reportProgress(0);

      const authorizationResponse = await request("/api/uploads/authorize", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaKind,
          filename: file.name,
          mimeType: file.type,
          size: file.size,
        }),
        signal: options.signal,
      });

      if (authorizationResponse.status === 404) {
        throw new DirectUploadUnavailableError();
      }
      if (!authorizationResponse.ok) {
        throw new DirectUploadRequestError(
          await readPublicError(authorizationResponse),
          authorizationResponse.status,
          "authorize",
        );
      }

      const authorization = parseAuthorization(
        await authorizationResponse.json(),
      );
      let completionStarted = false;

      try {
        if (authorization.strategy === "signed-put") {
          const grant = authorization.signedPut!;
          const objectResponse = await request(grant.url, {
            method: "PUT",
            credentials: "omit",
            headers: grant.headers,
            body: file,
            signal: options.signal,
          });
          if (!objectResponse.ok) {
            throw new DirectUploadRequestError(
              "Object storage rejected the upload",
              objectResponse.status,
              "object-upload",
            );
          }
          reportProgress(0.98);
        } else {
          const client = await createMultipartClient(authorization.sts!);
          const cancel = () => client.cancel();
          options.signal?.addEventListener("abort", cancel, { once: true });
          try {
            throwIfAborted(options.signal);
            await client.multipartUpload(authorization.objectKey, file, {
              parallel: MULTIPART_PARALLEL,
              partSize: MULTIPART_PART_SIZE,
              mime: file.type,
              progress: (ratio) => reportProgress(ratio * 0.98),
            });
            throwIfAborted(options.signal);
            reportProgress(0.98);
          } catch (error) {
            if (options.signal?.aborted) throw createAbortError();
            throw error;
          } finally {
            options.signal?.removeEventListener("abort", cancel);
          }
        }

        throwIfAborted(options.signal);
        completionStarted = true;
        const completionResponse = await request(
          `/api/uploads/${encodeURIComponent(authorization.uploadId)}/complete`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: "{}",
            signal: options.signal,
          },
        );
        if (!completionResponse.ok) {
          throw new DirectUploadRequestError(
            await readPublicError(completionResponse),
            completionResponse.status,
            "complete",
          );
        }

        const result = parseCompletion(
          await completionResponse.json(),
          authorization.uploadId,
        );
        reportProgress(1);
        return result;
      } catch (error) {
        if (options.signal?.aborted || isAbortError(error)) {
          await requestAbort(authorization.uploadId);
          throw createAbortError();
        }
        if (!completionStarted) {
          await requestAbort(authorization.uploadId);
        }
        throw error;
      }
    },
  };
}

const defaultClient = createDirectUploadClient();

export function uploadDirect(
  file: File,
  mediaKind: UploadMediaKind,
  options?: DirectUploadOptions,
): Promise<DirectUploadResult> {
  return defaultClient.uploadDirect(file, mediaKind, options);
}
