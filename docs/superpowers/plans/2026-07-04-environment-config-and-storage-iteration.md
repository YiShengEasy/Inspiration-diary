# Environment Config And Storage Iteration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit local and production environment configuration, split Docker entrypoints by environment, and prepare the storage layer so local development can keep PhotoPrism/local files while production can move to OSS.

**Architecture:** Introduce a typed server runtime configuration module that reads `APP_ENV`, database, auth, and storage provider variables once at startup. Split Docker Compose into local and production files with separate env examples and npm scripts. Add storage adapter boundaries so the current PhotoPrism/local media behavior remains available locally while production can route images, videos, and bound assets to OSS in a later task without changing card APIs.

**Tech Stack:** Node.js 22, Express, Vite, TypeScript, Docker Compose, PostgreSQL, multer, Alibaba Cloud OSS-compatible object storage.

---

## File Structure

- Create `src/server/runtimeConfig.ts`: typed server-side environment parsing and validation.
- Create `scripts/validate-runtime-config.ts`: small validation command for local and production env files.
- Create `docker-compose.local.yml`: local app + Postgres + persistent upload volumes; PhotoPrism remains externally configurable.
- Create `docker-compose.production.yml`: production app + Postgres, no PhotoPrism dependency, OSS variables required.
- Create `.env.local.example`: local development template.
- Create `.env.production.example`: production ECS template.
- Modify `docker-compose.yml`: either keep as compatibility wrapper or replace with a documented local default.
- Modify `package.json`: add environment-specific Docker and config validation scripts.
- Modify `README.md`: document local vs production setup, ECS notes, env variable ownership, and migration path.
- Modify `server.ts`: read runtime config instead of scattered raw `process.env` storage defaults.
- Create `src/server/storage/types.ts`: shared storage object and upload result types.
- Create `src/server/storage/index.ts`: provider selection facade.
- Create `src/server/storage/localStorage.ts`: local filesystem storage provider for videos and image attachments.
- Create `src/server/storage/photoprismStorage.ts`: wrapper around current PhotoPrism image behavior.
- Create `src/server/storage/ossStorage.ts`: OSS provider skeleton with explicit unsupported errors until the OSS SDK task is executed.

## Iteration Boundaries

- Iteration 1 makes environments explicit and keeps existing runtime behavior working.
- Iteration 2 introduces storage adapters without changing upload behavior.
- Iteration 3 turns on OSS for production images/videos and removes ECS media bandwidth from playback/download.
- Iteration 4 adds operational deployment docs and smoke checks for the Alibaba Cloud ECS.

---

### Task 1: Centralize Runtime Configuration

**Files:**
- Create: `src/server/runtimeConfig.ts`
- Create: `scripts/validate-runtime-config.ts`
- Modify: `server.ts`
- Modify: `package.json`

- [ ] **Step 1: Create runtime config parser**

Create `src/server/runtimeConfig.ts`:

```ts
export type AppEnv = "local" | "production" | "test";
export type DatabaseType = "firestore" | "postgres";
export type PrimaryImageStorageProvider = "photoprism" | "oss";
export type AssetStorageProvider = "local" | "oss";

export interface RuntimeConfig {
  appEnv: AppEnv;
  port: number;
  databaseType: DatabaseType;
  databaseUrl: string;
  databaseSsl: boolean;
  authCookieSecure: boolean;
  primaryImageStorageProvider: PrimaryImageStorageProvider;
  videoStorageProvider: AssetStorageProvider;
  imageAssetStorageProvider: AssetStorageProvider;
  photoPrism: {
    internalUrl: string;
    publicUrl: string;
    username: string;
    password: string;
  };
  localStorage: {
    videoUploadRoot: string;
    imageAssetUploadRoot: string;
  };
  oss: {
    region: string;
    bucket: string;
    endpoint: string;
    accessKeyId: string;
    accessKeySecret: string;
    publicBaseUrl: string;
    signedUrlTtlSeconds: number;
  };
}

function readEnv(name: string): string {
  return process.env[name]?.trim() || "";
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = readEnv(name).toLowerCase();
  if (!value) return fallback;
  return value === "true" || value === "1" || value === "yes";
}

function readNumber(name: string, fallback: number): number {
  const parsed = Number.parseInt(readEnv(name), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAppEnv(value: string): AppEnv {
  if (value === "production" || value === "test") return value;
  return "local";
}

function parseDatabaseType(value: string): DatabaseType {
  return value === "postgres" ? "postgres" : "firestore";
}

function parsePrimaryImageStorageProvider(value: string): PrimaryImageStorageProvider {
  return value === "oss" ? "oss" : "photoprism";
}

function parseAssetStorageProvider(value: string): AssetStorageProvider {
  return value === "oss" ? "oss" : "local";
}

export function getRuntimeConfig(): RuntimeConfig {
  const appEnv = parseAppEnv(readEnv("APP_ENV"));
  const primaryImageStorageProvider = parsePrimaryImageStorageProvider(readEnv("IMAGE_STORAGE_PROVIDER"));
  const videoStorageProvider = parseAssetStorageProvider(readEnv("VIDEO_STORAGE_PROVIDER"));
  const imageAssetStorageProvider = parseAssetStorageProvider(readEnv("IMAGE_ASSET_STORAGE_PROVIDER"));

  return {
    appEnv,
    port: readNumber("PORT", 3000),
    databaseType: parseDatabaseType(readEnv("DATABASE_TYPE")),
    databaseUrl: readEnv("DATABASE_URL") || "postgresql://postgres:postgres@localhost:5432/notebook",
    databaseSsl: readBoolean("DATABASE_SSL", false),
    authCookieSecure: readBoolean("AUTH_COOKIE_SECURE", appEnv === "production"),
    primaryImageStorageProvider,
    videoStorageProvider,
    imageAssetStorageProvider,
    photoPrism: {
      internalUrl: readEnv("PHOTOPRISM_INTERNAL_URL"),
      publicUrl: readEnv("PHOTOPRISM_PUBLIC_URL") || readEnv("PHOTOPRISM_INTERNAL_URL"),
      username: readEnv("PHOTOPRISM_USERNAME"),
      password: readEnv("PHOTOPRISM_PASSWORD"),
    },
    localStorage: {
      videoUploadRoot: readEnv("VIDEO_UPLOAD_ROOT") || "uploads/videos",
      imageAssetUploadRoot: readEnv("IMAGE_ASSET_UPLOAD_ROOT") || "uploads/images",
    },
    oss: {
      region: readEnv("OSS_REGION"),
      bucket: readEnv("OSS_BUCKET"),
      endpoint: readEnv("OSS_ENDPOINT"),
      accessKeyId: readEnv("OSS_ACCESS_KEY_ID"),
      accessKeySecret: readEnv("OSS_ACCESS_KEY_SECRET"),
      publicBaseUrl: readEnv("OSS_PUBLIC_BASE_URL"),
      signedUrlTtlSeconds: readNumber("OSS_SIGNED_URL_TTL_SECONDS", 900),
    },
  };
}

export function validateRuntimeConfig(config = getRuntimeConfig()): string[] {
  const errors: string[] = [];

  if (config.databaseType === "postgres" && !config.databaseUrl) {
    errors.push("DATABASE_URL is required when DATABASE_TYPE=postgres.");
  }

  if (config.primaryImageStorageProvider === "photoprism") {
    if (!config.photoPrism.internalUrl) errors.push("PHOTOPRISM_INTERNAL_URL is required when IMAGE_STORAGE_PROVIDER=photoprism.");
    if (!config.photoPrism.publicUrl) errors.push("PHOTOPRISM_PUBLIC_URL is required when IMAGE_STORAGE_PROVIDER=photoprism.");
    if (!config.photoPrism.username) errors.push("PHOTOPRISM_USERNAME is required when IMAGE_STORAGE_PROVIDER=photoprism.");
    if (!config.photoPrism.password) errors.push("PHOTOPRISM_PASSWORD is required when IMAGE_STORAGE_PROVIDER=photoprism.");
  }

  const requiresOss = config.primaryImageStorageProvider === "oss"
    || config.videoStorageProvider === "oss"
    || config.imageAssetStorageProvider === "oss";

  if (requiresOss) {
    if (!config.oss.region) errors.push("OSS_REGION is required when any storage provider is oss.");
    if (!config.oss.bucket) errors.push("OSS_BUCKET is required when any storage provider is oss.");
    if (!config.oss.endpoint) errors.push("OSS_ENDPOINT is required when any storage provider is oss.");
    if (!config.oss.accessKeyId) errors.push("OSS_ACCESS_KEY_ID is required when any storage provider is oss.");
    if (!config.oss.accessKeySecret) errors.push("OSS_ACCESS_KEY_SECRET is required when any storage provider is oss.");
    if (!config.oss.publicBaseUrl) errors.push("OSS_PUBLIC_BASE_URL is required when any storage provider is oss.");
  }

  if (config.appEnv === "production") {
    if (config.authCookieSecure !== true) errors.push("AUTH_COOKIE_SECURE must be true in production.");
    if (config.databaseType !== "postgres") errors.push("DATABASE_TYPE must be postgres in production.");
  }

  return errors;
}
```

- [ ] **Step 2: Add validation script**

Create `scripts/validate-runtime-config.ts`:

```ts
import dotenv from "dotenv";
import { getRuntimeConfig, validateRuntimeConfig } from "../src/server/runtimeConfig";

const envFile = process.argv[2] || ".env.local";
dotenv.config({ path: envFile });

const config = getRuntimeConfig();
const errors = validateRuntimeConfig(config);

if (errors.length > 0) {
  console.error(`Runtime config validation failed for ${envFile}:`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Runtime config OK for ${envFile}`);
console.log(JSON.stringify({
  appEnv: config.appEnv,
  databaseType: config.databaseType,
  primaryImageStorageProvider: config.primaryImageStorageProvider,
  videoStorageProvider: config.videoStorageProvider,
  imageAssetStorageProvider: config.imageAssetStorageProvider,
  authCookieSecure: config.authCookieSecure,
}, null, 2));
```

- [ ] **Step 3: Wire config into `server.ts`**

Modify the top of `server.ts`:

```ts
import { getRuntimeConfig, validateRuntimeConfig } from "./src/server/runtimeConfig";
```

After `dotenv.config();`, add:

```ts
const runtimeConfig = getRuntimeConfig();
const runtimeConfigErrors = validateRuntimeConfig(runtimeConfig);
if (runtimeConfigErrors.length > 0) {
  throw new Error(`Invalid runtime configuration:\n${runtimeConfigErrors.join("\n")}`);
}
```

Replace the scattered defaults:

```ts
const PORT = 3000;
const VIDEO_UPLOAD_ROOT = process.env.VIDEO_UPLOAD_ROOT || path.join(process.cwd(), "uploads", "videos");
const IMAGE_ASSET_UPLOAD_ROOT = process.env.IMAGE_ASSET_UPLOAD_ROOT || path.join(process.cwd(), "uploads", "images");
```

with:

```ts
const PORT = runtimeConfig.port;
const VIDEO_UPLOAD_ROOT = path.isAbsolute(runtimeConfig.localStorage.videoUploadRoot)
  ? runtimeConfig.localStorage.videoUploadRoot
  : path.join(process.cwd(), runtimeConfig.localStorage.videoUploadRoot);
const IMAGE_ASSET_UPLOAD_ROOT = path.isAbsolute(runtimeConfig.localStorage.imageAssetUploadRoot)
  ? runtimeConfig.localStorage.imageAssetUploadRoot
  : path.join(process.cwd(), runtimeConfig.localStorage.imageAssetUploadRoot);
```

Replace:

```ts
const dbType = process.env.DATABASE_TYPE || "firestore";
```

with:

```ts
const dbType = runtimeConfig.databaseType;
```

Replace the PostgreSQL pool config with:

```ts
pgPool = new pg.Pool({
  connectionString: runtimeConfig.databaseUrl,
  ssl: runtimeConfig.databaseSsl ? { rejectUnauthorized: false } : false,
});
```

- [ ] **Step 4: Add package scripts**

Modify `package.json` scripts:

```json
"config:local": "tsx scripts/validate-runtime-config.ts .env.local",
"config:production": "tsx scripts/validate-runtime-config.ts .env.production"
```

- [ ] **Step 5: Verify config script fails before env files exist**

Run:

```bash
npm run config:production
```

Expected: command fails because `.env.production` is not complete for production OSS settings.

- [ ] **Step 6: Commit**

```bash
git add src/server/runtimeConfig.ts scripts/validate-runtime-config.ts server.ts package.json
git commit -m "feat: centralize runtime config"
```

---

### Task 2: Split Local And Production Docker Configuration

**Files:**
- Create: `.env.local.example`
- Create: `.env.production.example`
- Create: `docker-compose.local.yml`
- Create: `docker-compose.production.yml`
- Modify: `docker-compose.yml`
- Modify: `package.json`

- [ ] **Step 1: Add local env example**

Create `.env.local.example`:

```env
APP_ENV=local
NODE_ENV=development
PORT=3000

GEMINI_API_KEY=MY_GEMINI_API_KEY
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_AUTH_TOKEN=

VITE_DATABASE_TYPE=postgres
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/notebook
DATABASE_SSL=false

AUTH_SESSION_DAYS=7
AUTH_COOKIE_SECURE=false
AUTH_BOOTSTRAP_EMAIL=local-admin@example.com
AUTH_BOOTSTRAP_PASSWORD=

IMAGE_STORAGE_PROVIDER=photoprism
VIDEO_STORAGE_PROVIDER=local
IMAGE_ASSET_STORAGE_PROVIDER=local

PHOTOPRISM_INTERNAL_URL=http://host.docker.internal:2342
PHOTOPRISM_PUBLIC_URL=http://localhost:2342
PHOTOPRISM_USERNAME=admin
PHOTOPRISM_PASSWORD=<server-side-secret>

VIDEO_UPLOAD_ROOT=/app/uploads/videos
IMAGE_ASSET_UPLOAD_ROOT=/app/uploads/images

MINI_DEBUG_PASSWORD_LOGIN=true
WECHAT_MOCK=true
```

- [ ] **Step 2: Add production env example**

Create `.env.production.example`:

```env
APP_ENV=production
NODE_ENV=production
PORT=3000

GEMINI_API_KEY=MY_GEMINI_API_KEY
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_AUTH_TOKEN=

VITE_DATABASE_TYPE=postgres
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://postgres:<strong-password>@postgres:5432/notebook
DATABASE_SSL=false

AUTH_SESSION_DAYS=7
AUTH_COOKIE_SECURE=true
AUTH_BOOTSTRAP_EMAIL=admin@example.com
AUTH_BOOTSTRAP_PASSWORD=<first-admin-password>

IMAGE_STORAGE_PROVIDER=oss
VIDEO_STORAGE_PROVIDER=oss
IMAGE_ASSET_STORAGE_PROVIDER=oss

OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=<bucket-name>
OSS_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
OSS_ACCESS_KEY_ID=<ram-access-key-id>
OSS_ACCESS_KEY_SECRET=<ram-access-key-secret>
OSS_PUBLIC_BASE_URL=https://<bucket-name>.oss-cn-hangzhou.aliyuncs.com
OSS_SIGNED_URL_TTL_SECONDS=900

VIDEO_UPLOAD_ROOT=/app/uploads/videos
IMAGE_ASSET_UPLOAD_ROOT=/app/uploads/images

MINI_DEBUG_PASSWORD_LOGIN=false
WECHAT_MOCK=false
```

- [ ] **Step 3: Add local compose file**

Create `docker-compose.local.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: notebook
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres-local-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d notebook"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    build:
      context: .
      args:
        VITE_DATABASE_TYPE: postgres
        VITE_ENABLE_MOCK_TOOLS: "true"
    image: inspiration-diary:local
    env_file:
      - .env.local
    environment:
      NODE_ENV: development
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/notebook
    ports:
      - "3005:3000"
    volumes:
      - uploads-local:/app/uploads
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

volumes:
  postgres-local-data:
  uploads-local:
```

- [ ] **Step 4: Add production compose file**

Create `docker-compose.production.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    env_file:
      - .env.production
    environment:
      POSTGRES_DB: notebook
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-change-me}
    volumes:
      - postgres-production-data:/var/lib/postgresql/data
      - postgres-backups:/backups
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d notebook"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  app:
    build:
      context: .
      args:
        VITE_DATABASE_TYPE: postgres
        VITE_ENABLE_MOCK_TOOLS: "false"
    image: inspiration-diary:production
    env_file:
      - .env.production
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD:-change-me}@postgres:5432/notebook
    ports:
      - "3005:3000"
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

volumes:
  postgres-production-data:
  postgres-backups:
```

- [ ] **Step 5: Keep default compose as local compatibility**

Replace `docker-compose.yml` with:

```yaml
include:
  - docker-compose.local.yml
```

- [ ] **Step 6: Add package scripts**

Modify `package.json` scripts:

```json
"docker:local": "docker compose -f docker-compose.local.yml up --build",
"docker:local:detached": "docker compose -f docker-compose.local.yml up --build -d",
"docker:local:down": "docker compose -f docker-compose.local.yml down --remove-orphans",
"docker:production": "docker compose -f docker-compose.production.yml up --build",
"docker:production:detached": "docker compose -f docker-compose.production.yml up --build -d",
"docker:production:down": "docker compose -f docker-compose.production.yml down --remove-orphans",
"docker:prod": "npm run docker:production",
"docker:prod:detached": "npm run docker:production:detached",
"docker:prod:down": "npm run docker:production:down"
```

- [ ] **Step 7: Verify local config**

Run:

```bash
cp .env.local.example .env.local
npm run config:local
```

Expected: prints `Runtime config OK for .env.local`.

- [ ] **Step 8: Commit**

```bash
git add .env.local.example .env.production.example docker-compose.yml docker-compose.local.yml docker-compose.production.yml package.json
git commit -m "feat: split local and production docker config"
```

---

### Task 3: Add Storage Adapter Boundary Without Changing Behavior

**Files:**
- Create: `src/server/storage/types.ts`
- Create: `src/server/storage/localStorage.ts`
- Create: `src/server/storage/photoprismStorage.ts`
- Create: `src/server/storage/ossStorage.ts`
- Create: `src/server/storage/index.ts`
- Modify: `src/server/photoprism.ts`
- Modify: `server.ts`

- [ ] **Step 1: Add shared storage types**

Create `src/server/storage/types.ts`:

```ts
export interface UploadObjectInput {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  storageKey: string;
}

export interface StoredObject {
  storageProvider: string;
  storageKey: string;
  publicUrl: string;
  signedUrl: string;
  sizeBytes: number;
  mimeType: string;
  originalName: string;
}

export interface ObjectStorageProvider {
  putObject(input: UploadObjectInput): Promise<StoredObject>;
  getSignedReadUrl(storageKey: string): Promise<string>;
  deleteObject(storageKey: string): Promise<void>;
}
```

- [ ] **Step 2: Add local storage provider**

Create `src/server/storage/localStorage.ts`:

```ts
import fs from "fs/promises";
import path from "path";
import type { ObjectStorageProvider, StoredObject, UploadObjectInput } from "./types";

export function createLocalStorageProvider(rootDir: string, publicPathPrefix: string): ObjectStorageProvider {
  function resolvePath(storageKey: string): string {
    const normalized = path.normalize(storageKey).replace(/^(\.\.(\/|\\|$))+/, "");
    return path.join(rootDir, normalized);
  }

  return {
    async putObject(input: UploadObjectInput): Promise<StoredObject> {
      const localPath = resolvePath(input.storageKey);
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, input.buffer);
      return {
        storageProvider: "local",
        storageKey: input.storageKey,
        publicUrl: `${publicPathPrefix}/${encodeURIComponent(input.storageKey)}`,
        signedUrl: `${publicPathPrefix}/${encodeURIComponent(input.storageKey)}`,
        sizeBytes: input.buffer.length,
        mimeType: input.mimeType,
        originalName: input.filename,
      };
    },
    async getSignedReadUrl(storageKey: string): Promise<string> {
      return `${publicPathPrefix}/${encodeURIComponent(storageKey)}`;
    },
    async deleteObject(storageKey: string): Promise<void> {
      await fs.unlink(resolvePath(storageKey)).catch(() => undefined);
    },
  };
}
```

- [ ] **Step 3: Add PhotoPrism wrapper**

Create `src/server/storage/photoprismStorage.ts`:

```ts
export {
  storeImageUploadInPhotoPrism,
  fetchPhotoPrismImage,
  type ImageUploadInput,
  type StoredPhotoPrismImage,
} from "../photoprism";
```

- [ ] **Step 4: Add OSS storage skeleton**

Create `src/server/storage/ossStorage.ts`:

```ts
import type { RuntimeConfig } from "../runtimeConfig";
import type { ObjectStorageProvider, StoredObject, UploadObjectInput } from "./types";

function notReady(): never {
  throw new Error("OSS storage is configured but the OSS SDK implementation has not been enabled yet.");
}

export function createOssStorageProvider(_config: RuntimeConfig): ObjectStorageProvider {
  return {
    async putObject(_input: UploadObjectInput): Promise<StoredObject> {
      return notReady();
    },
    async getSignedReadUrl(_storageKey: string): Promise<string> {
      return notReady();
    },
    async deleteObject(_storageKey: string): Promise<void> {
      return notReady();
    },
  };
}
```

- [ ] **Step 5: Add provider selection facade**

Create `src/server/storage/index.ts`:

```ts
import type { RuntimeConfig } from "../runtimeConfig";
import { createLocalStorageProvider } from "./localStorage";
import { createOssStorageProvider } from "./ossStorage";

export function createVideoStorage(config: RuntimeConfig) {
  if (config.videoStorageProvider === "oss") {
    return createOssStorageProvider(config);
  }
  return createLocalStorageProvider(config.localStorage.videoUploadRoot, "/api/videos");
}

export function createImageAssetStorage(config: RuntimeConfig) {
  if (config.imageAssetStorageProvider === "oss") {
    return createOssStorageProvider(config);
  }
  return createLocalStorageProvider(config.localStorage.imageAssetUploadRoot, "/api/images");
}

export function assertPrimaryImageStorageReady(config: RuntimeConfig): void {
  if (config.primaryImageStorageProvider === "oss") {
    throw new Error("IMAGE_STORAGE_PROVIDER=oss requires the OSS image implementation task before production start.");
  }
}
```

- [ ] **Step 6: Guard unsupported production OSS image mode**

Modify `server.ts` after runtime config validation:

```ts
import { assertPrimaryImageStorageReady } from "./src/server/storage";

assertPrimaryImageStorageReady(runtimeConfig);
```

This intentionally prevents a production container from pretending OSS image storage is ready before the OSS implementation task lands.

- [ ] **Step 7: Verify build**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands pass.

- [ ] **Step 8: Commit**

```bash
git add src/server/storage src/server/photoprism.ts server.ts
git commit -m "refactor: add storage provider boundary"
```

---

### Task 4: Implement OSS Provider And Production Media Routing

**Files:**
- Modify: `package.json`
- Modify: `src/server/storage/ossStorage.ts`
- Modify: `server.ts`
- Modify: `src/server/runtimeConfig.ts`

- [ ] **Step 1: Add OSS dependency**

Run:

```bash
npm install ali-oss
npm install -D @types/ali-oss
```

Expected: `package.json` and `package-lock.json` include `ali-oss` and `@types/ali-oss`.

- [ ] **Step 2: Implement OSS provider**

Replace `src/server/storage/ossStorage.ts` with:

```ts
import OSS from "ali-oss";
import type { RuntimeConfig } from "../runtimeConfig";
import type { ObjectStorageProvider, StoredObject, UploadObjectInput } from "./types";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function createOssStorageProvider(config: RuntimeConfig): ObjectStorageProvider {
  const client = new OSS({
    region: config.oss.region,
    bucket: config.oss.bucket,
    endpoint: config.oss.endpoint,
    accessKeyId: config.oss.accessKeyId,
    accessKeySecret: config.oss.accessKeySecret,
    secure: true,
  });

  const publicBaseUrl = trimTrailingSlash(config.oss.publicBaseUrl);

  return {
    async putObject(input: UploadObjectInput): Promise<StoredObject> {
      await client.put(input.storageKey, input.buffer, {
        headers: {
          "Content-Type": input.mimeType,
        },
      });
      const signedUrl = client.signatureUrl(input.storageKey, {
        expires: config.oss.signedUrlTtlSeconds,
        method: "GET",
      });
      return {
        storageProvider: "oss",
        storageKey: input.storageKey,
        publicUrl: `${publicBaseUrl}/${input.storageKey}`,
        signedUrl,
        sizeBytes: input.buffer.length,
        mimeType: input.mimeType,
        originalName: input.filename,
      };
    },
    async getSignedReadUrl(storageKey: string): Promise<string> {
      return client.signatureUrl(storageKey, {
        expires: config.oss.signedUrlTtlSeconds,
        method: "GET",
      });
    },
    async deleteObject(storageKey: string): Promise<void> {
      await client.delete(storageKey);
    },
  };
}
```

- [ ] **Step 3: Route video and image-asset uploads through providers**

In `server.ts`, create providers after runtime config is built:

```ts
import { createImageAssetStorage, createVideoStorage } from "./src/server/storage";

const videoStorage = createVideoStorage(runtimeConfig);
const imageAssetStorage = createImageAssetStorage(runtimeConfig);
```

Replace video local write:

```ts
await fs.mkdir(path.dirname(localPath), { recursive: true });
await fs.writeFile(localPath, file.buffer);
```

with:

```ts
await videoStorage.putObject({
  buffer: file.buffer,
  mimeType: file.mimetype,
  filename: file.originalname || `${assetId}.${extension}`,
  storageKey,
});
```

Replace image asset local write:

```ts
await fs.mkdir(path.dirname(localPath), { recursive: true });
await fs.writeFile(localPath, file.buffer);
```

with:

```ts
await imageAssetStorage.putObject({
  buffer: file.buffer,
  mimeType: file.mimetype,
  filename: file.originalname || `${assetId}.${extension}`,
  storageKey,
});
```

- [ ] **Step 4: Return signed URLs for OSS video and image assets**

In `mapVideoAssetRow`, replace:

```ts
videoUrl: absoluteUrl(`/api/videos/${encodeURIComponent(row.id)}`, req),
```

with:

```ts
videoUrl: absoluteUrl(`/api/videos/${encodeURIComponent(row.id)}`, req),
```

Keep the API URL in card payloads so auth checks remain centralized.

In `GET /api/videos/:videoId`, replace the `storage_provider !== "local"` 501 branch with:

```ts
if (asset.storage_provider === "oss") {
  const signedUrl = await videoStorage.getSignedReadUrl(asset.storage_key);
  return res.redirect(302, signedUrl);
}
```

In `GET /api/images/:imageId`, replace the `storage_provider !== "local"` 501 branch with:

```ts
if (asset.storage_provider === "oss") {
  const signedUrl = await imageAssetStorage.getSignedReadUrl(asset.storage_key);
  return res.redirect(302, signedUrl);
}
```

- [ ] **Step 5: Delete OSS objects through providers**

In `DELETE /api/videos/:videoId`, replace:

```ts
if (asset.storage_provider === "local") {
  await fs.unlink(storageKeyToLocalPath(asset.storage_key)).catch(() => undefined);
}
```

with:

```ts
if (asset.storage_provider === "oss") {
  await videoStorage.deleteObject(asset.storage_key);
} else {
  await fs.unlink(storageKeyToLocalPath(asset.storage_key)).catch(() => undefined);
}
```

In `DELETE /api/images/:imageId`, replace the equivalent local-only deletion with provider-aware deletion:

```ts
if (asset.storage_provider === "oss") {
  await imageAssetStorage.deleteObject(asset.storage_key);
} else {
  await fs.unlink(imageStorageKeyToLocalPath(asset.storage_key)).catch(() => undefined);
}
```

- [ ] **Step 6: Verify TypeScript and build**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/server/storage/ossStorage.ts server.ts src/server/runtimeConfig.ts
git commit -m "feat: route media assets through oss storage"
```

---

### Task 5: Move Primary Image Upload From PhotoPrism To Configured Provider

**Files:**
- Modify: `server.ts`
- Modify: `src/server/storage/index.ts`
- Modify: `src/server/storage/ossStorage.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Add primary image upload helper**

Add this to `src/server/storage/index.ts`:

```ts
import { storeImageUploadInPhotoPrism } from "../photoprism";
import type { ImageUploadInput } from "../photoprism";

export async function storePrimaryImage(config: RuntimeConfig, image: ImageUploadInput) {
  if (config.primaryImageStorageProvider === "photoprism") {
    return storeImageUploadInPhotoPrism(image);
  }

  const ossStorage = createOssStorageProvider(config);
  const now = Date.now();
  const storageKey = `primary-images/${now.toString(36)}-${Math.random().toString(36).slice(2)}.${image.extension}`;
  const stored = await ossStorage.putObject({
    buffer: image.buffer,
    mimeType: image.mimeType,
    filename: image.filename || `image.${image.extension}`,
    storageKey,
  });

  return {
    photoUid: storageKey,
    photoHash: storageKey,
    imageUrl: stored.publicUrl,
    thumbnailUrl: stored.publicUrl,
  };
}
```

- [ ] **Step 2: Use helper in `/api/store-image`**

In `server.ts`, replace:

```ts
const stored = await storeImageUploadInPhotoPrism(image);
```

with:

```ts
const stored = await storePrimaryImage(runtimeConfig, image);
```

Import:

```ts
import { storePrimaryImage } from "./src/server/storage";
```

- [ ] **Step 3: Keep existing response contract**

Keep the response shape exactly:

```ts
return res.json({
  photoUid: stored.photoUid,
  photoHash: stored.photoHash,
  imageUrl: signedImageUrl(`/api/photos/hash/${encodedHash}/full`, req),
  thumbnailUrl: signedImageUrl(`/api/photos/hash/${encodedHash}/thumb`, req),
});
```

For OSS images, add a branch before `encodedHash`:

```ts
if (runtimeConfig.primaryImageStorageProvider === "oss") {
  return res.json({
    photoUid: stored.photoUid,
    photoHash: stored.photoHash,
    imageUrl: stored.imageUrl,
    thumbnailUrl: stored.thumbnailUrl,
  });
}
```

- [ ] **Step 4: Verify local PhotoPrism mode remains unchanged**

Use `.env.local` with:

```env
IMAGE_STORAGE_PROVIDER=photoprism
```

Run:

```bash
npm run lint
npm run build
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add server.ts src/server/storage/index.ts
git commit -m "feat: make primary image storage provider configurable"
```

---

### Task 6: Document ECS Production Deployment And Backups

**Files:**
- Modify: `README.md`
- Create: `docs/deployment/alibaba-cloud-ecs.md`
- Create: `scripts/backup-postgres.sh`

- [ ] **Step 1: Add backup script**

Create `scripts/backup-postgres.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

docker compose -f docker-compose.production.yml exec -T postgres \
  pg_dump -U postgres -d notebook \
  > "$BACKUP_DIR/inspiration-diary-$TIMESTAMP.sql"

echo "Backup written to $BACKUP_DIR/inspiration-diary-$TIMESTAMP.sql"
```

Run:

```bash
chmod +x scripts/backup-postgres.sh
```

- [ ] **Step 2: Add ECS deployment doc**

Create `docs/deployment/alibaba-cloud-ecs.md`:

```md
# Alibaba Cloud ECS Deployment

Target instance:

- Region: Hangzhou
- Recommended minimum: 2 vCPU, 2 GiB RAM
- Disk: 40 GiB ESSD Entry
- Bandwidth: 3 Mbps fixed bandwidth

This ECS instance should run the app, Postgres, and reverse proxy only. Media files must use OSS in production.

## First deploy

```bash
cp .env.production.example .env.production
npm run config:production
npm run docker:production:detached
docker compose -f docker-compose.production.yml ps
```

## Reverse proxy

Use Caddy or Nginx on the host. Proxy HTTPS traffic to:

```text
http://127.0.0.1:3005
```

## Production storage policy

```env
IMAGE_STORAGE_PROVIDER=oss
VIDEO_STORAGE_PROVIDER=oss
IMAGE_ASSET_STORAGE_PROVIDER=oss
```

PhotoPrism is local-only and must not be required by production.

## Backups

Run:

```bash
./scripts/backup-postgres.sh
```

Upload the generated `.sql` file to OSS or another backup location after each backup.
```

- [ ] **Step 3: Update README environment section**

Replace the Docker section in `README.md` with:

```md
## Docker Environments

Local Docker uses `.env.local` and `docker-compose.local.yml`:

```bash
cp .env.local.example .env.local
npm run config:local
npm run docker:local:detached
```

Production Docker uses `.env.production` and `docker-compose.production.yml`:

```bash
cp .env.production.example .env.production
npm run config:production
npm run docker:production:detached
```

Production should use OSS for `IMAGE_STORAGE_PROVIDER`, `VIDEO_STORAGE_PROVIDER`, and `IMAGE_ASSET_STORAGE_PROVIDER`. Local development can keep PhotoPrism for primary images and local filesystem storage for video/image attachments.
```

- [ ] **Step 4: Verify docs mention no real secrets**

Run:

```bash
rg -n "OSS_ACCESS_KEY_SECRET=.*[A-Za-z0-9]{16,}|AUTH_BOOTSTRAP_PASSWORD=.*[A-Za-z0-9]{8,}|PHOTOPRISM_PASSWORD=.*[A-Za-z0-9]{8,}" README.md docs/deployment .env.local.example .env.production.example
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/deployment/alibaba-cloud-ecs.md scripts/backup-postgres.sh
git commit -m "docs: add ecs deployment and backup guide"
```

---

### Task 7: Final Verification

**Files:**
- Test: full repository verification

- [ ] **Step 1: Validate local config**

Run:

```bash
cp .env.local.example .env.local
npm run config:local
```

Expected: `Runtime config OK for .env.local`.

- [ ] **Step 2: Validate production config with placeholder OSS values**

Run:

```bash
cp .env.production.example .env.production
perl -0pi -e 's/<bucket-name>/inspiration-diary-prod/g; s/<ram-access-key-id>/example-key-id/g; s/<ram-access-key-secret>/example-key-secret/g; s/<first-admin-password>/example-admin-password/g; s/<strong-password>/example-postgres-password/g' .env.production
npm run config:production
```

Expected: `Runtime config OK for .env.production`.

- [ ] **Step 3: Run TypeScript checks**

Run:

```bash
npm run lint
```

Expected: exits with code 0.

- [ ] **Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: Vite and esbuild complete successfully.

- [ ] **Step 5: Build local Docker stack**

Run:

```bash
npm run docker:local:detached
docker compose -f docker-compose.local.yml ps
```

Expected: `app` and `postgres` services are running or healthy.

- [ ] **Step 6: Stop local Docker stack**

Run:

```bash
npm run docker:local:down
```

Expected: local containers stop and named volumes remain.

- [ ] **Step 7: Review git diff for unrelated changes**

Run:

```bash
git status --short
git diff --stat
```

Expected: only files listed in this plan are changed.

- [ ] **Step 8: Final commit if any verification fixes were needed**

```bash
git add .
git commit -m "chore: verify environment configuration workflow"
```

---

## Self-Review

- Spec coverage: The plan covers local configuration, production configuration, Docker split, ECS deployment documentation, storage provider boundaries, OSS media routing, and primary image migration away from PhotoPrism.
- Placeholder scan: Example values are intentionally marked with angle brackets only inside `.env.*.example` templates. Implementation steps include concrete filenames, commands, and code snippets.
- Type consistency: Provider names use `IMAGE_STORAGE_PROVIDER`, `VIDEO_STORAGE_PROVIDER`, and `IMAGE_ASSET_STORAGE_PROVIDER` consistently across runtime config, env examples, Docker, and storage selection.
