export interface UploadObjectInput {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  storageKey: string;
}

export interface StoredObject {
  storageProvider: string;
  storageKey: string;
  publicUrl: string;
  signedUrl: string;
  sizeBytes: number;
  mimeType: string;
  originalName: string;
}

export interface ObjectStorageProvider {
  putObject(input: UploadObjectInput): Promise<StoredObject>;
  getSignedReadUrl(storageKey: string, options?: { process?: string }): Promise<string>;
  deleteObject(storageKey: string): Promise<void>;
}
