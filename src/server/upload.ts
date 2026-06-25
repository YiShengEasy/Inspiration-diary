import type { Request } from "express";

export interface NormalizedImageUpload {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  extension: string;
  dataUrl: string;
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "jpg";
}

function baseNameWithoutExtension(filename: string): string {
  return filename.replace(/\.[a-z0-9]+$/i, "") || "upload";
}

function normalizeDataUrl(dataUrl: string, fallbackName = "upload"): NormalizedImageUpload {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image data URL.");
  }

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  const extension = extensionFromMimeType(mimeType);
  return {
    buffer,
    mimeType,
    extension,
    filename: `${baseNameWithoutExtension(fallbackName)}.${extension}`,
    dataUrl,
  };
}

function normalizeBase64(rawBase64: string, mimeType = "image/png", fallbackName = "upload"): NormalizedImageUpload {
  const dataUrl = rawBase64.startsWith("data:")
    ? rawBase64
    : `data:${mimeType};base64,${rawBase64}`;
  return normalizeDataUrl(dataUrl, fallbackName);
}

export function normalizeImageUpload(req: Request): NormalizedImageUpload {
  const file = req.file as Express.Multer.File | undefined;
  if (file) {
    const mimeType = file.mimetype || "application/octet-stream";
    const extension = extensionFromMimeType(mimeType);
    const filename = file.originalname || `upload.${extension}`;
    return {
      buffer: file.buffer,
      mimeType,
      extension,
      filename,
      dataUrl: `data:${mimeType};base64,${file.buffer.toString("base64")}`,
    };
  }

  const body = req.body as { imageBase64?: string; mimeType?: string; filename?: string };
  if (body.imageBase64) {
    return normalizeBase64(body.imageBase64, body.mimeType || "image/png", body.filename || "upload");
  }

  throw new Error("Missing image upload. Send multipart field \"image\" or JSON field \"imageBase64\".");
}
