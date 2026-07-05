import OSS from "ali-oss";
import type { RuntimeConfig } from "../runtimeConfig";
import type { ObjectStorageProvider, StoredObject, UploadObjectInput } from "./types";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function trimLeadingSlash(value: string): string {
  return value.replace(/^\/+/, "");
}

export function createOssStorageProvider(config: RuntimeConfig): ObjectStorageProvider {
  const client = new OSS({
    region: config.oss.region,
    bucket: config.oss.bucket,
    endpoint: config.oss.endpoint,
    accessKeyId: config.oss.accessKeyId,
    accessKeySecret: config.oss.accessKeySecret,
    secure: true,
  });
  const publicBaseUrl = trimTrailingSlash(config.oss.publicBaseUrl);

  function toPublicSignedUrl(signedUrl: string): string {
    const signed = new URL(signedUrl);
    const publicBase = new URL(`${publicBaseUrl}/`);
    return `${publicBase.origin}${signed.pathname}${signed.search}`;
  }

  return {
    async putObject(input: UploadObjectInput): Promise<StoredObject> {
      await client.put(input.storageKey, input.buffer, {
        headers: {
          "Content-Type": input.mimeType,
        },
      });
      const signedUrl = client.signatureUrl(input.storageKey, {
        expires: config.oss.signedUrlTtlSeconds,
        method: "GET",
      });

      return {
        storageProvider: "oss",
        storageKey: input.storageKey,
        publicUrl: `${publicBaseUrl}/${trimLeadingSlash(input.storageKey)}`,
        signedUrl: toPublicSignedUrl(signedUrl),
        sizeBytes: input.buffer.length,
        mimeType: input.mimeType,
        originalName: input.filename,
      };
    },

    async getSignedReadUrl(storageKey: string, options?: { process?: string }): Promise<string> {
      const signedUrl = client.signatureUrl(storageKey, {
        expires: config.oss.signedUrlTtlSeconds,
        method: "GET",
        ...(options?.process ? { process: options.process } : {}),
      });
      return toPublicSignedUrl(signedUrl);
    },

    async deleteObject(storageKey: string): Promise<void> {
      await client.delete(storageKey);
    },
  };
}
