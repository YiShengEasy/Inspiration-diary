# Private OSS Direct Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Web 图片、视频和附件直接上传私有 OSS，避免媒体正文进入 2核2G ECS 内存，同时保留小程序与 Web 回滚路径。

**Architecture:** Express 创建有状态上传会话并签发单对象短时授权；浏览器上传到 `pending/`，服务端通过 HeadObject、Range 和魔数校验后复制到正式路径，再由业务写入 claim。图片和文档使用 V4 签名 PUT，视频使用路径受限、15 分钟 STS 分片上传。

**Tech Stack:** Express, TypeScript, PostgreSQL, ali-oss, React, Canvas API, node:test.

---

### Task 1: Add the Migration Runner and Upload Schema

**Files:**
- Create: `database/migrations/001_upload_sessions.sql`
- Create: `src/server/database/migrations.ts`
- Create: `scripts/migrate-database.ts`
- Create: `tests/database-migrations.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing migration discovery tests**

```ts
test("sorts unapplied migrations and rejects duplicate versions", () => {
  assert.deepEqual(selectPending(["002_b.sql", "001_a.sql"], new Set()), ["001_a.sql", "002_b.sql"]);
  assert.throws(() => parseMigrationNames(["001_a.sql", "001_b.sql"]), /duplicate version/i);
});
```

Run: `npx tsx --test tests/database-migrations.test.ts`

Expected: FAIL because the migration module does not exist.

- [ ] **Step 2: Implement transactional migration discovery and locking**

```ts
export interface MigrationFile { version: string; filename: string; sql: string }

export async function migrate(pool: pg.Pool, files: MigrationFile[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('inspiration-diary-migrations'))");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at bigint NOT NULL)");
    for (const file of await pendingMigrations(client, files)) {
      await client.query("BEGIN");
      try {
        await client.query(file.sql);
        await client.query("INSERT INTO schema_migrations(version, applied_at) VALUES ($1, $2)", [file.version, Date.now()]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('inspiration-diary-migrations'))");
    client.release();
  }
}
```

- [ ] **Step 3: Create the upload session migration**

```sql
CREATE TABLE upload_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_kind text NOT NULL CHECK (media_kind IN ('primary_image','image_asset','video','document','combo_image','combo_video')),
  original_name text NOT NULL,
  declared_mime_type text NOT NULL,
  declared_size bigint NOT NULL CHECK (declared_size > 0),
  pending_object_key text NOT NULL UNIQUE,
  final_object_key text UNIQUE,
  status text NOT NULL CHECK (status IN ('authorized','uploaded','finalized','claimed','failed','expired')),
  expires_at bigint NOT NULL,
  claimed_at bigint,
  failure_code text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX upload_sessions_user_active_idx ON upload_sessions(user_id, status, expires_at);
CREATE INDEX upload_sessions_cleanup_idx ON upload_sessions(status, updated_at);

CREATE TABLE document_assets (
  id varchar(80) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id varchar(50) REFERENCES cards(id) ON DELETE CASCADE,
  storage_provider varchar(20) NOT NULL DEFAULT 'oss',
  storage_key text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  created_at bigint NOT NULL,
  UNIQUE(user_id, storage_provider, storage_key)
);
CREATE INDEX document_assets_user_card_idx ON document_assets(user_id, card_id, created_at DESC);
```

- [ ] **Step 4: Add scripts and pass tests**

```json
{
  "db:migrate": "tsx scripts/migrate-database.ts",
  "db:migrate:status": "tsx scripts/migrate-database.ts --status",
  "test:server": "tsx --test tests/database-migrations.test.ts tests/direct-upload*.test.ts"
}
```

Run: `npm run test:server && npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add database/migrations/001_upload_sessions.sql src/server/database/migrations.ts scripts/migrate-database.ts tests/database-migrations.test.ts package.json
git commit -m "feat: add upload session migration"
```

### Task 2: Add Validated Runtime Configuration

**Files:**
- Modify: `src/server/runtimeConfig.ts`
- Modify: `scripts/validate-runtime-config.ts`
- Modify: `.env.example`
- Modify: `.env.local.example`
- Modify: `.env.production.example`
- Create: `tests/direct-upload-config.test.ts`

- [ ] **Step 1: Write failing parser tests**

Cover `off|admin|all`, positive integer limits, a required STS role ARN when direct video upload is enabled, and rejection of invalid values.

- [ ] **Step 2: Add exact runtime fields**

```ts
export type FeatureAudience = "off" | "admin" | "all";

directUpload: {
  mode: FeatureAudience;
  stsRoleArn: string;
  authorizationTtlSeconds: number;
  videoStsTtlSeconds: number;
  activeSessionsPerUser: number;
  authorizationsPerMinute: number;
  maxImageBytes: number;
  maxDocumentBytes: number;
  maxVideoBytes: number;
  maxAnalysisBytes: number;
};
```

- [ ] **Step 3: Document conservative defaults**

```dotenv
WEB_DIRECT_OSS_UPLOAD_MODE=off
OSS_STS_ROLE_ARN=
UPLOAD_AUTH_TTL_SECONDS=900
UPLOAD_VIDEO_STS_TTL_SECONDS=900
UPLOAD_ACTIVE_SESSIONS_PER_USER=5
UPLOAD_AUTHORIZATIONS_PER_MINUTE=20
UPLOAD_MAX_IMAGE_BYTES=26214400
UPLOAD_MAX_DOCUMENT_BYTES=20971520
UPLOAD_MAX_VIDEO_BYTES=104857600
UPLOAD_MAX_ANALYSIS_BYTES=5242880
```

- [ ] **Step 4: Pass tests and validation**

Run: `npx tsx --test tests/direct-upload-config.test.ts && npm run config:production`

Expected: PASS with `WEB_DIRECT_OSS_UPLOAD_MODE=off`; invalid configured values produce explicit errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/runtimeConfig.ts scripts/validate-runtime-config.ts .env.example .env.local.example .env.production.example tests/direct-upload-config.test.ts
git commit -m "feat: configure private OSS direct uploads"
```

### Task 3: Implement Upload Policy, State Machine, and Magic Validation

**Files:**
- Create: `src/server/direct-upload/types.ts`
- Create: `src/server/direct-upload/policy.ts`
- Create: `src/server/direct-upload/stateMachine.ts`
- Create: `src/server/direct-upload/magicBytes.ts`
- Create: `tests/direct-upload-policy.test.ts`

- [ ] **Step 1: Write failing policy tests**

Test safe extension normalization, server-generated keys, MIME/size limits, SVG/HTML/executable rejection, allowed state transitions and signatures for JPEG/PNG/WebP/GIF/MP4/MOV/WebM/PDF/Markdown.

- [ ] **Step 2: Define transport types**

```ts
export type UploadStatus = "authorized" | "uploaded" | "finalized" | "claimed" | "failed" | "expired";
export type UploadMediaKind = "primary_image" | "image_asset" | "video" | "document" | "combo_image" | "combo_video";

export interface UploadAuthorizationRequest {
  mediaKind: UploadMediaKind;
  filename: string;
  mimeType: string;
  size: number;
}

export interface UploadAuthorizationResponse {
  uploadId: string;
  objectKey: string;
  expiresAt: number;
  strategy: "signed-put" | "sts-multipart";
  signedPut?: { url: string; headers: Record<string, string> };
  sts?: { region: string; bucket: string; endpoint: string; accessKeyId: string; accessKeySecret: string; securityToken: string };
}
```

- [ ] **Step 3: Implement deterministic pending and final keys**

```ts
pending/{userId}/{uploadId}/{randomUuid}.{safeExtension}
media/{userId}/{mediaKind}/{yyyy}/{mm}/{uploadId}.{safeExtension}
```

Never accept an object key from the browser.

- [ ] **Step 4: Implement signature detection and transition checks**

`detectFileKind(bytes)` reads at most 16 KiB and returns a normalized kind. `canTransition(from, to)` only allows the design-approved state graph and treats repeated `complete`/`claim` calls as idempotent reads.

- [ ] **Step 5: Run tests and commit**

```bash
npx tsx --test tests/direct-upload-policy.test.ts
git add src/server/direct-upload tests/direct-upload-policy.test.ts
git commit -m "feat: validate direct upload policies"
```

### Task 4: Add the OSS Direct-Upload Gateway

**Files:**
- Create: `src/server/direct-upload/ossGateway.ts`
- Create: `tests/direct-upload-oss.test.ts`
- Modify: `src/server/storage/ossStorage.ts`

- [ ] **Step 1: Define an injectable gateway and fake it in tests**

```ts
export interface DirectUploadGateway {
  createSignedPut(input: { objectKey: string; mimeType: string; expiresSeconds: number }): Promise<{ url: string; headers: Record<string, string> }>;
  createMultipartCredentials(input: { userId: string; objectKey: string; expiresSeconds: number }): Promise<TemporaryOssCredentials>;
  head(objectKey: string): Promise<{ size: number; contentType?: string }>;
  readPrefix(objectKey: string, maxBytes: number): Promise<Uint8Array>;
  copy(sourceKey: string, destinationKey: string): Promise<void>;
  delete(objectKey: string): Promise<void>;
}
```

- [ ] **Step 2: Generate a signed PUT scoped to one object**

Use `signatureUrlV4("PUT", expiresSeconds, { headers: { "content-type": mimeType } }, objectKey)`. Return the exact signed headers to the browser.

- [ ] **Step 3: Generate restricted STS multipart credentials**

The inline RAM policy must allow only the current object ARN and these actions:

```json
["oss:PutObject","oss:AbortMultipartUpload","oss:ListParts"]
```

Alibaba Cloud maps `InitiateMultipartUpload`, `UploadPart`, and `CompleteMultipartUpload` to `oss:PutObject`; abort and resume inspection use `oss:AbortMultipartUpload` and `oss:ListParts`. Do not grant `oss:ListObjects`, reads, wildcard prefixes or object deletion. Clamp duration to 900 seconds.

- [ ] **Step 4: Pass fake-gateway and policy-shape tests**

Run: `npx tsx --test tests/direct-upload-oss.test.ts`

Expected: signed PUT uses one key; STS resource equals one object ARN; credentials expire in at most 15 minutes.

- [ ] **Step 5: Commit**

```bash
git add src/server/direct-upload/ossGateway.ts src/server/storage/ossStorage.ts tests/direct-upload-oss.test.ts
git commit -m "feat: add scoped OSS upload gateway"
```

### Task 5: Build the Upload Service and Authenticated API

**Files:**
- Create: `src/server/direct-upload/repository.ts`
- Create: `src/server/direct-upload/rateLimit.ts`
- Create: `src/server/direct-upload/service.ts`
- Create: `src/server/direct-upload/router.ts`
- Create: `tests/direct-upload-service.test.ts`
- Create: `tests/direct-upload-router.test.ts`
- Modify: `server.ts`

- [ ] **Step 1: Write failing service tests**

Cover owner isolation, max 5 active sessions, 20 authorizations/minute, expired session rejection, HeadObject size mismatch, MIME/signature mismatch, idempotent complete/claim and failed copy cleanup.

- [ ] **Step 2: Implement authorization and completion transactions**

```ts
authorize(user, request) -> insert authorized session -> return one upload grant
complete(user, uploadId) -> lock row -> head/range verify -> copy -> delete pending -> mark finalized
claim(client, user, uploadId, entity) -> lock row -> create business row with final_object_key -> mark claimed
```

The business record and `claimed` state must commit in the same PostgreSQL transaction. If a request repeats after success, return the existing result instead of duplicating media rows.

- [ ] **Step 3: Add authenticated endpoints**

```text
POST /api/uploads/authorize
POST /api/uploads/:id/complete
GET  /api/uploads/:id
POST /api/uploads/:id/abort
```

Responses never expose long-term OSS credentials. Return 409 for an illegal state transition, 413 for a real size overflow, 415 for signature/type rejection and 429 for limits.

- [ ] **Step 4: Mount the router behind audience gating**

`off` returns 404, `admin` permits `req.user.role === "admin"`, and `all` permits all authenticated users. The legacy upload routes remain mounted.

- [ ] **Step 5: Run API tests and commit**

```bash
npx tsx --test tests/direct-upload-service.test.ts tests/direct-upload-router.test.ts
git add src/server/direct-upload server.ts tests/direct-upload-service.test.ts tests/direct-upload-router.test.ts
git commit -m "feat: add authenticated direct upload sessions"
```

### Task 6: Add the Browser Direct-Upload Client

**Files:**
- Create: `src/lib/directUploadClient.ts`
- Create: `src/lib/imageAnalysisCopy.ts`
- Create: `tests/direct-upload-client.test.ts`
- Modify: `src/lib/dbClient.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing browser-helper tests**

Test signed PUT headers, STS multipart progress/abort, feature-unavailable fallback and client-side image analysis limits.

- [ ] **Step 2: Implement a transport independent of card creation**

```ts
export async function uploadDirect(file: File, mediaKind: UploadMediaKind, options: {
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
}): Promise<{ uploadId: string; finalObjectKey: string }>;
```

For `signed-put`, call `fetch(url, { method: "PUT", headers, body: file, signal })`. For `sts-multipart`, create an ali-oss browser client and call `multipartUpload(objectKey, file, { parallel: 3, partSize: 1_048_576, progress })`.

- [ ] **Step 3: Generate the image analysis copy locally**

Resize the longest edge to at most 1280 pixels, encode WebP at quality 0.82 with JPEG fallback, and reduce quality until the result is at most 5 MiB. Revoke every temporary object URL.

- [ ] **Step 4: Integrate existing Web flows behind capability detection**

Replace Web uploads in `App.tsx` and `dbClient.ts` using this exact claim mapping:

```text
primary image → POST /api/db/cards with uploadId; skip /api/store-image in direct mode
video asset   → POST /api/videos/upload JSON { uploadId, cardId, durationMs }
image asset   → POST /api/images/upload JSON { uploadId, cardId }
combo image   → POST /api/db/cards/:id/combo/images JSON { uploadId, role, sortOrder }
combo video   → POST /api/db/cards/:id/combo/generations JSON { uploadId, prompt, model }
document      → POST /api/documents/extract-text JSON { uploadId }, then POST /api/db/cards with documentUploadId
```

The document extractor loads only the validated finalized object, enforces a one-document semaphore and 20 MiB hard cap, and creates `document_assets` when the Markdown card claims it. After direct completion, every business endpoint uses the upload service to claim in the same transaction. Preserve multipart `FormData` when direct upload returns 404/disabled. Do not change mini-program clients.

- [ ] **Step 5: Verify smooth uploads and commit**

```bash
npx tsx --test tests/direct-upload-client.test.ts
npm run lint
npm run build
git add src/lib/directUploadClient.ts src/lib/imageAnalysisCopy.ts src/lib/dbClient.ts src/App.tsx tests/direct-upload-client.test.ts
git commit -m "feat: upload web media directly to OSS"
```

### Task 7: Add Cleanup, Metrics, and Operational Checks

**Files:**
- Create: `src/server/direct-upload/cleanup.ts`
- Create: `scripts/cleanup-upload-sessions.ts`
- Create: `scripts/direct-upload-smoke.ts`
- Create: `tests/direct-upload-cleanup.test.ts`
- Modify: `package.json`
- Modify: `scripts/com.yisheng.inspiration-diary-services.plist`
- Modify: `docs/PROJECT_STRUCTURE.md`

- [ ] **Step 1: Test bounded cleanup before implementation**

Cleanup selects at most 100 rows with `FOR UPDATE SKIP LOCKED`, expires stale sessions, deletes pending objects older than 24 hours and deletes finalized objects older than 24 hours only when no business row claims the key.

- [ ] **Step 2: Implement one-shot cleanup**

```json
{
  "uploads:cleanup": "tsx scripts/cleanup-upload-sessions.ts",
  "uploads:smoke": "tsx scripts/direct-upload-smoke.ts"
}
```

Run the one-shot command from system cron/launchd every 15 minutes; do not add an in-process timer or queue worker.

- [ ] **Step 3: Add lightweight structured metrics**

Log one JSON line per authorize/complete/claim/failure/cleanup with `event`, `uploadId`, `userId`, `kind`, `durationMs`, `status`, `bytes` and `errorCode`. Never log credentials, signed URLs or filenames containing private text.

- [ ] **Step 4: Add the concurrency smoke test**

The smoke test uploads three generated 100 MiB streams directly to OSS, samples `/proc`/process RSS before and after, completes and deletes the test sessions, and fails when Node RSS grows by 100 MiB or more.

- [ ] **Step 5: Run the production gate**

```bash
npm run test:server
npm run lint
npm run build
npm run uploads:smoke
```

Expected: all commands pass; network bytes go browser/test client → OSS, not through the Express request body.

- [ ] **Step 6: Commit**

```bash
git add src/server/direct-upload/cleanup.ts scripts/cleanup-upload-sessions.ts scripts/direct-upload-smoke.ts tests/direct-upload-cleanup.test.ts package.json scripts/com.yisheng.inspiration-diary-services.plist docs/PROJECT_STRUCTURE.md
git commit -m "ops: clean and monitor direct uploads"
```
