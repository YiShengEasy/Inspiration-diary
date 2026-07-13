import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import express, { type Express } from "express";

import type { AuthenticatedRequest, AuthUser } from "../src/server/auth.ts";
import {
  createDirectUploadRouter,
  type DirectUploadRouterService,
} from "../src/server/direct-upload/router.ts";
import type { FeatureAudience } from "../src/server/runtimeConfig.ts";

const ADMIN: AuthUser = {
  id: "admin-1",
  email: "admin@example.test",
  displayName: "Admin",
  role: "admin",
};

const MEMBER: AuthUser = {
  id: "user-1",
  email: "user@example.test",
  displayName: "Member",
  role: "user",
};

interface ServiceCall {
  method: "authorize" | "complete" | "get" | "abort";
  user: AuthUser;
  input?: unknown;
}

function createService(overrides: Partial<DirectUploadRouterService> = {}) {
  const calls: ServiceCall[] = [];
  const service: DirectUploadRouterService = {
    async authorize(user, input) {
      calls.push({ method: "authorize", user, input });
      return {
        uploadId: "upload-1",
        objectKey: "pending/user-1/upload-1/photo.jpg",
        expiresAt: 1_784_000_000_000,
        strategy: "signed-put",
        signedPut: {
          url: "https://example.test/signed",
          headers: { "content-type": "image/jpeg" },
        },
      };
    },
    async complete(user, uploadId) {
      calls.push({ method: "complete", user, input: uploadId });
      return { uploadId, status: "finalized" };
    },
    async get(user, uploadId) {
      calls.push({ method: "get", user, input: uploadId });
      return { uploadId, status: "authorized" };
    },
    async abort(user, uploadId) {
      calls.push({ method: "abort", user, input: uploadId });
      return { uploadId, status: "failed" };
    },
    ...overrides,
  };
  return { service, calls };
}

function createApp(input: {
  mode: FeatureAudience;
  service: DirectUploadRouterService;
  user?: AuthUser;
}): Express {
  const app = express();
  app.use(express.json({ strict: false }));
  if (input.user) {
    app.use((req, _res, next) => {
      (req as AuthenticatedRequest).user = input.user;
      next();
    });
  }
  app.use(
    "/api/uploads",
    createDirectUploadRouter({ mode: input.mode, service: input.service }),
  );
  return app;
}

async function requestJson(
  app: Express,
  input: {
    method: "GET" | "POST";
    path: string;
    body?: unknown;
  },
): Promise<{ status: number; body: unknown }> {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}${input.path}`, {
      method: input.method,
      headers: input.body === undefined ? undefined : { "content-type": "application/json" },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("hides disabled and admin-only upload routes without calling the service", async () => {
  const disabled = createService();
  const disabledResponse = await requestJson(
    createApp({ mode: "off", service: disabled.service, user: ADMIN }),
    { method: "GET", path: "/api/uploads/upload-1" },
  );
  assert.equal(disabledResponse.status, 404);
  assert.deepEqual(disabledResponse.body, { error: "接口不存在" });
  assert.equal(disabled.calls.length, 0);

  const adminOnly = createService();
  const memberResponse = await requestJson(
    createApp({ mode: "admin", service: adminOnly.service, user: MEMBER }),
    { method: "GET", path: "/api/uploads/upload-1" },
  );
  assert.equal(memberResponse.status, 404);
  assert.deepEqual(memberResponse.body, { error: "接口不存在" });
  assert.equal(adminOnly.calls.length, 0);
});

test("requires an authenticated request before every enabled upload endpoint", async () => {
  const { service, calls } = createService();
  const app = createApp({ mode: "all", service });
  const requests = [
    requestJson(app, {
      method: "POST",
      path: "/api/uploads/authorize",
      body: {
        mediaKind: "primary_image",
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        size: 42,
      },
    }),
    requestJson(app, { method: "POST", path: "/api/uploads/upload-1/complete" }),
    requestJson(app, { method: "GET", path: "/api/uploads/upload-1" }),
    requestJson(app, { method: "POST", path: "/api/uploads/upload-1/abort" }),
  ];

  for (const response of await Promise.all(requests)) {
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: "未登录" });
  }
  assert.equal(calls.length, 0);
});

test("authorizes a validated upload and forwards only the authenticated user and normalized body", async () => {
  const { service, calls } = createService();
  const response = await requestJson(
    createApp({ mode: "all", service, user: MEMBER }),
    {
      method: "POST",
      path: "/api/uploads/authorize",
      body: {
        mediaKind: "primary_image",
        filename: " portrait.jpg ",
        mimeType: " IMAGE/JPEG ",
        size: 42,
        ignored: "must not reach the service",
      },
    },
  );

  assert.equal(response.status, 201);
  assert.deepEqual(calls, [
    {
      method: "authorize",
      user: MEMBER,
      input: {
        mediaKind: "primary_image",
        filename: "portrait.jpg",
        mimeType: "image/jpeg",
        size: 42,
      },
    },
  ]);
  assert.equal(JSON.stringify(response.body).includes("LONG_TERM"), false);
});

test("rejects malformed authorization JSON before calling the service", async () => {
  const invalidBodies: unknown[] = [
    null,
    [],
    {},
    { mediaKind: "unknown", filename: "photo.jpg", mimeType: "image/jpeg", size: 1 },
    { mediaKind: "primary_image", filename: "", mimeType: "image/jpeg", size: 1 },
    { mediaKind: "primary_image", filename: "photo.jpg", mimeType: "", size: 1 },
    { mediaKind: "primary_image", filename: "photo.jpg", mimeType: "image/jpeg", size: 0 },
    { mediaKind: "primary_image", filename: "photo.jpg", mimeType: "image/jpeg", size: 1.5 },
  ];

  for (const body of invalidBodies) {
    const { service, calls } = createService();
    const response = await requestJson(
      createApp({ mode: "all", service, user: MEMBER }),
      { method: "POST", path: "/api/uploads/authorize", body },
    );
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(response.body, { error: "上传参数无效" });
    assert.equal(calls.length, 0);
  }
});

test("forwards complete, status and abort operations to the service owner", async () => {
  const { service, calls } = createService();
  const app = createApp({ mode: "admin", service, user: ADMIN });

  const completed = await requestJson(app, {
    method: "POST",
    path: "/api/uploads/upload-1/complete",
  });
  const status = await requestJson(app, {
    method: "GET",
    path: "/api/uploads/upload-1",
  });
  const aborted = await requestJson(app, {
    method: "POST",
    path: "/api/uploads/upload-1/abort",
  });

  assert.deepEqual(completed, {
    status: 200,
    body: { uploadId: "upload-1", status: "finalized" },
  });
  assert.deepEqual(status, {
    status: 200,
    body: { uploadId: "upload-1", status: "authorized" },
  });
  assert.deepEqual(aborted, {
    status: 200,
    body: { uploadId: "upload-1", status: "failed" },
  });
  assert.deepEqual(calls, [
    { method: "complete", user: ADMIN, input: "upload-1" },
    { method: "get", user: ADMIN, input: "upload-1" },
    { method: "abort", user: ADMIN, input: "upload-1" },
  ]);
});

test("rejects unsafe upload ids and unexpected command bodies", async () => {
  const { service, calls } = createService();
  const app = createApp({ mode: "all", service, user: MEMBER });

  const unsafeId = await requestJson(app, {
    method: "GET",
    path: "/api/uploads/bad.id",
  });
  const completeBody = await requestJson(app, {
    method: "POST",
    path: "/api/uploads/upload-1/complete",
    body: { objectKey: "pending/another-user/secret.jpg" },
  });
  const abortBody = await requestJson(app, {
    method: "POST",
    path: "/api/uploads/upload-1/abort",
    body: ["unexpected"],
  });

  for (const response of [unsafeId, completeBody, abortBody]) {
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: "上传参数无效" });
  }
  assert.equal(calls.length, 0);
});

test("maps service errors to stable public responses without exposing internal messages", async () => {
  const cases = [
    ["not_found", 404, { error: "上传会话不存在" }],
    ["owner_mismatch", 404, { error: "上传会话不存在" }],
    ["invalid_state", 409, { error: "上传状态冲突" }],
    ["expired", 409, { error: "上传状态冲突" }],
    ["size_exceeded", 413, { error: "上传文件过大" }],
    ["size_mismatch", 413, { error: "上传文件过大" }],
    ["type_mismatch", 415, { error: "上传文件类型无效" }],
    ["signature_mismatch", 415, { error: "上传文件类型无效" }],
    ["unsupported_type", 415, { error: "上传文件类型无效" }],
    ["rate_limited", 429, { error: "上传请求过于频繁" }],
    ["active_limit", 429, { error: "上传请求过于频繁" }],
    ["storage_error", 502, { error: "对象存储暂时不可用" }],
    ["unexpected_database_failure", 500, { error: "上传服务异常" }],
  ] as const;

  for (const [code, expectedStatus, expectedBody] of cases) {
    const error = Object.assign(new Error("LONG_TERM_ACCESS_SECRET=must-not-leak"), { code });
    const { service } = createService({
      async complete() {
        throw error;
      },
    });
    const response = await requestJson(
      createApp({ mode: "all", service, user: MEMBER }),
      { method: "POST", path: "/api/uploads/upload-1/complete" },
    );

    assert.equal(response.status, expectedStatus, code);
    assert.deepEqual(response.body, expectedBody, code);
    assert.equal(JSON.stringify(response.body).includes("LONG_TERM_ACCESS_SECRET"), false);
  }
});
