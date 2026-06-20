# PhotoPrism Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store newly uploaded inspiration images in PhotoPrism, keep only PhotoPrism URL metadata in PostgreSQL, render thumbnails on cards, and render large images in the zoom modal.

**Architecture:** The React app continues to compress images in the browser, then calls a new backend storage endpoint before saving the card. The backend owns PhotoPrism authentication, upload, finalize, and URL resolution, while existing card CRUD remains the metadata persistence layer. No old base64 card compatibility is required.

**Tech Stack:** React 19, TypeScript, Express, PostgreSQL via `pg`, Docker Compose, PhotoPrism API.

---

## File Structure

- Create `src/server/photoprism.ts`: PhotoPrism config, login, upload, finalize, lookup, and URL construction helpers.
- Modify `server.ts`: import the helper, add `/api/store-image`, and extend PostgreSQL schema/CRUD with `photo_uid` and `thumbnail_url`.
- Modify `src/types.ts`: add `photoUid` and `thumbnailUrl` to `ImageCard`; update `imageUrl` comment to mean large URL.
- Modify `src/lib/dbClient.ts`: send/read `photoUid` and `thumbnailUrl`.
- Modify `src/App.tsx`: upload to PhotoPrism before creating a card; save only URL metadata; keep AI term extraction using the temporary base64 payload.
- Modify `src/components/PolaroidCard.tsx`: render `thumbnailUrl` on board cards.
- Modify `.env.production` and `.env.example` if present: document PhotoPrism env vars without committing real secrets.
- Modify `docker-compose.yml`: pass PhotoPrism env vars through to the app container.
- Modify `README.md`: add PhotoPrism production configuration and verification commands.

## Task 1: Add PhotoPrism Environment and Card Metadata Shape

**Files:**
- Modify: `src/types.ts`
- Modify: `docker-compose.yml`
- Modify: `.env.example` if it exists
- Modify: `.env.production` locally, without committing real secrets

- [ ] **Step 1: Update `ImageCard` type**

Replace `src/types.ts` with:

```ts
export interface ImageCard {
  id: string;
  weekId: string;
  dayIndex: number; // 0: Mon, 1: Tue, 2: Wed, 3: Thu, 4: Fri, 5: Weekend
  imageUrl: string; // Large PhotoPrism image URL
  thumbnailUrl?: string; // PhotoPrism thumbnail URL for board cards
  photoUid?: string; // PhotoPrism photo/file identifier used for traceability
  terms: string[];
  decoType: "tape" | "pin" | "paperclip" | "washi";
  angle: number; // Random value from -3 to 3 for polaroid tilt styling
  createdAt: number;
}

export interface WeeklyNote {
  weekId: string;
  note: string;
  height: number;
}
```

- [ ] **Step 2: Pass PhotoPrism config to Docker app service**

In `docker-compose.yml`, extend the app environment:

```yaml
    environment:
      NODE_ENV: production
      PHOTOPRISM_INTERNAL_URL: ${PHOTOPRISM_INTERNAL_URL:-http://host.docker.internal:2342}
      PHOTOPRISM_PUBLIC_URL: ${PHOTOPRISM_PUBLIC_URL:-http://localhost:2342}
      PHOTOPRISM_USERNAME: ${PHOTOPRISM_USERNAME:-admin}
      PHOTOPRISM_PASSWORD: ${PHOTOPRISM_PASSWORD}
```

- [ ] **Step 3: Add local production env values**

Add these lines to `.env.production` on the user's machine:

```env
PHOTOPRISM_INTERNAL_URL=http://host.docker.internal:2342
PHOTOPRISM_PUBLIC_URL=http://localhost:2342
PHOTOPRISM_USERNAME=admin
PHOTOPRISM_PASSWORD=<server-side-secret>
```

Do not commit the real password. If `.env.production` is ignored, leaving the real password there is acceptable.

- [ ] **Step 4: Run type check**

Run:

```bash
npm run lint
```

Expected: TypeScript completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts docker-compose.yml .env.example
git commit -m "配置 PhotoPrism 图片元数据"
```

If `.env.example` does not exist, omit it from `git add`.

## Task 2: Implement PhotoPrism Backend Helper

**Files:**
- Create: `src/server/photoprism.ts`

- [ ] **Step 1: Create helper module**

Create `src/server/photoprism.ts` with:

```ts
export interface StoredPhotoPrismImage {
  photoUid: string;
  imageUrl: string;
  thumbnailUrl: string;
}

interface PhotoPrismSession {
  authToken: string;
  userUid: string;
}

interface PhotoPrismConfig {
  internalUrl: string;
  publicUrl: string;
  username: string;
  password: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getConfig(): PhotoPrismConfig {
  const internalUrl = process.env.PHOTOPRISM_INTERNAL_URL || "";
  const publicUrl = process.env.PHOTOPRISM_PUBLIC_URL || internalUrl;
  const username = process.env.PHOTOPRISM_USERNAME || "";
  const password = process.env.PHOTOPRISM_PASSWORD || "";

  if (!internalUrl || !publicUrl || !username || !password) {
    throw new Error("PhotoPrism is not configured. Set PHOTOPRISM_INTERNAL_URL, PHOTOPRISM_PUBLIC_URL, PHOTOPRISM_USERNAME, and PHOTOPRISM_PASSWORD.");
  }

  return {
    internalUrl: trimTrailingSlash(internalUrl),
    publicUrl: trimTrailingSlash(publicUrl),
    username,
    password,
  };
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string; extension: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image data URL.");
  }

  const mimeType = match[1];
  const extension = mimeType.includes("png") ? "png" : "jpg";
  return {
    buffer: Buffer.from(match[2], "base64"),
    mimeType,
    extension,
  };
}

function generateUploadToken(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 7; i += 1) {
    token += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return token;
}

function buildHeaders(authToken: string): HeadersInit {
  return {
    "X-Auth-Token": authToken,
    "X-Client-Version": "inspiration-diary",
  };
}

async function login(config: PhotoPrismConfig): Promise<PhotoPrismSession> {
  const response = await fetch(`${config.internalUrl}/api/v1/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: config.username,
      password: config.password,
    }),
  });

  if (!response.ok) {
    throw new Error(`PhotoPrism login failed with status ${response.status}.`);
  }

  const body: any = await response.json();
  const authToken = body.access_token || body.id;
  const userUid = body.user?.UID || "u000000000000001";

  if (!authToken) {
    throw new Error("PhotoPrism login did not return an auth token.");
  }

  return { authToken, userUid };
}

async function uploadFile(config: PhotoPrismConfig, session: PhotoPrismSession, imageBase64: string, filename: string): Promise<void> {
  const decoded = decodeDataUrl(imageBase64);
  const formData = new FormData();
  const blob = new Blob([decoded.buffer], { type: decoded.mimeType });
  formData.append("files", blob, filename);

  const token = filename.split(".")[0].slice(-7);
  const response = await fetch(`${config.internalUrl}/api/v1/users/${session.userUid}/upload/${token}`, {
    method: "POST",
    headers: buildHeaders(session.authToken),
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PhotoPrism upload failed with status ${response.status}: ${text}`);
  }

  const finalizeResponse = await fetch(`${config.internalUrl}/api/v1/users/${session.userUid}/upload/${token}`, {
    method: "PUT",
    headers: {
      ...buildHeaders(session.authToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ albums: [] }),
  });

  if (!finalizeResponse.ok) {
    const text = await finalizeResponse.text();
    throw new Error(`PhotoPrism finalize failed with status ${finalizeResponse.status}: ${text}`);
  }
}

async function findUploadedPhoto(config: PhotoPrismConfig, session: PhotoPrismSession, filename: string): Promise<any> {
  const query = encodeURIComponent(filename);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(`${config.internalUrl}/api/v1/photos?count=1&q=${query}`, {
      headers: buildHeaders(session.authToken),
    });

    if (response.ok) {
      const photos: any[] = await response.json();
      const photo = photos.find((item) => item && (item.Name === filename || item.OriginalName === filename || item.PhotoUID));
      if (photo) {
        return photo;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw new Error("PhotoPrism uploaded photo was not found after indexing.");
}

export async function storeImageInPhotoPrism(imageBase64: string): Promise<StoredPhotoPrismImage> {
  const config = getConfig();
  const session = await login(config);
  const decoded = decodeDataUrl(imageBase64);
  const uploadToken = generateUploadToken();
  const filename = `inspiration-${Date.now()}-${uploadToken}.${decoded.extension}`;

  await uploadFile(config, session, imageBase64, filename);

  const photo = await findUploadedPhoto(config, session, filename);
  const hash = photo.Hash || photo.FileHash || photo.Files?.[0]?.Hash;
  const photoUid = photo.UID || photo.PhotoUID || photo.Files?.[0]?.PhotoUID || filename;

  if (!hash) {
    throw new Error("PhotoPrism photo hash is missing.");
  }

  return {
    photoUid,
    thumbnailUrl: `${config.publicUrl}/api/v1/t/${hash}/public/fit_720`,
    imageUrl: `${config.publicUrl}/api/v1/dl/${hash}?t=public`,
  };
}
```

- [ ] **Step 2: Run type check**

Run:

```bash
npm run lint
```

Expected: TypeScript completes with no errors. If Node's `FormData` or `Blob` types are missing, use the Node 22 global types already available through the project.

- [ ] **Step 3: Commit**

```bash
git add src/server/photoprism.ts
git commit -m "添加 PhotoPrism 上传助手"
```

## Task 3: Add Backend Storage Route and Card Schema Columns

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: Import PhotoPrism helper**

Add near the top of `server.ts`:

```ts
import { storeImageInPhotoPrism } from "./src/server/photoprism";
```

- [ ] **Step 2: Add storage endpoint**

Add this route after the existing `/api/analyze-image` route:

```ts
app.post("/api/store-image", async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64 in request body." });
    }

    const stored = await storeImageInPhotoPrism(imageBase64);
    return res.json(stored);
  } catch (error: any) {
    console.error("PhotoPrism image storage error:", error);
    return res.status(500).json({ error: error.message || "PhotoPrism image storage failed." });
  }
});
```

- [ ] **Step 3: Extend PostgreSQL schema**

In `initDb`, after the `CREATE TABLE IF NOT EXISTS cards` query, add:

```ts
await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS photo_uid TEXT;");
await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;");
```

- [ ] **Step 4: Extend card read mapping**

Update the card select query fields to include `photo_uid, thumbnail_url` and map them:

```ts
photoUid: row.photo_uid || "",
thumbnailUrl: row.thumbnail_url || "",
```

- [ ] **Step 5: Extend card insert/upsert**

Update request destructuring:

```ts
const { id, weekId, dayIndex, imageUrl, thumbnailUrl, photoUid, terms, decoType, angle, createdAt } = req.body;
```

Update SQL:

```sql
INSERT INTO cards (id, week_id, day_index, image_url, thumbnail_url, photo_uid, terms, deco_type, angle, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (id)
DO UPDATE SET week_id = EXCLUDED.week_id,
              day_index = EXCLUDED.day_index,
              image_url = EXCLUDED.image_url,
              thumbnail_url = EXCLUDED.thumbnail_url,
              photo_uid = EXCLUDED.photo_uid,
              terms = EXCLUDED.terms,
              deco_type = EXCLUDED.deco_type,
              angle = EXCLUDED.angle,
              created_at = EXCLUDED.created_at
```

Use values:

```ts
[id, weekId, dayIndex, imageUrl, thumbnailUrl || "", photoUid || "", terms, decoType, angle, createdAt || Date.now()]
```

- [ ] **Step 6: Run type check and build**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands complete successfully.

- [ ] **Step 7: Commit**

```bash
git add server.ts
git commit -m "添加 PhotoPrism 存储接口"
```

## Task 4: Persist and Render PhotoPrism URL Metadata

**Files:**
- Modify: `src/lib/dbClient.ts`
- Modify: `src/components/PolaroidCard.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Update client card persistence**

In `src/lib/dbClient.ts`, no special transform is needed for saving because the whole card object is already posted. Ensure fetched cards include new fields from API responses and Firestore fallback remains type-compatible:

```ts
photoUid: row.photoUid || row.photo_uid || "",
thumbnailUrl: row.thumbnailUrl || row.thumbnail_url || "",
```

For the existing API path, if `fetchCardsFromApi()` returns camelCase from the server, no extra change is needed beyond preserving the returned object.

- [ ] **Step 2: Render thumbnails on board cards**

In `src/components/PolaroidCard.tsx`, replace:

```tsx
src={card.imageUrl}
```

with:

```tsx
src={card.thumbnailUrl || card.imageUrl}
```

- [ ] **Step 3: Store image in PhotoPrism before saving a card**

In `src/App.tsx`, add a helper inside `handleUploadImage` before creating `newCard`:

```ts
const storeResponse = await fetch("/api/store-image", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ imageBase64: base64Data }),
});

if (!storeResponse.ok) {
  const rawErrorText = await storeResponse.text();
  let message = rawErrorText;
  try {
    const parsed = JSON.parse(rawErrorText);
    message = parsed.error || message;
  } catch {
    // keep raw response text
  }
  throw new Error(message || `PhotoPrism upload failed with status ${storeResponse.status}`);
}

const storedImage = await storeResponse.json();
```

Then set the card image fields:

```ts
imageUrl: storedImage.imageUrl,
thumbnailUrl: storedImage.thumbnailUrl,
photoUid: storedImage.photoUid,
```

Keep the AI extraction payload as `base64Data` so keyword analysis still works without downloading from PhotoPrism.

- [ ] **Step 4: Run type check and build**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands complete successfully.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dbClient.ts src/components/PolaroidCard.tsx src/App.tsx
git commit -m "使用 PhotoPrism URL 渲染图片"
```

## Task 5: Document PhotoPrism Runtime Setup

**Files:**
- Modify: `README.md`
- Modify: `.env.example` if it exists

- [ ] **Step 1: Add README section**

Add:

```md
## PhotoPrism Image Storage

New image uploads are stored in PhotoPrism. PostgreSQL stores only URL metadata.

Required production environment variables:

```env
PHOTOPRISM_INTERNAL_URL=http://host.docker.internal:2342
PHOTOPRISM_PUBLIC_URL=http://localhost:2342
PHOTOPRISM_USERNAME=admin
PHOTOPRISM_PASSWORD=<server-side-secret>
```

`PHOTOPRISM_INTERNAL_URL` is used by the Docker app container. `PHOTOPRISM_PUBLIC_URL` is used in saved image URLs rendered by the browser.

After changing PhotoPrism settings, rebuild the production container:

```bash
npm run docker:prod:detached
```
```

- [ ] **Step 2: Run markdown-safe review**

Run:

```bash
rg -n "PHOTOPRISM_PASSWORD=.*[A-Za-z0-9]{12,}" README.md .env.example
```

Expected: no output, because real passwords must not be committed.

- [ ] **Step 3: Commit**

```bash
git add README.md .env.example
git commit -m "记录 PhotoPrism 存储配置"
```

If `.env.example` does not exist, omit it from `git add`.

## Task 6: Production Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Rebuild production Docker**

Run:

```bash
npm run docker:prod:detached
```

Expected: `inspiration-diary-app-1` starts on port `3005`.

- [ ] **Step 2: Verify service health**

Run:

```bash
curl -I http://localhost:3005
curl -sS http://localhost:2342/api/v1/status
```

Expected:

```text
HTTP/1.1 200 OK
{"status":"operational"}
```

- [ ] **Step 3: Upload a new image from the app**

Open `http://localhost:3005`, paste or choose an image, then confirm a new card appears.

- [ ] **Step 4: Confirm database stores URLs, not base64**

Run a read-only query:

```bash
node --input-type=module -e 'import dotenv from "dotenv"; import pg from "pg"; dotenv.config({path:".env"}); const pool=new pg.Pool({connectionString:process.env.DATABASE_URL, ssl:process.env.DATABASE_SSL === "true" ? {rejectUnauthorized:false}: false}); const rows=await pool.query("select image_url, thumbnail_url, photo_uid from cards order by created_at desc limit 3"); console.log(JSON.stringify(rows.rows,null,2)); await pool.end();'
```

Expected:

```json
[
  {
    "image_url": "http://localhost:2342/api/v1/dl/examplehash?t=public",
    "thumbnail_url": "http://localhost:2342/api/v1/t/examplehash/public/fit_720",
    "photo_uid": "example-photo-uid"
  }
]
```

- [ ] **Step 5: Commit any final corrections**

If verification reveals small fixes, commit them:

```bash
git status --short
git add <changed-files>
git commit -m "修正 PhotoPrism 存储验证问题"
```

If there are no source changes, do not create an empty commit.

## Self-Review

- Spec coverage: backend proxy upload, server-side credentials, URL-only database storage, thumbnail rendering, large zoom rendering, and no old-data migration are all covered.
- Placeholder scan: no placeholder markers or unspecified implementation steps remain.
- Type consistency: the plan uses `photoUid`, `thumbnailUrl`, and `imageUrl` consistently across `ImageCard`, server responses, database fields, and rendering.
