import assert from "node:assert/strict";
import test from "node:test";

import {
  createDirectUploadClient,
  DirectUploadUnavailableError,
  isDirectUploadUnavailable,
  type MultipartUploadClient,
} from "../src/lib/directUploadClient.ts";

function makeFile(contents: string, name: string, type: string): File {
  return Object.assign(new Blob([contents], { type }), {
    name,
    lastModified: 0,
  }) as File;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("uploads a signed PUT with the exact grant headers and completes it", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const progress: number[] = [];
  const client = createDirectUploadClient({
    fetch: async (input, init) => {
      calls.push({ input: String(input), init });
      if (String(input) === "/api/uploads/authorize") {
        return jsonResponse({
          uploadId: "upload-1",
          objectKey: "pending/user/upload-1/photo.jpg",
          expiresAt: Date.now() + 60_000,
          strategy: "signed-put",
          signedPut: {
            url: "https://oss.example/signed-object",
            headers: {
              "Content-Type": "image/jpeg",
              "x-oss-forbid-overwrite": "true",
            },
          },
        }, 201);
      }
      if (String(input) === "https://oss.example/signed-object") {
        return new Response(null, { status: 200 });
      }
      return jsonResponse({
        uploadId: "upload-1",
        status: "finalized",
        finalObjectKey: "media/user/primary_image/2026/07/upload-1.jpg",
      });
    },
  });
  const file = makeFile("jpeg", "photo.jpg", "image/jpeg");

  const result = await client.uploadDirect(file, "primary_image", {
    onProgress: (ratio) => progress.push(ratio),
  });

  assert.deepEqual(result, {
    uploadId: "upload-1",
    finalObjectKey: "media/user/primary_image/2026/07/upload-1.jpg",
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].init?.method, "PUT");
  assert.equal(calls[1].init?.credentials, "omit");
  assert.deepEqual(calls[1].init?.headers, {
    "Content-Type": "image/jpeg",
    "x-oss-forbid-overwrite": "true",
  });
  assert.equal(calls[1].init?.body, file);
  assert.deepEqual(progress, [0, 0.98, 1]);
});

test("uses bounded multipart settings, reports progress, and cancels on AbortSignal", async () => {
  const controller = new AbortController();
  const progress: number[] = [];
  const calls: string[] = [];
  let cancelUpload: (() => void) | undefined;
  let receivedOptions: Record<string, unknown> | undefined;
  const multipartClient: MultipartUploadClient = {
    multipartUpload: async (_key, _file, options) => {
      receivedOptions = options;
      options.progress(0.5);
      return new Promise((_resolve, reject) => {
        cancelUpload = () => reject(new Error("cancelled by SDK"));
      });
    },
    cancel: () => cancelUpload?.(),
  };
  const client = createDirectUploadClient({
    fetch: async (input) => {
      calls.push(String(input));
      if (String(input) === "/api/uploads/authorize") {
        return jsonResponse({
          uploadId: "upload-video",
          objectKey: "pending/user/upload-video/movie.mp4",
          expiresAt: Date.now() + 60_000,
          strategy: "sts-multipart",
          sts: {
            region: "oss-cn-hangzhou",
            bucket: "private-bucket",
            endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
            accessKeyId: "temporary-id",
            accessKeySecret: "temporary-secret",
            securityToken: "temporary-token",
          },
        }, 201);
      }
      return jsonResponse({ uploadId: "upload-video", status: "failed" });
    },
    createMultipartClient: () => multipartClient,
  });

  const pending = client.uploadDirect(
    makeFile("video", "movie.mp4", "video/mp4"),
    "video",
    { signal: controller.signal, onProgress: (ratio) => progress.push(ratio) },
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  controller.abort();

  await assert.rejects(pending, (error: unknown) => {
    assert.equal((error as Error).name, "AbortError");
    return true;
  });
  assert.equal(receivedOptions?.parallel, 3);
  assert.equal(receivedOptions?.partSize, 1_048_576);
  assert.deepEqual(progress, [0, 0.49]);
  assert.deepEqual(calls, [
    "/api/uploads/authorize",
    "/api/uploads/upload-video/abort",
  ]);
});

test("surfaces authorize 404 as the explicit legacy-fallback signal", async () => {
  let requestCount = 0;
  const client = createDirectUploadClient({
    fetch: async () => {
      requestCount += 1;
      return jsonResponse({ error: "接口不存在" }, 404);
    },
  });

  await assert.rejects(
    client.uploadDirect(
      makeFile("jpeg", "photo.jpg", "image/jpeg"),
      "primary_image",
    ),
    (error: unknown) => {
      assert.ok(error instanceof DirectUploadUnavailableError);
      assert.equal(isDirectUploadUnavailable(error), true);
      return true;
    },
  );
  assert.equal(requestCount, 1);
});
