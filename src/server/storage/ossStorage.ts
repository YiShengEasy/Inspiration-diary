import OSS from "ali-oss";
import type { RuntimeConfig } from "../runtimeConfig";
import type { ObjectStorageProvider, StoredObject, UploadObjectInput } from "./types";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function trimLeadingSlash(value: string): string {
  return value.replace(/^\/+/, "");
}

function getPublicEndpoint(endpoint: string): string {
  return endpoint.replace("-internal.", ".");
}

export function createOssStorageProvider(config: RuntimeConfig): ObjectStorageProvider {
  const writeClient = new OSS({
    region: config.oss.region,
    bucket: config.oss.bucket,
    endpoint: config.oss.endpoint,
    accessKeyId: config.oss.accessKeyId,
    accessKeySecret: config.oss.accessKeySecret,
    secure: true,
  });
  const readClient = new OSS({
    region: config.oss.region,
    bucket: config.oss.bucket,
    endpoint: getPublicEndpoint(config.oss.endpoint),
    accessKeyId: config.oss.accessKeyId,
    accessKeySecret: config.oss.accessKeySecret,
    secure: true,
  });
  const publicBaseUrl = trimTrailingSlash(config.oss.publicBaseUrl);

  return {
    async putObject(input: UploadObjectInput): Promise<StoredObject> {
      await writeClient.put(input.storageKey, input.buffer, {
        headers: {
          "Content-Type": input.mimeType,
        },
      });
      const signedUrl = readClient.signatureUrl(input.storageKey, {
        expires: config.oss.signedUrlTtlSeconds,
        method: "GET",
      });

      return {
        storageProvider: "oss",
        storageKey: input.storageKey,
        publicUrl: `${publicBaseUrl}/${trimLeadingSlash(input.storageKey)}`,
        signedUrl,
        sizeBytes: input.buffer.length,
        mimeType: input.mimeType,
        originalName: input.filename,
      };
    },

    async getSignedReadUrl(storageKey: string, options?: { process?: string }): Promise<string> {
      return readClient.signatureUrl(storageKey, {
        expires: config.oss.signedUrlTtlSeconds,
        method: "GET",
        ...(options?.process ? { process: options.process } : {}),
      });
    },

    async deleteObject(storageKey: string): Promise<void> {
      await writeClient.delete(storageKey);
    },
  };
}
