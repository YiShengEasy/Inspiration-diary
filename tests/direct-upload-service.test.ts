import assert from "node:assert/strict";
import { test } from "node:test";

import type pg from "pg";

import type { DirectUploadGateway } from "../src/server/direct-upload/ossGateway.ts";
import { assertAuthorizationCapacity } from "../src/server/direct-upload/rateLimit.ts";
import {
  createDirectUploadService,
  DirectUploadServiceError,
} from "../src/server/direct-upload/service.ts";
import type {
  ClaimWriter,
  UploadAuthorizationRequest,
  UploadRepositoryClient,
  UploadSession,
  UploadSessionRepository,
} from "../src/server/direct-upload/types.ts";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);

function session(overrides: Partial<UploadSession> = {}): UploadSession {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "user-a",
    mediaKind: "primary_image",
    originalName: "portrait.jpg",
    declaredMimeType: "image/jpeg",
    declaredSize: JPEG.byteLength,
    pendingObjectKey:
      "pending/user-a/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg",
    finalObjectKey: null,
    status: "authorized",
    expiresAt: 1_900_000,
    claimedAt: null,
    failureCode: null,
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    ...overrides,
  };
}

class FakeRepository implements UploadSessionRepository {
  readonly sessions = new Map<string, UploadSession>();
  activeCount = 0;
  recentCount = 0;

  async reserveAuthorized(input: Parameters<UploadSessionRepository["reserveAuthorized"]>[0]) {
    if (this.activeCount >= input.activeLimit) {
      throw new DirectUploadServiceError("active_limit", "too many active uploads", 429);
    }
    if (this.recentCount >= input.rateLimit) {
      throw new DirectUploadServiceError("rate_limited", "too many authorizations", 429);
    }
    const created = session({
      id: input.id,
      userId: input.userId,
      mediaKind: input.mediaKind,
      originalName: input.originalName,
      declaredMimeType: input.declaredMimeType,
      declaredSize: input.declaredSize,
      pendingObjectKey: input.pendingObjectKey,
      expiresAt: input.expiresAt,
      createdAt: input.now,
      updatedAt: input.now,
    });
    this.sessions.set(created.id, created);
    this.activeCount += 1;
    this.recentCount += 1;
    return created;
  }

  async getForOwner(uploadId: string, userId: string) {
    const found = this.sessions.get(uploadId);
    return found?.userId === userId ? found : null;
  }

  async withLockedForOwner<T>(
    uploadId: string,
    userId: string,
    operation: (client: UploadRepositoryClient, upload: UploadSession | null) => Promise<T>,
  ) {
    const found = await this.getForOwner(uploadId, userId);
    return operation({ query: async () => ({ rows: [], rowCount: 0 }) }, found);
  }

  async getLockedForOwner(_client: UploadRepositoryClient, uploadId: string, userId: string) {
    return this.getForOwner(uploadId, userId);
  }

  async updateStatus(
    _client: UploadRepositoryClient,
    input: Parameters<UploadSessionRepository["updateStatus"]>[1],
  ) {
    const current = this.sessions.get(input.uploadId);
    if (!current || current.userId !== input.userId) return null;
    const updated: UploadSession = {
      ...current,
      status: input.status,
      finalObjectKey:
        input.finalObjectKey === undefined
          ? current.finalObjectKey
          : input.finalObjectKey,
      failureCode:
        input.failureCode === undefined ? current.failureCode : input.failureCode,
      claimedAt:
        input.claimedAt === undefined ? current.claimedAt : input.claimedAt,
      updatedAt: input.now,
    };
    this.sessions.set(updated.id, updated);
    return updated;
  }

  async markFailed(uploadId: string, userId: string, failureCode: string, now: number) {
    const found = await this.getForOwner(uploadId, userId);
    if (!found) return null;
    const failed = { ...found, status: "failed" as const, failureCode, updatedAt: now };
    this.sessions.set(uploadId, failed);
    return failed;
  }
}

function fakeGateway(overrides: Partial<DirectUploadGateway> = {}): DirectUploadGateway {
  return {
    async createSignedPut(input) {
      return {
        url: `https://upload.example/${input.objectKey}`,
        headers: { "content-type": input.mimeType },
      };
    },
    async createMultipartCredentials() {
      return {
        region: "oss-cn-test",
        bucket: "private-bucket",
        endpoint: "https://oss-cn-test.aliyuncs.com",
        accessKeyId: "temporary-id",
        accessKeySecret: "temporary-secret",
        securityToken: "temporary-token",
        expiresAt: 1_900_000,
      };
    },
    async head() {
      return { size: JPEG.byteLength, contentType: "image/jpeg" };
    },
    async readPrefix(_key, maxBytes) {
      return JPEG.subarray(0, maxBytes);
    },
    async readObject(_key, maxBytes) {
      return JPEG.subarray(0, maxBytes);
    },
    async copy() {},
    async delete() {},
    ...overrides,
  };
}

const request: UploadAuthorizationRequest = {
  mediaKind: "primary_image",
  filename: "portrait.jpg",
  mimeType: "image/jpeg",
  size: JPEG.byteLength,
};

function createFixture(
  repository = new FakeRepository(),
  gateway = fakeGateway(),
) {
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  return {
    repository,
    gateway,
    service: createDirectUploadService({
      repository,
      gateway,
      now: () => 1_000_000,
      uuid: () => ids.shift() ?? "33333333-3333-4333-8333-333333333333",
      config: {
        authorizationTtlSeconds: 900,
        videoStsTtlSeconds: 900,
        activeSessionsPerUser: 5,
        authorizationsPerMinute: 20,
        maxImageBytes: 25 * 1024 * 1024,
        maxDocumentBytes: 20 * 1024 * 1024,
        maxVideoBytes: 100 * 1024 * 1024,
      },
    }),
  };
}

async function expectServiceError(
  operation: Promise<unknown>,
  code: DirectUploadServiceError["code"],
) {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof DirectUploadServiceError);
    assert.equal(error.code, code);
    return true;
  });
}

test("authorize reserves a database session before returning a signed PUT", async () => {
  const { service, repository } = createFixture();
  const grant = await service.authorize({ id: "user-a" }, request);

  assert.equal(grant.uploadId, "11111111-1111-4111-8111-111111111111");
  assert.equal(grant.strategy, "signed-put");
  assert.match(grant.objectKey, /^pending\/user-a\//u);
  assert.equal(repository.sessions.get(grant.uploadId)?.status, "authorized");
});

test("video authorization returns path-scoped temporary multipart credentials", async () => {
  const { service } = createFixture();
  const grant = await service.authorize(
    { id: "user-a" },
    { mediaKind: "video", filename: "clip.mp4", mimeType: "video/mp4", size: 12 },
  );
  assert.equal(grant.strategy, "sts-multipart");
  assert.equal(grant.sts?.securityToken, "temporary-token");
  assert.equal(grant.signedPut, undefined);
});

test("authorization grant failure records failed instead of leaving an active session", async () => {
  const repository = new FakeRepository();
  const { service } = createFixture(
    repository,
    fakeGateway({ createSignedPut: async () => Promise.reject(new Error("signer unavailable")) }),
  );

  await expectServiceError(service.authorize({ id: "user-a" }, request), "storage_error");
  assert.equal(repository.sessions.values().next().value?.status, "failed");
  assert.equal(repository.sessions.values().next().value?.failureCode, "grant_failed");
});

test("database-backed active and rolling-minute limits surface 429 errors", async () => {
  const activeRepository = new FakeRepository();
  activeRepository.activeCount = 5;
  await expectServiceError(
    createFixture(activeRepository).service.authorize({ id: "user-a" }, request),
    "active_limit",
  );

  const recentRepository = new FakeRepository();
  recentRepository.recentCount = 20;
  await expectServiceError(
    createFixture(recentRepository).service.authorize({ id: "user-a" }, request),
    "rate_limited",
  );
});

test("database capacity keeps finalized uploads active for 24 hours, not the 15-minute grant TTL", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const client: UploadRepositoryClient = {
    async query<Row>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return {
        rows: (text.includes("active_count")
          ? [{ active_count: 0, recent_count: 0 }]
          : []) as Row[],
        rowCount: 0,
      };
    },
  };
  await assertAuthorizationCapacity(client, {
    userId: "user-a",
    now: 100_000_000,
    windowStart: 99_940_000,
    activeLimit: 5,
    rateLimit: 20,
  });

  const expiryUpdate = queries.find((query) => query.text.includes("SET status = 'expired'"));
  assert.match(expiryUpdate?.text ?? "", /status IN \('authorized', 'uploaded'\)/u);
  assert.doesNotMatch(expiryUpdate?.text ?? "", /'finalized'\)/u);
  const countQuery = queries.find((query) => query.text.includes("active_count"));
  assert.match(countQuery?.text ?? "", /status = 'finalized' AND updated_at > \$4/u);
  assert.equal(countQuery?.values?.[3], 100_000_000 - 24 * 60 * 60 * 1000);
});

test("owner isolation returns the same not_found response as an absent upload", async () => {
  const { service, repository } = createFixture();
  const owned = session();
  repository.sessions.set(owned.id, owned);

  await expectServiceError(service.get({ id: "user-b" }, owned.id), "not_found");
  await expectServiceError(
    service.get({ id: "user-a" }, "99999999-9999-4999-8999-999999999999"),
    "not_found",
  );
});

test("complete verifies size, signature, copies to final and deletes pending", async () => {
  const operations: string[] = [];
  const repository = new FakeRepository();
  const owned = session();
  repository.sessions.set(owned.id, owned);
  const gateway = fakeGateway({
    copy: async (source, destination) => {
      operations.push(`copy:${source}:${destination}`);
    },
    delete: async (key) => {
      operations.push(`delete:${key}`);
    },
  });
  const { service } = createFixture(repository, gateway);

  const completed = await service.complete({ id: "user-a" }, owned.id);
  assert.equal(completed.status, "finalized");
  assert.match(completed.finalObjectKey ?? "", /^media\/user-a\/primary_image\/1970\/01\//u);
  assert.equal(operations[0]?.startsWith("copy:"), true);
  assert.equal(operations[1], `delete:${owned.pendingObjectKey}`);
});

test("complete rejects mismatched size and removes the pending object", async () => {
  const deleted: string[] = [];
  const repository = new FakeRepository();
  const owned = session();
  repository.sessions.set(owned.id, owned);
  const { service } = createFixture(
    repository,
    fakeGateway({
      head: async () => ({ size: owned.declaredSize + 1, contentType: "image/jpeg" }),
      delete: async (key) => void deleted.push(key),
    }),
  );

  await expectServiceError(service.complete({ id: "user-a" }, owned.id), "size_mismatch");
  assert.equal(repository.sessions.get(owned.id)?.status, "failed");
  assert.deepEqual(deleted, [owned.pendingObjectKey]);
});

test("complete rejects MIME signature mismatch with 415 semantics", async () => {
  const repository = new FakeRepository();
  const owned = session();
  repository.sessions.set(owned.id, owned);
  const { service } = createFixture(
    repository,
    fakeGateway({ readPrefix: async () => Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]) }),
  );

  await expectServiceError(service.complete({ id: "user-a" }, owned.id), "type_mismatch");
  assert.equal(repository.sessions.get(owned.id)?.failureCode, "signature_mismatch");
});

test("copy failure deletes both possible objects and records a failed session", async () => {
  const deleted: string[] = [];
  const repository = new FakeRepository();
  const owned = session();
  repository.sessions.set(owned.id, owned);
  const { service } = createFixture(
    repository,
    fakeGateway({
      copy: async () => Promise.reject(new Error("copy failed")),
      delete: async (key) => void deleted.push(key),
    }),
  );

  await expectServiceError(service.complete({ id: "user-a" }, owned.id), "storage_error");
  assert.equal(repository.sessions.get(owned.id)?.failureCode, "copy_failed");
  assert.ok(deleted.some((key) => key === owned.pendingObjectKey));
  assert.ok(deleted.some((key) => key.startsWith("media/user-a/")));
});

test("expired completion marks expired and rejects without copying", async () => {
  let copied = false;
  const repository = new FakeRepository();
  const owned = session({ expiresAt: 999_999 });
  repository.sessions.set(owned.id, owned);
  const { service } = createFixture(
    repository,
    fakeGateway({ copy: async () => void (copied = true) }),
  );

  await expectServiceError(service.complete({ id: "user-a" }, owned.id), "expired");
  assert.equal(copied, false);
  assert.equal(repository.sessions.get(owned.id)?.status, "expired");
});

test("complete is idempotent for finalized and claimed sessions", async () => {
  let heads = 0;
  const repository = new FakeRepository();
  const finalized = session({
    status: "finalized",
    finalObjectKey: "media/user-a/primary_image/1970/01/final.jpg",
  });
  repository.sessions.set(finalized.id, finalized);
  const { service } = createFixture(
    repository,
    fakeGateway({ head: async () => (heads += 1, { size: JPEG.byteLength }) }),
  );

  assert.equal((await service.complete({ id: "user-a" }, finalized.id)).status, "finalized");
  repository.sessions.set(finalized.id, { ...finalized, status: "claimed" });
  assert.equal((await service.complete({ id: "user-a" }, finalized.id)).status, "claimed");
  assert.equal(heads, 0);
});

test("claim uses the supplied PoolClient, writes the entity before claimed, and is idempotent", async () => {
  const repository = new FakeRepository();
  const finalized = session({
    status: "finalized",
    finalObjectKey: "media/user-a/primary_image/1970/01/final.jpg",
  });
  repository.sessions.set(finalized.id, finalized);
  const { service } = createFixture(repository);
  const client = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as pg.PoolClient;
  let writes = 0;
  const writer: ClaimWriter<{ assetId: string }> = async (receivedClient, upload) => {
    assert.equal(receivedClient, client);
    assert.equal(upload.status, "finalized");
    assert.equal(repository.sessions.get(upload.id)?.status, "finalized");
    writes += 1;
    return { assetId: "asset-1" };
  };

  const first = await service.claim(client, { id: "user-a" }, finalized.id, writer);
  assert.deepEqual(first.value, { assetId: "asset-1" });
  assert.equal(first.created, true);
  assert.equal(first.session.status, "claimed");

  const repeated = await service.claim(client, { id: "user-a" }, finalized.id, writer);
  assert.equal(repeated.created, false);
  assert.equal(repeated.value, undefined);
  assert.equal(writes, 1);
});

test("claim uses the 24-hour finalized retention instead of the short upload grant TTL", async () => {
  const repository = new FakeRepository();
  const finalized = session({
    status: "finalized",
    expiresAt: 100,
    updatedAt: 999_000,
    finalObjectKey: "media/user-a/primary_image/1970/01/final.jpg",
  });
  repository.sessions.set(finalized.id, finalized);
  const { service } = createFixture(repository);
  const client = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as pg.PoolClient;

  const result = await service.claim(
    client,
    { id: "user-a" },
    finalized.id,
    async () => "created",
  );
  assert.equal(result.value, "created");
  assert.equal(result.session.status, "claimed");
});
