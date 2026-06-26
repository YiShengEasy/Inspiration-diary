# Video Watermark Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a WeChat mini-program toolbox tool that parses a public short-video share link, previews the result, and saves the resolved video to the photo album through a backend provider adapter.

**Architecture:** The mini-program adds a dedicated `pages/video-watermark/index` page and a toolbox card entry. The backend exposes `POST /api/miniprogram/video-watermark/parse` and delegates third-party parsing to `src/server/videoResolver.ts`, keeping provider details and keys out of the mini-program.

**Tech Stack:** Native WeChat mini-program WXML/WXSS/JS, Express in `server.ts`, TypeScript provider module, existing `request` helper, `npm run lint`, `npm run build`.

---

## File Structure

- Create: `src/server/videoResolver.ts`
  - Owns URL validation, provider selection, TikWM-style parsing, timeout handling, and result normalization.
- Modify: `server.ts`
  - Imports `resolveVideoShareUrl` and adds `POST /api/miniprogram/video-watermark/parse` near existing mini-program routes.
- Create: `scripts/video-watermark-smoke.mjs`
  - Exercises backend validation and mock provider success without hitting a real third-party network during tests.
- Modify: `package.json`
  - Adds `video:smoke` script.
- Modify: `miniprogram/app/app.json`
  - Registers `pages/video-watermark/index`.
- Modify: `miniprogram/app/utils/tools.js`
  - Adds `videoWatermark` tool metadata.
- Modify: `miniprogram/app/pages/toolbox/index.js`
  - Adds `videoWatermark` to the common tools list and routes it to the new page.
- Create: `miniprogram/app/pages/video-watermark/index.json`
  - Page title config.
- Create: `miniprogram/app/pages/video-watermark/index.js`
  - Handles input, paste, parse, copy, download, save, and permission fallback.
- Create: `miniprogram/app/pages/video-watermark/index.wxml`
  - Renders the confirmed warm-paper UI.
- Create: `miniprogram/app/pages/video-watermark/index.wxss`
  - Styles the page with existing mini-program design tokens.

## Task 1: Backend Provider Module

**Files:**
- Create: `src/server/videoResolver.ts`
- Verify through: `scripts/video-watermark-smoke.mjs` in Task 2

- [ ] **Step 1: Create provider types and URL validation**

Add `src/server/videoResolver.ts`:

```ts
export type VideoResolveResult = {
  title: string;
  coverUrl?: string;
  videoUrl: string;
  sourceUrl: string;
  duration?: number;
  provider: string;
};

export class VideoResolveError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "VideoResolveError";
    this.status = status;
  }
}

function validateInputUrl(inputUrl: string): URL {
  if (typeof inputUrl !== "string" || !inputUrl.trim()) {
    throw new VideoResolveError("请输入视频分享链接", 400);
  }
  if (inputUrl.length > 2048) {
    throw new VideoResolveError("链接太长，请重新复制分享链接", 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(inputUrl.trim());
  } catch {
    throw new VideoResolveError("链接格式不正确", 400);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new VideoResolveError("链接格式不正确", 400);
  }

  return parsed;
}
```

- [ ] **Step 2: Add timeout fetch helper**

Append to `src/server/videoResolver.ts`:

```ts
async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: any = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new VideoResolveError("解析服务返回格式异常", 502);
      }
    }
    if (!response.ok) {
      throw new VideoResolveError(body?.error || body?.message || "解析服务请求失败", 502);
    }
    return body;
  } catch (err: unknown) {
    if (err instanceof VideoResolveError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new VideoResolveError("解析超时，请稍后再试", 504);
    }
    throw new VideoResolveError("解析服务暂不可用", 502);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 3: Add TikWM-style provider normalization**

Append to `src/server/videoResolver.ts`:

```ts
function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numeric = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return undefined;
}

function normalizeTikwmResponse(body: any, sourceUrl: string): VideoResolveResult {
  const data = body?.data || body?.result || body;
  const videoUrl = pickString(
    data?.play,
    data?.wmplay,
    data?.hdplay,
    data?.videoUrl,
    data?.video_url,
    data?.download_url
  );

  if (!videoUrl) {
    throw new VideoResolveError("解析失败，请换个链接或稍后再试", 502);
  }

  return {
    title: pickString(data?.title, data?.desc, data?.description) || "未命名视频",
    coverUrl: pickString(data?.cover, data?.origin_cover, data?.thumbnail, data?.coverUrl) || undefined,
    videoUrl,
    sourceUrl,
    duration: pickNumber(data?.duration, data?.duration_ms && Number(data.duration_ms) / 1000),
    provider: "tikwm",
  };
}
```

- [ ] **Step 4: Add exported resolver**

Append to `src/server/videoResolver.ts`:

```ts
export async function resolveVideoShareUrl(inputUrl: string): Promise<VideoResolveResult> {
  const parsed = validateInputUrl(inputUrl);
  const provider = (process.env.VIDEO_RESOLVER_PROVIDER || "tikwm").trim().toLowerCase();
  const timeoutMs = Math.max(3000, Number.parseInt(process.env.VIDEO_RESOLVER_TIMEOUT_MS || "12000", 10) || 12000);

  if (provider !== "tikwm") {
    throw new VideoResolveError("当前解析服务未配置", 503);
  }

  const baseUrl = (process.env.VIDEO_RESOLVER_BASE_URL || "https://www.tikwm.com").replace(/\/+$/, "");
  const endpoint = `${baseUrl}/api/`;
  const body = await fetchJsonWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ url: parsed.toString(), count: "12", cursor: "0", web: "1", hd: "1" }),
    },
    timeoutMs
  );

  return normalizeTikwmResponse(body, parsed.toString());
}
```

- [ ] **Step 5: Run TypeScript check**

Run:

```bash
npm run lint
```

Expected: PASS or existing unrelated errors only. If TypeScript reports a new error in `src/server/videoResolver.ts`, fix it before continuing.

## Task 2: Backend Route and Smoke Test

**Files:**
- Modify: `server.ts`
- Create: `scripts/video-watermark-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Import the resolver in `server.ts`**

Add near existing server imports:

```ts
import { resolveVideoShareUrl, VideoResolveError } from "./src/server/videoResolver";
```

- [ ] **Step 2: Add parse route near existing mini-program routes**

Add after `app.post("/api/miniprogram/tool-usage"...`:

```ts
app.post("/api/miniprogram/video-watermark/parse", requirePostgresAuth, async (req, res) => {
  try {
    const inputUrl = typeof req.body?.url === "string" ? req.body.url : "";
    const result = await resolveVideoShareUrl(inputUrl);
    return res.json(result);
  } catch (err: unknown) {
    if (err instanceof VideoResolveError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("Video watermark parse error:", err);
    return res.status(500).json({ error: "解析失败，请稍后再试" });
  }
});
```

- [ ] **Step 3: Create smoke script**

Create `scripts/video-watermark-smoke.mjs`:

```js
import assert from "node:assert/strict";
import { resolveVideoShareUrl, VideoResolveError } from "../src/server/videoResolver.ts";

async function run() {
  await assert.rejects(
    () => resolveVideoShareUrl(""),
    (err) => err instanceof VideoResolveError && err.status === 400 && err.message === "请输入视频分享链接"
  );

  await assert.rejects(
    () => resolveVideoShareUrl("not-a-url"),
    (err) => err instanceof VideoResolveError && err.status === 400 && err.message === "链接格式不正确"
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          title: "测试视频标题",
          cover: "https://example.com/cover.jpg",
          play: "https://example.com/video.mp4",
          duration: 17,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  try {
    const result = await resolveVideoShareUrl("https://v.douyin.com/Q8jcHD9COHo/");
    assert.equal(result.title, "测试视频标题");
    assert.equal(result.coverUrl, "https://example.com/cover.jpg");
    assert.equal(result.videoUrl, "https://example.com/video.mp4");
    assert.equal(result.duration, 17);
    assert.equal(result.provider, "tikwm");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("video watermark smoke passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Add npm script**

Modify `package.json` scripts:

```json
"video:smoke": "tsx scripts/video-watermark-smoke.mjs"
```

Keep existing scripts unchanged.

- [ ] **Step 5: Run smoke and lint**

Run:

```bash
npm run video:smoke
npm run lint
```

Expected:

```text
video watermark smoke passed
```

and `npm run lint` passes.

- [ ] **Step 6: Commit backend route**

Run:

```bash
git add src/server/videoResolver.ts server.ts scripts/video-watermark-smoke.mjs package.json
git commit -m "feat: add video watermark resolver API"
```

## Task 3: Mini-Program Page

**Files:**
- Modify: `miniprogram/app/app.json`
- Create: `miniprogram/app/pages/video-watermark/index.json`
- Create: `miniprogram/app/pages/video-watermark/index.js`
- Create: `miniprogram/app/pages/video-watermark/index.wxml`
- Create: `miniprogram/app/pages/video-watermark/index.wxss`

- [ ] **Step 1: Register page**

Add the new page near toolbox in `miniprogram/app/app.json`:

```json
"pages/video-watermark/index"
```

The pages list should begin:

```json
"pages": [
  "pages/toolbox/index",
  "pages/video-watermark/index",
  "pages/diary/index"
]
```

- [ ] **Step 2: Add page config**

Create `miniprogram/app/pages/video-watermark/index.json`:

```json
{
  "navigationBarTitleText": "视频去水印",
  "navigationBarBackgroundColor": "#fffaf1",
  "navigationBarTextStyle": "black"
}
```

- [ ] **Step 3: Add page logic**

Create `miniprogram/app/pages/video-watermark/index.js`:

```js
const { request } = require("../../utils/api");

function getResultTitle(result) {
  return (result && result.title) || "";
}

Page({
  data: {
    inputUrl: "",
    parsing: false,
    saving: false,
    error: "",
    result: null
  },

  onInput(event) {
    this.setData({ inputUrl: event.detail.value, error: "" });
  },

  clearInput() {
    this.setData({ inputUrl: "", result: null, error: "" });
  },

  pasteLink() {
    wx.getClipboardData({
      success: (res) => {
        this.setData({ inputUrl: res.data || "", error: "" });
      },
      fail: () => wx.showToast({ title: "读取剪贴板失败", icon: "none" })
    });
  },

  async parseVideo() {
    const url = this.data.inputUrl.trim();
    if (!url) {
      wx.showToast({ title: "请输入视频分享链接", icon: "none" });
      return;
    }

    this.setData({ parsing: true, error: "" });
    try {
      const result = await request({
        url: "/api/miniprogram/video-watermark/parse",
        method: "POST",
        data: { url }
      });
      this.setData({ result, inputUrl: result.sourceUrl || url });
    } catch (err) {
      const message = err.message || "解析失败，请稍后再试";
      this.setData({ error: message, result: null });
      wx.showToast({ title: message, icon: "none" });
    } finally {
      this.setData({ parsing: false });
    }
  },

  copyTitle() {
    const title = getResultTitle(this.data.result);
    if (!title) return;
    wx.setClipboardData({ data: title });
  },

  copyLink() {
    const link = (this.data.result && this.data.result.videoUrl) || "";
    if (!link) return;
    wx.setClipboardData({ data: link });
  },

  saveVideo() {
    const videoUrl = this.data.result && this.data.result.videoUrl;
    if (!videoUrl) {
      wx.showToast({ title: "请先解析视频", icon: "none" });
      return;
    }

    this.setData({ saving: true });
    wx.downloadFile({
      url: videoUrl,
      success: (downloadRes) => {
        if (downloadRes.statusCode < 200 || downloadRes.statusCode >= 300 || !downloadRes.tempFilePath) {
          wx.showToast({ title: "视频下载失败", icon: "none" });
          return;
        }
        wx.saveVideoToPhotosAlbum({
          filePath: downloadRes.tempFilePath,
          success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
          fail: () => {
            wx.showModal({
              title: "需要相册权限",
              content: "请允许保存到相册后重试。",
              confirmText: "去设置",
              success: (modalRes) => {
                if (modalRes.confirm) wx.openSetting();
              }
            });
          }
        });
      },
      fail: () => wx.showToast({ title: "视频下载失败", icon: "none" }),
      complete: () => this.setData({ saving: false })
    });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/toolbox/index" }) });
  }
});
```

- [ ] **Step 4: Add WXML**

Create `miniprogram/app/pages/video-watermark/index.wxml`:

```xml
<view class="page video-page">
  <view class="hero-card">
    <text class="hero-kicker">SHORT VIDEO</text>
    <text class="hero-title">视频去水印</text>
    <text class="hero-desc">粘贴公开视频分享链接，解析后保存到相册。</text>
  </view>

  <view class="input-card">
    <text class="card-label">粘贴视频分享链接</text>
    <textarea class="link-input" value="{{inputUrl}}" placeholder="https://v.douyin.com/..." maxlength="2048" bindinput="onInput" />
    <view class="action-row">
      <button class="ghost-button" bindtap="clearInput">清空</button>
      <button class="dark-button" bindtap="pasteLink">粘贴</button>
      <button class="lime-button" loading="{{parsing}}" bindtap="parseVideo">解析</button>
    </view>
  </view>

  <view wx:if="{{error}}" class="error-card">
    <text>{{error}}</text>
  </view>

  <view wx:if="{{result}}" class="result-section">
    <view class="section-head">
      <text class="section-title">解析结果</text>
      <text class="section-note">仅保存授权内容</text>
    </view>

    <view class="result-card">
      <view class="preview-wrap">
        <video class="video-preview" src="{{result.videoUrl}}" poster="{{result.coverUrl}}" controls show-center-play-btn object-fit="contain"></video>
        <text wx:if="{{result.duration}}" class="duration">{{result.duration}}s</text>
      </view>
      <view class="result-body">
        <text class="result-title">{{result.title}}</text>
        <view class="button-grid">
          <button class="outline-button" bindtap="copyTitle">复制标题</button>
          <button class="save-button" loading="{{saving}}" bindtap="saveVideo">保存视频</button>
        </view>
        <button class="copy-link-button" bindtap="copyLink">复制链接</button>
      </view>
    </view>
  </view>

  <view class="notice-card">
    <text>仅支持公开、自己发布或已授权的视频内容。保存视频需要相册权限。</text>
  </view>
</view>
```

- [ ] **Step 5: Add WXSS**

Create `miniprogram/app/pages/video-watermark/index.wxss`:

```css
.video-page {
  min-height: 100vh;
  padding: 31rpx 31rpx 170rpx;
  background: linear-gradient(#fffaf1, #f4efe4);
  color: #111111;
  box-sizing: border-box;
}

button {
  margin: 0;
  padding: 0;
  border: 0;
  line-height: 1;
}

button::after {
  border: 0;
}

.hero-card,
.input-card,
.result-card,
.notice-card,
.error-card {
  border-radius: 31rpx;
  background: #ffffff;
  box-shadow: 0 24rpx 64rpx rgba(96, 76, 46, 0.12);
  box-sizing: border-box;
}

.hero-card {
  padding: 31rpx;
  background: linear-gradient(135deg, #151515, #22291e);
  color: #ffffff;
  overflow: hidden;
}

.hero-kicker,
.hero-title,
.hero-desc,
.card-label,
.section-title,
.section-note,
.result-title,
.notice-card text,
.error-card text {
  display: block;
}

.hero-kicker {
  color: #b7ff38;
  font-size: 21rpx;
  line-height: 25rpx;
  font-weight: 950;
}

.hero-title {
  margin-top: 14rpx;
  font-size: 52rpx;
  line-height: 58rpx;
  font-weight: 950;
}

.hero-desc {
  margin-top: 14rpx;
  color: rgba(255, 255, 255, 0.68);
  font-size: 23rpx;
  line-height: 31rpx;
  font-weight: 800;
}

.input-card {
  margin-top: 28rpx;
  padding: 28rpx;
}

.card-label {
  margin-bottom: 17rpx;
  color: #5742c8;
  font-size: 23rpx;
  line-height: 28rpx;
  font-weight: 950;
}

.link-input {
  width: 100%;
  height: 220rpx;
  padding: 24rpx;
  border-radius: 24rpx;
  background: #f2f2ef;
  color: #111111;
  font-size: 30rpx;
  line-height: 40rpx;
  box-sizing: border-box;
}

.action-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 21rpx;
  margin-top: 24rpx;
}

.ghost-button,
.dark-button,
.lime-button,
.outline-button,
.save-button,
.copy-link-button {
  height: 73rpx;
  border-radius: 22rpx;
  font-size: 25rpx;
  font-weight: 950;
  line-height: 73rpx;
}

.ghost-button {
  background: #eeeeea;
  color: #777c73;
}

.dark-button {
  background: #111111;
  color: #ffffff;
}

.lime-button {
  background: #b7ff38;
  color: #111111;
}

.error-card {
  margin-top: 24rpx;
  padding: 24rpx;
  color: #d33a35;
  font-size: 23rpx;
  line-height: 31rpx;
}

.result-section {
  margin-top: 42rpx;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 21rpx;
}

.section-title {
  font-size: 35rpx;
  line-height: 40rpx;
  font-weight: 950;
}

.section-note {
  color: #74796f;
  font-size: 21rpx;
  line-height: 25rpx;
  font-weight: 800;
}

.result-card {
  overflow: hidden;
}

.preview-wrap {
  position: relative;
  height: 380rpx;
  background: #050505;
}

.video-preview {
  width: 100%;
  height: 100%;
}

.duration {
  position: absolute;
  right: 24rpx;
  bottom: 21rpx;
  color: #eeeeee;
  font-size: 28rpx;
  font-weight: 900;
}

.result-body {
  padding: 28rpx;
}

.result-title {
  font-size: 28rpx;
  line-height: 43rpx;
  font-weight: 850;
}

.button-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 17rpx;
  margin-top: 31rpx;
}

.outline-button,
.copy-link-button {
  border: 3rpx solid #111111;
  background: transparent;
  color: #111111;
}

.save-button {
  background: #111111;
  color: #b7ff38;
}

.copy-link-button {
  width: 58%;
  margin: 21rpx auto 0;
}

.notice-card {
  margin-top: 35rpx;
  padding: 24rpx 28rpx;
  color: #797d73;
  font-size: 23rpx;
  line-height: 34rpx;
  font-weight: 700;
}
```

- [ ] **Step 6: Manual mini-program compile check**

Open WeChat DevTools with `miniprogram/app`, then verify:

- The page appears in the pages list.
- The page renders without WXML/WXSS warnings.
- Empty parse shows “请输入视频分享链接”.
- Paste fills the textarea from clipboard.

## Task 4: Toolbox Entry

**Files:**
- Modify: `miniprogram/app/utils/tools.js`
- Modify: `miniprogram/app/pages/toolbox/index.js`

- [ ] **Step 1: Add tool metadata**

Add to `tools` in `miniprogram/app/utils/tools.js` before `more`:

```js
{
  id: "videoWatermark",
  name: "视频去水印",
  category: "常用",
  desc: "复制链接，解析后保存视频",
  accent: "ink",
  iconKey: "play",
  iconText: "▶",
  local: false
},
```

- [ ] **Step 2: Add to common tools**

Change `commonToolIds` in `miniprogram/app/pages/toolbox/index.js`:

```js
const commonToolIds = ["crop", "watermark", "videoWatermark", "film", "more"];
```

- [ ] **Step 3: Route the new tool to its page**

Add this branch in `openTool(event)` after the locked check and before editor navigation:

```js
if (id === "videoWatermark") {
  wx.navigateTo({ url: "/pages/video-watermark/index" });
  return;
}
```

- [ ] **Step 4: Verify toolbox behavior**

Open the toolbox page in WeChat DevTools and verify:

- “视频去水印” appears in 常用.
- The card uses the existing tool card proportions.
- Tapping it navigates to `/pages/video-watermark/index`.
- Other tools still navigate to `/pages/editor/index?tool=<id>`.

- [ ] **Step 5: Commit mini-program page and entry**

Run:

```bash
git add miniprogram/app/app.json miniprogram/app/utils/tools.js miniprogram/app/pages/toolbox/index.js miniprogram/app/pages/video-watermark
git commit -m "feat: add mini video watermark tool"
```

## Task 5: End-to-End Verification

**Files:**
- No new files.
- Verify committed files from Tasks 1-4.

- [ ] **Step 1: Run backend checks**

Run:

```bash
npm run video:smoke
npm run lint
npm run build
```

Expected:

- `video watermark smoke passed`
- TypeScript passes.
- Vite/esbuild build succeeds.

- [ ] **Step 2: Run mini-program checks**

In WeChat DevTools:

- Open toolbox.
- Tap “视频去水印”.
- Paste a valid public share link.
- If no provider network is configured, confirm backend returns a readable failure toast.
- With a working provider, confirm preview, title, copy title, copy link, and save video.

- [ ] **Step 3: Check scoped diff**

Run:

```bash
git status --short
git log --oneline -3
```

Expected:

- No unstaged changes in files touched by this feature.
- Existing unrelated dirty files may remain; do not stage or revert them.

- [ ] **Step 4: Final report**

Report:

- Backend API route path.
- Mini-program page path.
- Provider default and env vars.
- Verification commands and results.
- Any remaining manual WeChat DevTools checks.

## Self-Review

- Spec coverage: The plan covers toolbox entry, independent page UI, parse input, provider adapter, backend route, copy actions, video download/save, error states, and verification.
- Placeholder scan: No placeholder markers or vague “add appropriate handling” steps remain.
- Type consistency: The plan consistently uses `VideoResolveResult`, `VideoResolveError`, `resolveVideoShareUrl`, `videoWatermark`, and `/api/miniprogram/video-watermark/parse`.
