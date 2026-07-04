import fs from "fs/promises";
import path from "path";
import type { ObjectStorageProvider, StoredObject, UploadObjectInput } from "./types";

export function createLocalStorageProvider(rootDir: string, publicPathPrefix: string): ObjectStorageProvider {
  function resolvePath(storageKey: string): string {
    const normalized = path.normalize(storageKey).replace(/^(\.\.(\/|\\|$))+/, "");
    return path.join(rootDir, normalized);
  }

  function buildPublicUrl(storageKey: string): string {
    return `${publicPathPrefix}/${encodeURIComponent(storageKey)}`;
  }

  return {
    async putObject(input: UploadObjectInput): Promise<StoredObject> {
      const localPath = resolvePath(input.storageKey);
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, input.buffer);

      return {
        storageProvider: "local",
        storageKey: input.storageKey,
        publicUrl: buildPublicUrl(input.storageKey),
        signedUrl: buildPublicUrl(input.storageKey),
        sizeBytes: input.buffer.length,
        mimeType: input.mimeType,
        originalName: input.filename,
      };
    },

    async getSignedReadUrl(storageKey: string): Promise<string> {
      return buildPublicUrl(storageKey);
    },

    async deleteObject(storageKey: string): Promise<void> {
      await fs.unlink(resolvePath(storageKey)).catch(() => undefined);
    },
  };
}
