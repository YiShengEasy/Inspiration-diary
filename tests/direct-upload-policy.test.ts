import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildFinalObjectKey,
  buildPendingObjectKey,
  extensionForMimeType,
  UploadPolicyError,
  validateUploadRequest,
} from "../src/server/direct-upload/policy.ts";
import {
  detectFileKind,
  isDetectedKindCompatible,
} from "../src/server/direct-upload/magicBytes.ts";
import {
  canTransition,
  isIdempotentTransition,
} from "../src/server/direct-upload/stateMachine.ts";

const MiB = 1024 * 1024;

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

test("normalizes aliases to a server-controlled safe extension", () => {
  assert.equal(extensionForMimeType("image/jpg"), "jpg");
  assert.equal(extensionForMimeType("image/jpeg; charset=binary"), "jpg");
  assert.equal(extensionForMimeType("video/quicktime"), "mov");
  assert.equal(extensionForMimeType("text/x-markdown"), "md");
  assert.equal(
    extensionForMimeType(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    "docx",
  );

  assert.throws(
    () => extensionForMimeType("image/svg+xml"),
    (error: unknown) =>
      error instanceof UploadPolicyError && error.code === "unsupported_type",
  );
  assert.throws(() => extensionForMimeType("text/html"), UploadPolicyError);
  assert.throws(
    () => extensionForMimeType("application/javascript"),
    UploadPolicyError,
  );
  assert.throws(
    () => extensionForMimeType("application/x-msdownload"),
    UploadPolicyError,
  );
});

test("validates media-kind MIME compatibility and exact size limits", () => {
  const image = validateUploadRequest({
    mediaKind: "primary_image",
    filename: "../../portrait.svg.exe",
    mimeType: "image/jpeg",
    size: 25 * MiB,
  });
  assert.equal(image.extension, "jpg");
  assert.equal(image.mimeType, "image/jpeg");
  assert.equal(image.category, "image");

  const document = validateUploadRequest({
    mediaKind: "document",
    filename: "notes.md",
    mimeType: "text/markdown",
    size: 20 * MiB,
  });
  assert.equal(document.extension, "md");

  const video = validateUploadRequest({
    mediaKind: "combo_video",
    filename: "memory.mov",
    mimeType: "video/quicktime",
    size: 100 * MiB,
  });
  assert.equal(video.extension, "mov");

  assert.throws(
    () =>
      validateUploadRequest({
        mediaKind: "primary_image",
        filename: "too-large.jpg",
        mimeType: "image/jpeg",
        size: 25 * MiB + 1,
      }),
    (error: unknown) =>
      error instanceof UploadPolicyError && error.code === "size_exceeded",
  );
  assert.throws(
    () =>
      validateUploadRequest({
        mediaKind: "video",
        filename: "wrong.pdf",
        mimeType: "application/pdf",
        size: 100,
      }),
    (error: unknown) =>
      error instanceof UploadPolicyError && error.code === "media_kind_mismatch",
  );
  assert.throws(
    () =>
      validateUploadRequest({
        mediaKind: "document",
        filename: "empty.txt",
        mimeType: "text/plain",
        size: 0,
      }),
    UploadPolicyError,
  );
});

test("uses runtime-provided size limits instead of hard-coded service limits", () => {
  assert.throws(
    () =>
      validateUploadRequest(
        {
          mediaKind: "primary_image",
          filename: "portrait.jpg",
          mimeType: "image/jpeg",
          size: 2_001,
        },
        { image: 2_000, document: 3_000, video: 4_000 },
      ),
    (error: unknown) => error instanceof UploadPolicyError && error.code === "size_exceeded",
  );
});

test("builds object keys only from validated server values", () => {
  assert.equal(
    buildPendingObjectKey({
      userId: "user_42",
      uploadId: "upload-7",
      randomId: "550e8400-e29b-41d4-a716-446655440000",
      extension: "jpg",
    }),
    "pending/user_42/upload-7/550e8400-e29b-41d4-a716-446655440000.jpg",
  );
  assert.equal(
    buildFinalObjectKey({
      userId: "user_42",
      uploadId: "upload-7",
      mediaKind: "primary_image",
      extension: "jpg",
      finalizedAt: new Date("2026-07-13T23:30:00-08:00"),
    }),
    "media/user_42/primary_image/2026/07/upload-7.jpg",
  );

  assert.throws(
    () =>
      buildPendingObjectKey({
        userId: "../other-user",
        uploadId: "upload-7",
        randomId: "550e8400-e29b-41d4-a716-446655440000",
        extension: "jpg",
      }),
    UploadPolicyError,
  );
  assert.throws(
    () =>
      buildFinalObjectKey({
        userId: "user_42",
        uploadId: "upload-7",
        mediaKind: "primary_image",
        extension: "html" as "jpg",
        finalizedAt: new Date("2026-07-13T00:00:00Z"),
      }),
    UploadPolicyError,
  );
});

test("permits only the approved upload state graph and idempotent reads", () => {
  assert.equal(canTransition("authorized", "uploaded"), true);
  assert.equal(canTransition("uploaded", "finalized"), true);
  assert.equal(canTransition("finalized", "claimed"), true);

  for (const from of ["authorized", "uploaded", "finalized"] as const) {
    assert.equal(canTransition(from, "failed"), true);
    assert.equal(canTransition(from, "expired"), true);
  }

  assert.equal(canTransition("authorized", "finalized"), false);
  assert.equal(canTransition("failed", "uploaded"), false);
  assert.equal(canTransition("expired", "authorized"), false);
  assert.equal(canTransition("claimed", "failed"), false);

  assert.equal(canTransition("finalized", "finalized"), true);
  assert.equal(canTransition("claimed", "claimed"), true);
  assert.equal(isIdempotentTransition("finalized", "finalized"), true);
  assert.equal(isIdempotentTransition("claimed", "claimed"), true);
  assert.equal(isIdempotentTransition("uploaded", "uploaded"), false);
});

test("detects the supported binary signatures from at most 16 KiB", () => {
  const fixtures: Array<[string, Uint8Array]> = [
    ["jpeg", bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10)],
    ["png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    ["webp", ascii("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ")],
    ["gif", ascii("GIF89a")],
    ["mp4", bytes(0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d)],
    ["mov", bytes(0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20)],
    ["webm", Uint8Array.from([...bytes(0x1a, 0x45, 0xdf, 0xa3), ...ascii("webm")])],
    ["pdf", ascii("%PDF-1.7\n")],
    ["docx", ascii("PK\u0003\u0004[Content_Types].xml word/document.xml")],
    ["markdown", ascii("# Memory\n\n- [[Summer]]\n")],
    ["text", ascii("A plain UTF-8 note.\nSecond line.\n")],
  ];

  for (const [expected, fixture] of fixtures) {
    assert.equal(detectFileKind(fixture), expected, expected);
  }

  const oversized = new Uint8Array(20 * 1024).fill(0x41);
  oversized.set(ascii("<html><script>alert(1)</script></html>"), 17 * 1024);
  assert.equal(detectFileKind(oversized), "text");
});

test("rejects SVG, HTML, scripts, executables and unknown archives", () => {
  const unsafe = [
    ascii("<?xml version=\"1.0\"?><svg><script>alert(1)</script></svg>"),
    ascii("<!doctype html><html><body>bad</body></html>"),
    ascii("#!/usr/bin/env node\nprocess.exit(1)"),
    ascii("const childProcess = require('node:child_process');"),
    ascii("from pathlib import Path\nPath('/tmp/payload').write_text('x')"),
    bytes(0x7f, 0x45, 0x4c, 0x46),
    bytes(0x4d, 0x5a, 0x90, 0x00),
    bytes(0xcf, 0xfa, 0xed, 0xfe),
    ascii("PK\u0003\u0004payload.bin"),
  ];

  for (const fixture of unsafe) {
    assert.equal(detectFileKind(fixture), "unsafe");
  }
});

test("matches detected content to the declared safe MIME type", () => {
  assert.equal(isDetectedKindCompatible("jpeg", "image/jpeg"), true);
  assert.equal(isDetectedKindCompatible("mov", "video/quicktime"), true);
  assert.equal(isDetectedKindCompatible("markdown", "text/markdown"), true);
  assert.equal(isDetectedKindCompatible("text", "text/markdown"), true);
  assert.equal(isDetectedKindCompatible("markdown", "text/plain"), true);
  assert.equal(
    isDetectedKindCompatible(
      "docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    true,
  );
  assert.equal(isDetectedKindCompatible("png", "image/jpeg"), false);
  assert.equal(isDetectedKindCompatible("unsafe", "text/plain"), false);
});
