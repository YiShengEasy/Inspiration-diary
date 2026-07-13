import assert from "node:assert/strict";
import test from "node:test";

import {
  claimBusinessUpload,
  DirectUploadBusinessClaimError,
} from "../src/server/direct-upload/businessClaims.ts";
import type { DirectUploadService } from "../src/server/direct-upload/service.ts";
import type { UploadSession } from "../src/server/direct-upload/types.ts";

function upload(overrides: Partial<UploadSession> = {}): UploadSession {
  return {
    id: "upload-1",
    userId: "user-1",
    mediaKind: "image_asset",
    originalName: "photo.jpg",
    declaredMimeType: "image/jpeg",
    declaredSize: 123,
    pendingObjectKey: "pending/user-1/upload-1/photo.jpg",
    finalObjectKey: "media/user-1/image_asset/2026/07/upload-1.jpg",
    status: "finalized",
    expiresAt: Date.now() + 60_000,
    claimedAt: null,
    failureCode: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function fakeClient(log: string[]) {
  return {
    query: async (sql: string) => {
      log.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release: () => log.push("RELEASE"),
  } as any;
}

test("claims the upload and business row in one transaction", async () => {
  const log: string[] = [];
  const client = fakeClient(log);
  const service = {
    claim: async (_client: unknown, _user: unknown, _uploadId: string, writer: any) => ({
      created: true,
      value: await writer(client, upload()),
      session: {
        uploadId: "upload-1",
        mediaKind: "image_asset",
        mimeType: "image/jpeg",
        size: 123,
        status: "claimed",
        expiresAt: Date.now() + 60_000,
        finalObjectKey: "media/user-1/image_asset/2026/07/upload-1.jpg",
      },
    }),
  } as Pick<DirectUploadService, "claim">;

  const result = await claimBusinessUpload({
    pool: { connect: async () => client },
    service,
    user: { id: "user-1" },
    uploadId: "upload-1",
    expectedKinds: ["image_asset"],
    write: async () => ({ id: "image-upload-1" }),
    readExisting: async () => null,
  });

  assert.equal(result.value.id, "image-upload-1");
  assert.deepEqual(log, ["BEGIN", "COMMIT", "RELEASE"]);
});

test("rejects wrong media kinds and protects repeated claims", async () => {
  const wrongKindLog: string[] = [];
  const wrongKindClient = fakeClient(wrongKindLog);
  const wrongKindService = {
    claim: async (_client: unknown, _user: unknown, _uploadId: string, writer: any) =>
      writer(wrongKindClient, upload({ mediaKind: "video" })),
  } as Pick<DirectUploadService, "claim">;

  await assert.rejects(
    claimBusinessUpload({
      pool: { connect: async () => wrongKindClient },
      service: wrongKindService,
      user: { id: "user-1" },
      uploadId: "upload-1",
      expectedKinds: ["image_asset"],
      write: async () => ({ id: "should-not-exist" }),
      readExisting: async () => null,
    }),
    (error: unknown) =>
      error instanceof DirectUploadBusinessClaimError &&
      error.code === "media_kind_mismatch",
  );
  assert.deepEqual(wrongKindLog, ["BEGIN", "ROLLBACK", "RELEASE"]);

  const retryLog: string[] = [];
  const retryClient = fakeClient(retryLog);
  const retryService = {
    claim: async () => ({
      created: false,
      session: {
        uploadId: "upload-1",
        mediaKind: "image_asset",
        mimeType: "image/jpeg",
        size: 123,
        status: "claimed",
        expiresAt: Date.now() + 60_000,
        finalObjectKey: "media/user-1/image_asset/2026/07/upload-1.jpg",
      },
    }),
  } as Pick<DirectUploadService, "claim">;
  const retried = await claimBusinessUpload({
    pool: { connect: async () => retryClient },
    service: retryService,
    user: { id: "user-1" },
    uploadId: "upload-1",
    expectedKinds: ["image_asset"],
    write: async () => ({ id: "unexpected" }),
    readExisting: async (_client, session) =>
      session.finalObjectKey?.includes("upload-1") ? { id: "image-upload-1" } : null,
  });
  assert.equal(retried.created, false);
  assert.equal(retried.value.id, "image-upload-1");
  assert.deepEqual(retryLog, ["BEGIN", "COMMIT", "RELEASE"]);
});
