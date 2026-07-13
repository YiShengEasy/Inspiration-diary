import { createHash } from "node:crypto";

import OSS from "ali-oss";

import type { RuntimeConfig } from "../runtimeConfig.ts";
import type { StsMultipartGrant } from "./types.ts";

const MAX_GRANT_TTL_SECONDS = 15 * 60;
const MAX_PREFIX_BYTES = 16 * 1024;

export const OSS_MULTIPART_UPLOAD_ACTIONS = [
  "oss:PutObject",
  "oss:AbortMultipartUpload",
  "oss:ListParts",
] as const;

export interface TemporaryOssCredentials extends StsMultipartGrant {
  expiresAt: number;
}

export interface DirectUploadGateway {
  createSignedPut(input: {
    objectKey: string;
    mimeType: string;
    expiresSeconds: number;
  }): Promise<{ url: string; headers: Record<string, string> }>;
  createMultipartCredentials(input: {
    userId: string;
    objectKey: string;
    expiresSeconds: number;
  }): Promise<TemporaryOssCredentials>;
  head(objectKey: string): Promise<{ size: number; contentType?: string }>;
  readPrefix(objectKey: string, maxBytes: number): Promise<Uint8Array>;
  copy(sourceKey: string, destinationKey: string): Promise<void>;
  delete(objectKey: string): Promise<void>;
}

interface OssSigner {
  signatureUrlV4(
    method: "PUT",
    expires: number,
    request: { headers: Record<string, string> },
    objectKey: string,
  ): Promise<string>;
}

interface OssObjectClient {
  head(objectKey: string): Promise<{
    res: { headers: Record<string, unknown> };
  }>;
  get(
    objectKey: string,
    options: { headers: Record<string, string> },
  ): Promise<{ content?: unknown }>;
  copy(destinationKey: string, sourceKey: string): Promise<unknown>;
  delete(objectKey: string): Promise<unknown>;
}

interface OssStsClient {
  assumeRole(
    roleArn: string,
    policy: object,
    expirationSeconds: number,
    sessionName: string,
  ): Promise<{
    credentials: {
      AccessKeyId: string;
      AccessKeySecret: string;
      SecurityToken: string;
      Expiration: string;
    };
  }>;
}

export interface OssGatewayDependencies {
  signer?: OssSigner;
  objectClient?: OssObjectClient;
  stsClient?: OssStsClient;
  now?: () => number;
}

function getPublicEndpoint(endpoint: string): string {
  return endpoint.replace("-internal.", ".");
}

function assertSafeBucket(bucket: string): void {
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/u.test(bucket)) {
    throw new Error("Invalid OSS bucket name");
  }
}

function assertSafeObjectKey(objectKey: string): void {
  if (
    objectKey.length === 0 ||
    objectKey.length > 1024 ||
    objectKey.startsWith("/") ||
    /[\\*?\u0000-\u001f\u007f]/u.test(objectKey) ||
    objectKey.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("Unsafe object key");
  }
}

function normalizeGrantTtl(expiresSeconds: number): number {
  if (!Number.isSafeInteger(expiresSeconds) || expiresSeconds <= 0) {
    throw new Error("Grant expiry must be a positive integer");
  }
  return Math.min(expiresSeconds, MAX_GRANT_TTL_SECONDS);
}

function assertSafeMimeType(mimeType: string): void {
  if (
    mimeType.length === 0 ||
    mimeType.length > 255 ||
    /[\r\n\u0000]/u.test(mimeType)
  ) {
    throw new Error("Unsafe MIME type");
  }
}

function buildSessionName(userId: string, objectKey: string): string {
  const safeUserId = userId.replace(/[^A-Za-z0-9_-]/gu, "-").slice(0, 32) || "user";
  const objectDigest = createHash("sha256").update(objectKey).digest("hex").slice(0, 12);
  return `upload-${safeUserId}-${objectDigest}`;
}

function readHeader(
  headers: Record<string, unknown>,
  wantedName: string,
): string | undefined {
  const wanted = wantedName.toLowerCase();
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== wanted || value === undefined || value === null) continue;
    if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : undefined;
    return String(value);
  }
  return undefined;
}

function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new Error("OSS range response did not contain binary content");
}

export function createOssDirectUploadGateway(
  config: RuntimeConfig,
  dependencies: OssGatewayDependencies = {},
): DirectUploadGateway {
  assertSafeBucket(config.oss.bucket);

  const publicEndpoint = getPublicEndpoint(config.oss.endpoint);
  const defaultObjectClient = new OSS({
    region: config.oss.region,
    bucket: config.oss.bucket,
    endpoint: config.oss.endpoint,
    accessKeyId: config.oss.accessKeyId,
    accessKeySecret: config.oss.accessKeySecret,
    secure: true,
    authorizationV4: true,
  });
  const defaultSignerClient = new OSS({
    region: config.oss.region,
    bucket: config.oss.bucket,
    endpoint: publicEndpoint,
    accessKeyId: config.oss.accessKeyId,
    accessKeySecret: config.oss.accessKeySecret,
    secure: true,
    authorizationV4: true,
  });
  const defaultStsClient = new OSS.STS({
    accessKeyId: config.oss.accessKeyId,
    accessKeySecret: config.oss.accessKeySecret,
  });

  const signer: OssSigner = dependencies.signer ?? {
    signatureUrlV4: (method, expires, request, objectKey) =>
      defaultSignerClient.signatureUrlV4(method, expires, request, objectKey),
  };
  const objectClient: OssObjectClient = dependencies.objectClient ?? {
    head: async (objectKey) => {
      const result = await defaultObjectClient.head(objectKey);
      return { res: { headers: result.res.headers as Record<string, unknown> } };
    },
    get: async (objectKey, options) => {
      const result = await defaultObjectClient.get(objectKey, options);
      return { content: result.content };
    },
    copy: (destinationKey, sourceKey) =>
      defaultObjectClient.copy(destinationKey, sourceKey),
    delete: (objectKey) => defaultObjectClient.delete(objectKey),
  };
  const stsClient: OssStsClient = dependencies.stsClient ?? defaultStsClient;
  const now = dependencies.now ?? Date.now;

  return {
    async createSignedPut(input) {
      assertSafeObjectKey(input.objectKey);
      assertSafeMimeType(input.mimeType);
      const expiresSeconds = normalizeGrantTtl(input.expiresSeconds);
      const headers = { "content-type": input.mimeType };
      const url = await signer.signatureUrlV4(
        "PUT",
        expiresSeconds,
        { headers },
        input.objectKey,
      );
      return { url, headers };
    },

    async createMultipartCredentials(input) {
      assertSafeObjectKey(input.objectKey);
      if (!config.directUpload.stsRoleArn) {
        throw new Error("OSS STS role ARN is not configured");
      }

      const expiresSeconds = normalizeGrantTtl(input.expiresSeconds);
      const objectArn = `acs:oss:*:*:${config.oss.bucket}/${input.objectKey}`;
      const policy = {
        Version: "1",
        Statement: [
          {
            Effect: "Allow",
            Action: [...OSS_MULTIPART_UPLOAD_ACTIONS],
            Resource: [objectArn],
          },
        ],
      };
      const result = await stsClient.assumeRole(
        config.directUpload.stsRoleArn,
        policy,
        expiresSeconds,
        buildSessionName(input.userId, input.objectKey),
      );
      const issuedExpiration = Date.parse(result.credentials.Expiration);
      if (!Number.isFinite(issuedExpiration) || issuedExpiration <= now()) {
        throw new Error("OSS STS returned an invalid expiration");
      }

      return {
        region: config.oss.region,
        bucket: config.oss.bucket,
        endpoint: publicEndpoint,
        accessKeyId: result.credentials.AccessKeyId,
        accessKeySecret: result.credentials.AccessKeySecret,
        securityToken: result.credentials.SecurityToken,
        expiresAt: Math.min(issuedExpiration, now() + expiresSeconds * 1000),
      };
    },

    async head(objectKey) {
      assertSafeObjectKey(objectKey);
      const result = await objectClient.head(objectKey);
      const rawSize = readHeader(result.res.headers, "content-length");
      const size = Number(rawSize);
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error("OSS HeadObject returned an invalid content length");
      }
      const contentType = readHeader(result.res.headers, "content-type");
      return contentType ? { size, contentType } : { size };
    },

    async readPrefix(objectKey, maxBytes) {
      assertSafeObjectKey(objectKey);
      if (
        !Number.isSafeInteger(maxBytes) ||
        maxBytes < 1 ||
        maxBytes > MAX_PREFIX_BYTES
      ) {
        throw new Error(`Prefix size must be between 1 and ${MAX_PREFIX_BYTES}`);
      }
      const result = await objectClient.get(objectKey, {
        headers: { Range: `bytes=0-${maxBytes - 1}` },
      });
      return toUint8Array(result.content);
    },

    async copy(sourceKey, destinationKey) {
      assertSafeObjectKey(sourceKey);
      assertSafeObjectKey(destinationKey);
      await objectClient.copy(destinationKey, sourceKey);
    },

    async delete(objectKey) {
      assertSafeObjectKey(objectKey);
      await objectClient.delete(objectKey);
    },
  };
}
