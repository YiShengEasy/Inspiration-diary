# Mini Program Video Playback and Book Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ordinary video inspiration cards playable in the mini program and display real inspiration books in a compact three-column grid under “我的”.

**Architecture:** Extend the existing card normalization and protected-asset hydration path so a video card exposes one hydrated primary video to the detail template. Keep book fetching and navigation unchanged, replacing only the book list markup and styles with a fixed three-column presentation.

**Tech Stack:** WeChat Mini Program JavaScript, WXML, WXSS, existing authenticated API utilities

---

### Task 1: Normalize and hydrate ordinary video cards

**Files:**
- Modify: `miniprogram/app/pages/card-detail/index.js`

- [ ] **Step 1: Add video fields to card normalization**

Map every returned video asset through `resolveAssetUrl`, expose `isVideo`, and select the first asset as `primaryVideo`:

```js
const isVideo = card.type === "video";
const videoAssets = Array.isArray(card.videoAssets)
  ? card.videoAssets.map((video) => ({
      ...video,
      videoUrl: resolveAssetUrl(video.videoUrl || ""),
      posterUrl: video.posterUrl ? resolveAssetUrl(video.posterUrl) : ""
    }))
  : [];
const primaryVideo = videoAssets[0] || null;
```

Use `primaryVideo.originalName` as the first video-title fallback and set the video type label to `视频`.

- [ ] **Step 2: Hydrate the primary video before rendering**

Extend `hydrateCardMedia` so video cards download the protected video and optional poster through the existing `downloadAsset` helper:

```js
if (card.isVideo && card.primaryVideo) {
  const primaryVideo = {
    ...card.primaryVideo,
    videoUrl: await downloadAsset(card.primaryVideo.videoUrl),
    posterUrl: card.primaryVideo.posterUrl ? await downloadAsset(card.primaryVideo.posterUrl) : ""
  };
  return { ...card, primaryVideo, videoAssets: [primaryVideo, ...card.videoAssets.slice(1)] };
}
```

- [ ] **Step 3: Add video-aware album saving**

Route the existing detail download action to `wx.saveVideoToPhotosAlbum` when `card.isVideo` and a primary video exists. Keep image-card behavior on `wx.saveImageToPhotosAlbum` and show a specific message when a video card has no playable asset.

- [ ] **Step 4: Verify JavaScript syntax**

Run: `node --check miniprogram/app/pages/card-detail/index.js`

Expected: exit code 0 with no output.

### Task 2: Render the video-card hero state

**Files:**
- Modify: `miniprogram/app/pages/card-detail/index.wxml`
- Modify: `miniprogram/app/pages/card-detail/index.wxss`

- [ ] **Step 1: Add mutually exclusive hero branches**

Render a `<video>` first for `card.isVideo && card.primaryVideo`, an explicit empty video state for `card.isVideo`, the existing image for image cards, and the existing document fallback last:

```xml
<video wx:if="{{card.isVideo && card.primaryVideo}}" class="hero-video" src="{{card.primaryVideo.videoUrl}}" poster="{{card.primaryVideo.posterUrl}}" controls object-fit="contain"></video>
<view wx:elif="{{card.isVideo}}" class="hero-video-empty">暂无可播放视频</view>
<image wx:elif="{{!card.isMd && card.image}}" class="hero-image" src="{{card.image}}" mode="aspectFill"></image>
```

- [ ] **Step 2: Add stable 16:9 video sizing**

Give `.hero-video` and `.hero-video-empty` a full-width `aspect-ratio: 16 / 9`, black background, and the same corner radius as the current hero. Center the empty-state message.

- [ ] **Step 3: Review all card branches**

Confirm ordinary video, ordinary image, Markdown, and combo cards each select the intended hero and that combo generation players are unchanged.

### Task 3: Convert the real book list to a three-column grid

**Files:**
- Modify: `miniprogram/app/pages/me/index.wxml`
- Modify: `miniprogram/app/pages/me/index.wxss`

- [ ] **Step 1: Simplify each book item**

Keep the existing `books` loop and `openBook` handler, but remove the description line. Render the cover, title, and `countText` only.

- [ ] **Step 2: Replace row layout with three columns**

Set `.book-section` to `grid-template-columns: repeat(3, minmax(0, 1fr))`. Make `.book-row` a vertical item, size `.book-cover` with `aspect-ratio: 1`, clamp the title to two lines, and keep the count on one line.

- [ ] **Step 3: Preserve independent favorite-row styles**

Separate shared `.book-row` and `.favorite-row` rules where needed so favorites remain full-width rows. Ensure the empty book state spans `grid-column: 1 / -1`.

### Task 4: Run final verification

**Files:**
- Verify: `miniprogram/app/pages/card-detail/index.js`
- Verify: `miniprogram/app/pages/card-detail/index.wxml`
- Verify: `miniprogram/app/pages/card-detail/index.wxss`
- Verify: `miniprogram/app/pages/me/index.wxml`
- Verify: `miniprogram/app/pages/me/index.wxss`

- [ ] **Step 1: Check JavaScript syntax**

Run: `node --check miniprogram/app/pages/card-detail/index.js && node --check miniprogram/app/pages/me/index.js`

Expected: exit code 0 with no output.

- [ ] **Step 2: Run repository lint**

Run: `npm run lint`

Expected: TypeScript exits with code 0 and reports no errors.

- [ ] **Step 3: Check patch hygiene**

Run: `git diff --check -- miniprogram/app/pages/card-detail/index.js miniprogram/app/pages/card-detail/index.wxml miniprogram/app/pages/card-detail/index.wxss miniprogram/app/pages/me/index.wxml miniprogram/app/pages/me/index.wxss`

Expected: exit code 0 with no whitespace errors.
