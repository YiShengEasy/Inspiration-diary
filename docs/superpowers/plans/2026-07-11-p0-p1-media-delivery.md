# P0 + P1 Media Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move OSS media bytes off ECS, stream mini-program videos without predownload, and serve purpose-sized images while retaining the proxy rollback path.

**Architecture:** Existing authenticated application media URLs remain stable. Each protected route either proxies bytes or redirects to a short-lived OSS URL according to `MEDIA_DELIVERY_MODE`; image routes encode their variant in the signed path. DTOs expose thumbnail, detail, and original URLs while existing consumers continue to work.

**Tech Stack:** Express, TypeScript, PostgreSQL, ali-oss, React, WeChat Mini Program JavaScript/WXML.

---

### Task 1: Runtime Media Configuration

**Files:**
- Modify: `src/server/runtimeConfig.ts`
- Modify: `.env.example`
- Modify: `.env.local.example`
- Modify: `.env.production.example`
- Modify: `scripts/validate-runtime-config.ts`

- [x] **Step 1: Add the delivery mode type and parser**

```ts
export type MediaDeliveryMode = "proxy" | "oss";

function parseMediaDeliveryMode(value: string): MediaDeliveryMode {
  return value === "oss" ? "oss" : "proxy";
}
```

- [x] **Step 2: Preserve the raw value for validation**

Add `mediaDeliveryMode` to `RuntimeConfig`, populate it from `MEDIA_DELIVERY_MODE`, and return `MEDIA_DELIVERY_MODE must be proxy or oss.` when a non-empty unsupported value is configured.

- [x] **Step 3: Add example values**

```dotenv
MEDIA_DELIVERY_MODE=proxy
OSS_THUMB_240_PROCESS=image/resize,w_240/quality,Q_70/format,webp
OSS_THUMB_480_PROCESS=image/resize,w_480/quality,Q_75/format,webp
OSS_DETAIL_1280_PROCESS=image/resize,w_1280/quality,Q_82/format,webp
OSS_VIDEO_POSTER_PROCESS=video/snapshot,t_1000,f_jpg,w_720
```

- [x] **Step 4: Verify configuration**

Run: `npm run config:validate`

Expected: the repository's local and production example checks pass; an explicit unsupported mode returns the new validation error.

### Task 2: Shared Media Delivery Helper

**Files:**
- Create: `src/server/mediaDelivery.ts`
- Modify: `server.ts`

- [x] **Step 1: Add image variant definitions**

```ts
export type ImageVariant = "thumb-240" | "thumb-480" | "detail-1280" | "original";

export function imageProcessFor(variant: ImageVariant, processes: MediaProcesses): string | undefined {
  if (variant === "original") return undefined;
  return processes[variant];
}
```

- [x] **Step 2: Add proxy-or-redirect delivery**

```ts
export async function deliverOssObject(input: DeliverOssObjectInput) {
  const signedUrl = await input.storage.getSignedReadUrl(input.storageKey, { process: input.process });
  if (input.mode === "oss") return input.res.redirect(302, signedUrl);
  return input.proxy(signedUrl);
}
```

The helper must never redirect local storage and must convert signing failures into the caller's existing 502 path.

- [x] **Step 3: Wire existing OSS routes through the helper**

Replace direct `proxySignedObjectUrl()` calls for primary images, image assets, combo images, video posters, videos, and combo generation videos.

- [x] **Step 4: Verify TypeScript**

Run: `npm run lint`

Expected: `tsc --noEmit` exits 0.

### Task 3: Purpose-Specific Image Routes and DTOs

**Files:**
- Modify: `server.ts`
- Modify: `src/types.ts`

- [x] **Step 1: Add primary image paths**

```ts
primaryObjectUrl(key, req, "thumb-240")
primaryObjectUrl(key, req, "thumb-480")
primaryObjectUrl(key, req, "detail-1280")
primaryObjectUrl(key, req, "original")
```

Each value maps to a distinct signed pathname and the corresponding OSS process.

- [x] **Step 2: Add image asset and combo image variant routes**

Expose `/thumb-240`, `/thumb-480`, `/detail-1280`, and `/original` routes. Route handlers must repeat the existing owner/signed-request database check before delivery.

- [x] **Step 3: Extend mapped values**

```ts
interface ImageCard {
  thumbnail240Url?: string;
  originalImageUrl?: string;
}

interface ImageAsset {
  thumbnailUrl?: string;
  originalImageUrl?: string;
}
```

For OSS-backed rows, `thumbnailUrl` is `thumb-480`, `imageUrl` is `detail-1280`, and `originalImageUrl` is `original`. Local and PhotoPrism values retain compatible fallbacks.

- [x] **Step 4: Verify route signatures**

Run: `npm run lint`

Expected: all mapper callers compile without becoming asynchronous.

### Task 4: Mini Program Streaming and Image Loading

**Files:**
- Modify: `miniprogram/app/pages/card-detail/index.js`
- Modify: `miniprogram/app/pages/card-detail/index.wxml`
- Modify: `miniprogram/app/pages/diary/index.js`
- Modify: `miniprogram/app/pages/day-detail/index.js`
- Modify: `miniprogram/app/pages/search/index.js`
- Modify: `miniprogram/app/pages/books/index.js`
- Modify: `miniprogram/app/pages/me/index.js`
- Modify: corresponding page WXML files containing remote `<image>` elements

- [x] **Step 1: Remove browse-time downloads**

```js
function hydrateCardMedia(card) {
  return Promise.resolve(card);
}
```

Then remove the helper entirely and use `resolveAssetUrl()` in normalizers. Keep `downloadFileForSave()` for explicit save actions.

- [x] **Step 2: Use original URLs for save**

```js
const imageUrl = card.originalImageUrl || card.image;
const filePath = await downloadFileForSave(imageUrl);
```

- [x] **Step 3: Stop video contexts on unload**

Give video nodes stable IDs, create their contexts after data load, and call `stop()` from `onUnload`.

- [x] **Step 4: Enable lazy images**

Add `lazy-load="true"` to non-critical remote image nodes while retaining fixed-size containers.

- [x] **Step 5: Run syntax checks**

Run: `find miniprogram/app/pages -name '*.js' -print0 | xargs -0 -n1 node --check`

Expected: every file exits 0.

### Task 5: Web Detail and Download Behavior

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ComboCardDetail.tsx`
- Modify: `src/components/PolaroidCard.tsx`
- Modify: `src/components/InspirationBooksView.tsx`

- [x] **Step 1: Use detail URLs for viewing and original URLs for downloads**

```tsx
const downloadUrl = image.originalImageUrl || image.imageUrl;
<img src={image.imageUrl} loading="lazy" decoding="async" />
```

- [x] **Step 2: Complete lazy decoding coverage**

Add `loading="lazy" decoding="async"` to non-critical card, book cover, combo, and bound image elements. Preserve already lazy elements.

- [x] **Step 3: Ensure video nodes unmount with detail state**

Keep video rendering conditional on the active detail/card. No persistent hidden player may remain after the modal or combo detail closes.

- [x] **Step 4: Verify Web build**

Run: `npm run lint && npm run build`

Expected: both commands exit 0; only existing bundle-size warnings may remain.

### Task 6: Delivery Verification

**Files:**
- Create: `scripts/media-delivery-smoke.ts`
- Modify: `package.json`

- [x] **Step 1: Add deterministic helper assertions**

The smoke script asserts every image variant maps to the expected process, proxy mode invokes the proxy callback, OSS mode returns a 302 Location, and invalid runtime mode validation fails.

- [x] **Step 2: Add the script command**

```json
"media:smoke": "tsx scripts/media-delivery-smoke.ts"
```

- [x] **Step 3: Run all checks**

Run: `npm run media:smoke && npm run config:validate && npm run lint && npm run build`

Expected: smoke, config, typecheck, and production build pass.

- [x] **Step 4: Inspect final diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only P0/P1 implementation files plus pre-existing ignored/untracked prototype files are present.
