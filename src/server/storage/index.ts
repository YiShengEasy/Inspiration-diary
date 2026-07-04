import type { RuntimeConfig } from "../runtimeConfig";
import crypto from "crypto";
import path from "path";
import { createLocalStorageProvider } from "./localStorage";
import { createOssStorageProvider } from "./ossStorage";
import { storeImageUploadInPhotoPrism, type ImageUploadInput } from "./photoprismStorage";

export type StoredPrimaryImage =
  | {
      storageProvider: "photoprism";
      photoUid: string;
      photoHash: string;
      imageUrl: string;
      thumbnailUrl: string;
    }
  | {
      storageProvider: "oss";
      storageKey: string;
      imageUrl: string;
      thumbnailUrl: string;
      signedUrl: string;
      publicUrl: string;
    };

function rootForPrefixedStorage(rootDir: string, storagePrefix: string): string {
  const normalized = path.normalize(rootDir);
  return path.basename(normalized) === storagePrefix ? path.dirname(normalized) : normalized;
}

function createPrimaryImageStorageKey(image: ImageUploadInput): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const id = crypto.randomBytes(8).toString("hex");
  return `primary-images/${year}/${month}/inspiration-${Date.now()}-${id}.${image.extension}`;
}

export async function storePrimaryImage(config: RuntimeConfig, image: ImageUploadInput): Promise<StoredPrimaryImage> {
  if (config.primaryImageStorageProvider === "oss") {
    const stored = await createOssStorageProvider(config).putObject({
      buffer: image.buffer,
      mimeType: image.mimeType,
      filename: image.filename || `upload.${image.extension}`,
      storageKey: createPrimaryImageStorageKey(image),
    });
    return {
      storageProvider: "oss",
      storageKey: stored.storageKey,
      imageUrl: stored.publicUrl,
      thumbnailUrl: stored.publicUrl,
      signedUrl: stored.signedUrl,
      publicUrl: stored.publicUrl,
    };
  }

  const stored = await storeImageUploadInPhotoPrism(image);
  return {
    storageProvider: "photoprism",
    photoUid: stored.photoUid,
    photoHash: stored.photoHash,
    imageUrl: stored.imageUrl,
    thumbnailUrl: stored.thumbnailUrl,
  };
}

export function createVideoStorage(config: RuntimeConfig) {
  if (config.videoStorageProvider === "oss") {
    return createOssStorageProvider(config);
  }

  return createLocalStorageProvider(rootForPrefixedStorage(config.localStorage.videoUploadRoot, "videos"), "/api/videos");
}

export function createImageAssetStorage(config: RuntimeConfig) {
  if (config.imageAssetStorageProvider === "oss") {
    return createOssStorageProvider(config);
  }

  return createLocalStorageProvider(rootForPrefixedStorage(config.localStorage.imageAssetUploadRoot, "images"), "/api/images");
}
