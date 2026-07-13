import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createOssDirectUploadGateway,
  OSS_MULTIPART_UPLOAD_ACTIONS,
  type OssGatewayDependencies,
} from "../src/server/direct-upload/ossGateway.ts";
import type { RuntimeConfig } from "../src/server/runtimeConfig.ts";

const NOW = Date.parse("2026-07-13T08:00:00.000Z");

function createConfig(): RuntimeConfig {
  return {
    oss: {
      region: "oss-cn-hangzhou",
      bucket: "private-memory-bucket",
      endpoint: "https://oss-cn-hangzhou-internal.aliyuncs.com",
      accessKeyId: "LONG_TERM_ACCESS_KEY",
      accessKeySecret: "LONG_TERM_ACCESS_SECRET",
      publicBaseUrl: "https://media.example.test",
      signedUrlTtlSeconds: 900,
    },
    directUpload: {
      mode: "all",
      stsRoleArn: "acs:ram::1234567890123456:role/direct-upload",
      authorizationTtlSeconds: 900,
      videoStsTtlSeconds: 900,
      activeSessionsPerUser: 5,
      authorizationsPerMinute: 20,
      maxImageBytes: 25 * 1024 * 1024,
      maxDocumentBytes: 20 * 1024 * 1024,
      maxVideoBytes: 100 * 1024 * 1024,
      maxAnalysisBytes: 5 * 1024 * 1024,
    },
  } as RuntimeConfig;
}

function createDependencies() {
  const signedCalls: unknown[][] = [];
  const assumedRoles: unknown[][] = [];
  const objectCalls: Array<{ method: string; args: unknown[] }> = [];

  const dependencies: OssGatewayDependencies = {
    signer: {
      async signatureUrlV4(...args: unknown[]) {
        signedCalls.push(args);
        return "https://private-memory-bucket.oss-cn-hangzhou.aliyuncs.com/pending/signed";
      },
    },
    stsClient: {
      async assumeRole(...args: unknown[]) {
        assumedRoles.push(args);
        return {
          credentials: {
            AccessKeyId: "TEMP_ACCESS_KEY",
            AccessKeySecret: "TEMP_ACCESS_SECRET",
            SecurityToken: "TEMP_SECURITY_TOKEN",
            Expiration: "2026-07-13T08:15:00.000Z",
          },
        };
      },
    },
    objectClient: {
      async head(...args: unknown[]) {
        objectCalls.push({ method: "head", args });
        return {
          res: {
            headers: {
              "content-length": "42",
              "content-type": "image/jpeg",
            },
          },
        };
      },
      async get(...args: unknown[]) {
        objectCalls.push({ method: "get", args });
        return { content: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) };
      },
      async copy(...args: unknown[]) {
        objectCalls.push({ method: "copy", args });
        return {};
      },
      async delete(...args: unknown[]) {
        objectCalls.push({ method: "delete", args });
        return {};
      },
    },
    now: () => NOW,
  };

  return { dependencies, signedCalls, assumedRoles, objectCalls };
}

test("creates a V4 PUT signature for exactly one object and returns its signed header", async () => {
  const { dependencies, signedCalls } = createDependencies();
  const gateway = createOssDirectUploadGateway(createConfig(), dependencies);
  const objectKey = "pending/user_42/upload-7/object.jpg";

  const result = await gateway.createSignedPut({
    objectKey,
    mimeType: "image/jpeg",
    expiresSeconds: 600,
  });

  assert.deepEqual(signedCalls, [
    ["PUT", 600, { headers: { "content-type": "image/jpeg" } }, objectKey],
  ]);
  assert.deepEqual(result, {
    url: "https://private-memory-bucket.oss-cn-hangzhou.aliyuncs.com/pending/signed",
    headers: { "content-type": "image/jpeg" },
  });
});

test("creates multipart credentials with one-object ARN and official OSS multipart actions", async () => {
  const { dependencies, assumedRoles } = createDependencies();
  const gateway = createOssDirectUploadGateway(createConfig(), dependencies);
  const objectKey = "pending/user_42/upload-7/object.mp4";

  const credentials = await gateway.createMultipartCredentials({
    userId: "user_42",
    objectKey,
    expiresSeconds: 3600,
  });

  assert.equal(assumedRoles.length, 1);
  const [roleArn, policy, duration, sessionName] = assumedRoles[0];
  assert.equal(roleArn, "acs:ram::1234567890123456:role/direct-upload");
  assert.equal(duration, 900);
  assert.match(String(sessionName), /^upload-user_42-/u);
  assert.deepEqual(policy, {
    Version: "1",
    Statement: [
      {
        Effect: "Allow",
        Action: [...OSS_MULTIPART_UPLOAD_ACTIONS],
        Resource: [
          "acs:oss:*:*:private-memory-bucket/pending/user_42/upload-7/object.mp4",
        ],
      },
    ],
  });
  assert.equal(
    JSON.stringify(policy).includes("oss:ListObjects"),
    false,
    "policy must not grant bucket listing",
  );
  assert.deepEqual(OSS_MULTIPART_UPLOAD_ACTIONS, [
    "oss:PutObject",
    "oss:AbortMultipartUpload",
    "oss:ListParts",
  ]);
  assert.deepEqual(credentials, {
    region: "oss-cn-hangzhou",
    bucket: "private-memory-bucket",
    endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
    accessKeyId: "TEMP_ACCESS_KEY",
    accessKeySecret: "TEMP_ACCESS_SECRET",
    securityToken: "TEMP_SECURITY_TOKEN",
    expiresAt: NOW + 900_000,
  });
  assert.equal(
    JSON.stringify(credentials).includes("LONG_TERM_ACCESS_SECRET"),
    false,
    "long-term credentials must never be returned",
  );
});

test("heads, range-reads, copies and deletes exact object keys", async () => {
  const { dependencies, objectCalls } = createDependencies();
  const gateway = createOssDirectUploadGateway(createConfig(), dependencies);

  assert.deepEqual(await gateway.head("pending/user_42/upload-7/object.jpg"), {
    size: 42,
    contentType: "image/jpeg",
  });
  assert.deepEqual(
    await gateway.readPrefix("pending/user_42/upload-7/object.jpg", 4096),
    Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
  );
  await gateway.copy(
    "pending/user_42/upload-7/object.jpg",
    "media/user_42/primary_image/2026/07/upload-7.jpg",
  );
  await gateway.delete("pending/user_42/upload-7/object.jpg");

  assert.deepEqual(objectCalls, [
    {
      method: "head",
      args: ["pending/user_42/upload-7/object.jpg"],
    },
    {
      method: "get",
      args: [
        "pending/user_42/upload-7/object.jpg",
        { headers: { Range: "bytes=0-4095" } },
      ],
    },
    {
      method: "copy",
      args: [
        "media/user_42/primary_image/2026/07/upload-7.jpg",
        "pending/user_42/upload-7/object.jpg",
      ],
    },
    {
      method: "delete",
      args: ["pending/user_42/upload-7/object.jpg"],
    },
  ]);
});

test("rejects wildcard object keys and oversized prefix reads", async () => {
  const { dependencies } = createDependencies();
  const gateway = createOssDirectUploadGateway(createConfig(), dependencies);

  await assert.rejects(
    gateway.createMultipartCredentials({
      userId: "user_42",
      objectKey: "pending/user_42/*",
      expiresSeconds: 900,
    }),
    /unsafe object key/iu,
  );
  await assert.rejects(
    gateway.readPrefix("pending/user_42/upload-7/object.jpg", 16 * 1024 + 1),
    /between 1 and 16384/iu,
  );
});

test("reads a finalized document only through the bounded full-object path", async () => {
  const bytes = Buffer.from("# bounded document");
  const getCalls: unknown[][] = [];
  const { dependencies } = createDependencies();
  dependencies.objectClient = {
    async head() {
      return { res: { headers: { "content-length": String(bytes.length), "content-type": "text/markdown" } } };
    },
    async get(...args: unknown[]) {
      getCalls.push(args);
      return { content: bytes };
    },
    async copy() { return {}; },
    async delete() { return {}; },
  };
  const gateway = createOssDirectUploadGateway(createConfig(), dependencies);

  assert.deepEqual(
    await gateway.readObject("media/user_42/document/2026/07/upload-7.md", 20 * 1024 * 1024),
    Uint8Array.from(bytes),
  );
  assert.deepEqual(getCalls, [[
    "media/user_42/document/2026/07/upload-7.md",
    { headers: { Range: `bytes=0-${20 * 1024 * 1024}` } },
  ]]);
});
