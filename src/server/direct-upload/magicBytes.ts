import {
  normalizeUploadMimeType,
  UploadPolicyError,
} from "./policy.ts";
import type { AllowedUploadMimeType } from "./types.ts";

export const MAX_SIGNATURE_BYTES = 16 * 1024;

export type DetectedFileKind =
  | "jpeg"
  | "png"
  | "webp"
  | "gif"
  | "mp4"
  | "mov"
  | "webm"
  | "pdf"
  | "markdown"
  | "text"
  | "docx"
  | "unsafe";

const MIME_COMPATIBILITY: Readonly<
  Record<AllowedUploadMimeType, ReadonlySet<DetectedFileKind>>
> = {
  "image/jpeg": new Set(["jpeg"]),
  "image/png": new Set(["png"]),
  "image/webp": new Set(["webp"]),
  "image/gif": new Set(["gif"]),
  "video/mp4": new Set(["mp4"]),
  "video/quicktime": new Set(["mov"]),
  "video/webm": new Set(["webm"]),
  "application/pdf": new Set(["pdf"]),
  "text/markdown": new Set(["markdown", "text"]),
  "text/plain": new Set(["text", "markdown"]),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    new Set(["docx"]),
};

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function bytesToAscii(bytes: Uint8Array): string {
  let result = "";
  for (const value of bytes) result += String.fromCharCode(value);
  return result;
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isExecutable(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46]) || // ELF
    startsWith(bytes, [0x4d, 0x5a]) || // Windows PE
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xce]) || // Mach-O 32-bit
    startsWith(bytes, [0xce, 0xfa, 0xed, 0xfe]) ||
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xcf]) || // Mach-O 64-bit
    startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe]) // fat Mach-O / Java class
  );
}

function detectIsoBmff(bytes: Uint8Array): "mp4" | "mov" | null {
  if (
    bytes.length < 12 ||
    bytes[4] !== 0x66 ||
    bytes[5] !== 0x74 ||
    bytes[6] !== 0x79 ||
    bytes[7] !== 0x70
  ) {
    return null;
  }

  const brand = bytesToAscii(bytes.subarray(8, 12));
  if (brand === "qt  ") return "mov";

  const mp4Brands = new Set([
    "avc1",
    "dash",
    "iso2",
    "iso3",
    "iso4",
    "iso5",
    "iso6",
    "isom",
    "M4V ",
    "M4VH",
    "M4VP",
    "mp41",
    "mp42",
    "mp71",
    "MSNV",
  ]);
  return mp4Brands.has(brand) ? "mp4" : null;
}

function looksLikeUnsafeText(text: string): boolean {
  const start = text.replace(/^\uFEFF/u, "").trimStart().slice(0, 2048);
  return (
    /^(?:<\?xml[^>]*>\s*)?<svg\b/iu.test(start) ||
    /^(?:<!doctype\s+html\b|<html\b|<head\b|<body\b|<script\b)/iu.test(
      start,
    ) ||
    /^#!\s*\/?(?:usr\/bin\/env\s+)?(?:ba|z|c|k)?sh\b/iu.test(start) ||
    /^#!\s*\/?(?:usr\/bin\/env\s+)?(?:node|deno|python\d*|ruby|perl|php)\b/iu.test(
      start,
    ) ||
    /^(?:(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|(?:async\s+)?function\s+[A-Za-z_$]|import\s+.+\s+from\s+|export\s+(?:default|const|let|var|function|class)\b|require\s*\(|process\.)/u.test(
      start,
    ) ||
    /^(?:<\?php\b|@echo\s+off\b|\$ErrorActionPreference\b|from\s+\S+\s+import\s+|import\s+(?:os|sys|subprocess|pathlib)\b)/iu.test(
      start,
    )
  );
}

function looksLikeMarkdown(text: string): boolean {
  return (
    /^(?:---\s*$[\s\S]*?^---\s*$|#{1,6}\s+|>\s+|[-*+]\s+|\d+[.)]\s+)/mu.test(
      text,
    ) ||
    /(?:```|~~~|\[\[[^\]]+\]\]|\[[^\]]+\]\([^\s)]+\)|!\[[^\]]*\]\([^\s)]+\))/u.test(
      text,
    )
  );
}

function isReasonableText(text: string): boolean {
  if (text.length === 0 || text.includes("\u0000")) return false;

  let disallowedControls = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 && char !== "\n" && char !== "\r" && char !== "\t") {
      disallowedControls += 1;
    }
  }
  return disallowedControls / text.length < 0.01;
}

export function detectFileKind(input: Uint8Array): DetectedFileKind {
  const bytes = input.subarray(0, MAX_SIGNATURE_BYTES);
  if (bytes.length === 0 || isExecutable(bytes)) return "unsafe";

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytesToAscii(bytes.subarray(0, 4)) === "RIFF" &&
    bytesToAscii(bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  if (
    bytesToAscii(bytes.subarray(0, 6)) === "GIF87a" ||
    bytesToAscii(bytes.subarray(0, 6)) === "GIF89a"
  ) {
    return "gif";
  }

  const isoBmff = detectIsoBmff(bytes);
  if (isoBmff) return isoBmff;

  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return bytesToAscii(bytes).toLowerCase().includes("webm")
      ? "webm"
      : "unsafe";
  }
  if (bytesToAscii(bytes.subarray(0, 5)) === "%PDF-") return "pdf";

  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const archiveHeader = bytesToAscii(bytes);
    return archiveHeader.includes("[Content_Types].xml") &&
      archiveHeader.includes("word/")
      ? "docx"
      : "unsafe";
  }

  const text = decodeUtf8(bytes);
  if (!text || !isReasonableText(text) || looksLikeUnsafeText(text)) {
    return "unsafe";
  }
  return looksLikeMarkdown(text) ? "markdown" : "text";
}

export function isDetectedKindCompatible(
  kind: DetectedFileKind,
  declaredMimeType: string,
): boolean {
  if (kind === "unsafe") return false;
  try {
    return MIME_COMPATIBILITY[normalizeUploadMimeType(declaredMimeType)].has(
      kind,
    );
  } catch (error) {
    if (error instanceof UploadPolicyError) return false;
    throw error;
  }
}
