import type {
  AllowedUploadMimeType,
  SafeUploadExtension,
  UploadAuthorizationRequest,
  UploadCategory,
  UploadMediaKind,
  ValidatedUploadPolicy,
} from "./types.ts";

const MiB = 1024 * 1024;

export const DEFAULT_UPLOAD_SIZE_LIMITS: Readonly<Record<UploadCategory, number>> = {
  image: 25 * MiB,
  document: 20 * MiB,
  video: 100 * MiB,
};

interface MimePolicy {
  category: UploadCategory;
  extension: SafeUploadExtension;
  mimeType: AllowedUploadMimeType;
}

const MIME_POLICIES: Readonly<Record<AllowedUploadMimeType, MimePolicy>> = {
  "image/jpeg": {
    category: "image",
    extension: "jpg",
    mimeType: "image/jpeg",
  },
  "image/png": {
    category: "image",
    extension: "png",
    mimeType: "image/png",
  },
  "image/webp": {
    category: "image",
    extension: "webp",
    mimeType: "image/webp",
  },
  "image/gif": {
    category: "image",
    extension: "gif",
    mimeType: "image/gif",
  },
  "video/mp4": {
    category: "video",
    extension: "mp4",
    mimeType: "video/mp4",
  },
  "video/quicktime": {
    category: "video",
    extension: "mov",
    mimeType: "video/quicktime",
  },
  "video/webm": {
    category: "video",
    extension: "webm",
    mimeType: "video/webm",
  },
  "application/pdf": {
    category: "document",
    extension: "pdf",
    mimeType: "application/pdf",
  },
  "text/markdown": {
    category: "document",
    extension: "md",
    mimeType: "text/markdown",
  },
  "text/plain": {
    category: "document",
    extension: "txt",
    mimeType: "text/plain",
  },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    category: "document",
    extension: "docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
};

const MIME_ALIASES: Readonly<Record<string, AllowedUploadMimeType>> = {
  "image/jpg": "image/jpeg",
  "text/x-markdown": "text/markdown",
  "text/md": "text/markdown",
  "application/markdown": "text/markdown",
};

const MEDIA_KIND_CATEGORIES: Readonly<Record<UploadMediaKind, UploadCategory>> = {
  primary_image: "image",
  image_asset: "image",
  combo_image: "image",
  video: "video",
  combo_video: "video",
  document: "document",
};

const SAFE_EXTENSIONS = new Set<SafeUploadExtension>([
  "jpg",
  "png",
  "webp",
  "gif",
  "mp4",
  "mov",
  "webm",
  "pdf",
  "md",
  "txt",
  "docx",
]);

export type UploadPolicyErrorCode =
  | "invalid_request"
  | "unsupported_type"
  | "media_kind_mismatch"
  | "size_exceeded"
  | "unsafe_key_segment";

export class UploadPolicyError extends Error {
  readonly code: UploadPolicyErrorCode;

  constructor(code: UploadPolicyErrorCode, message: string) {
    super(message);
    this.name = "UploadPolicyError";
    this.code = code;
  }
}

export function normalizeUploadMimeType(
  value: string,
): AllowedUploadMimeType {
  const baseMimeType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const normalized = MIME_ALIASES[baseMimeType] ?? baseMimeType;

  if (!Object.hasOwn(MIME_POLICIES, normalized)) {
    throw new UploadPolicyError(
      "unsupported_type",
      `Unsupported upload MIME type: ${baseMimeType || "(empty)"}`,
    );
  }

  return normalized as AllowedUploadMimeType;
}

export function extensionForMimeType(value: string): SafeUploadExtension {
  return MIME_POLICIES[normalizeUploadMimeType(value)].extension;
}

export function validateUploadRequest(
  request: UploadAuthorizationRequest,
  sizeLimits: Readonly<Record<UploadCategory, number>> = DEFAULT_UPLOAD_SIZE_LIMITS,
): ValidatedUploadPolicy {
  if (
    typeof request.filename !== "string" ||
    request.filename.length === 0 ||
    request.filename.length > 255 ||
    /[\u0000-\u001f\u007f]/u.test(request.filename)
  ) {
    throw new UploadPolicyError("invalid_request", "Invalid upload filename");
  }

  if (!Object.hasOwn(MEDIA_KIND_CATEGORIES, request.mediaKind)) {
    throw new UploadPolicyError("invalid_request", "Invalid media kind");
  }

  if (!Number.isSafeInteger(request.size) || request.size <= 0) {
    throw new UploadPolicyError(
      "invalid_request",
      "Upload size must be a positive safe integer",
    );
  }

  const mimeType = normalizeUploadMimeType(request.mimeType);
  const mimePolicy = MIME_POLICIES[mimeType];
  const expectedCategory = MEDIA_KIND_CATEGORIES[request.mediaKind];

  if (mimePolicy.category !== expectedCategory) {
    throw new UploadPolicyError(
      "media_kind_mismatch",
      `${request.mediaKind} cannot contain ${mimeType}`,
    );
  }

  const maxSize = sizeLimits[expectedCategory];
  if (!Number.isSafeInteger(maxSize) || maxSize <= 0) {
    throw new UploadPolicyError("invalid_request", `Invalid ${expectedCategory} size limit`);
  }
  if (request.size > maxSize) {
    throw new UploadPolicyError(
      "size_exceeded",
      `Upload exceeds the ${maxSize}-byte ${expectedCategory} limit`,
    );
  }

  return {
    category: expectedCategory,
    extension: mimePolicy.extension,
    mimeType,
    maxSize,
  };
}

interface PendingObjectKeyInput {
  userId: string;
  uploadId: string;
  randomId: string;
  extension: SafeUploadExtension;
}

interface FinalObjectKeyInput {
  userId: string;
  uploadId: string;
  mediaKind: UploadMediaKind;
  extension: SafeUploadExtension;
  finalizedAt?: Date;
}

function assertSafeKeySegment(value: string, name: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
    throw new UploadPolicyError(
      "unsafe_key_segment",
      `${name} is not safe for an object key`,
    );
  }
  return value;
}

function assertSafeExtension(
  extension: SafeUploadExtension,
): SafeUploadExtension {
  if (!SAFE_EXTENSIONS.has(extension)) {
    throw new UploadPolicyError(
      "unsafe_key_segment",
      "Unsafe object extension",
    );
  }
  return extension;
}

export function buildPendingObjectKey(input: PendingObjectKeyInput): string {
  const userId = assertSafeKeySegment(input.userId, "userId");
  const uploadId = assertSafeKeySegment(input.uploadId, "uploadId");
  const randomId = assertSafeKeySegment(input.randomId, "randomId");
  const extension = assertSafeExtension(input.extension);
  return `pending/${userId}/${uploadId}/${randomId}.${extension}`;
}

export function buildFinalObjectKey(input: FinalObjectKeyInput): string {
  const userId = assertSafeKeySegment(input.userId, "userId");
  const uploadId = assertSafeKeySegment(input.uploadId, "uploadId");
  const extension = assertSafeExtension(input.extension);

  if (!Object.hasOwn(MEDIA_KIND_CATEGORIES, input.mediaKind)) {
    throw new UploadPolicyError("invalid_request", "Invalid media kind");
  }

  const finalizedAt = input.finalizedAt ?? new Date();
  if (Number.isNaN(finalizedAt.getTime())) {
    throw new UploadPolicyError("invalid_request", "Invalid finalization date");
  }

  const year = finalizedAt.getUTCFullYear().toString().padStart(4, "0");
  const month = (finalizedAt.getUTCMonth() + 1).toString().padStart(2, "0");
  return `media/${userId}/${input.mediaKind}/${year}/${month}/${uploadId}.${extension}`;
}
