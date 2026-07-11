# Mini Program P2 On-Demand Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace full-list mini-program requests with summaries and incremental pages while preserving list state after card-detail navigation.

**Architecture:** Express provides a compact week summary and consistent page metadata. Mini-program pages own page/hasMore/loadingMore state, append de-duplicated cards, and distinguish first-load indicators from silent refreshes.

**Tech Stack:** Express, PostgreSQL, TypeScript, WeChat Mini Program JavaScript/WXML.

---

### Task 1: Week Summary and Consistent Card Pagination

**Files:** `server.ts`, `scripts/mini-p2-smoke.mjs`, `package.json`

- [x] Add `/api/db/weeks/:weekId/summary` with aggregate counts and three ranked previews per day.
- [x] Remove the unpaginated specified-week branch from `/api/db/cards` and add `dayIndex` filtering.
- [x] Add an authenticated smoke test for summary limits, weekly paging and day filtering.

### Task 2: Diary Summary and Silent Refresh

**Files:** `miniprogram/app/pages/diary/index.js`

- [x] Replace the 200-card request with the summary endpoint.
- [x] Preserve current data on every `onShow` after the first successful load.

### Task 3: Day and Book Incremental Pages

**Files:** `miniprogram/app/pages/day-detail/index.js`, `index.wxml`, `index.wxss`, `miniprogram/app/pages/books/index.js`, `index.wxml`, `index.wxss`

- [x] Add 20-row reset/append loaders with ID de-duplication and `hasMore` guards.
- [x] Bind page or scroll-view bottom events and show compact loading/end states.
- [x] Make book `onShow` refresh silent when existing data is present.

### Task 4: Search Debounce and Paging

**Files:** `miniprogram/app/pages/search/index.js`, `index.wxml`, `index.wxss`

- [x] Debounce text input by 300ms and increment a request sequence for each reset.
- [x] Load and append 20-row pages, ignoring stale responses.

### Task 5: Favorite Paging and Return-State Preservation

**Files:** `miniprogram/app/pages/me/index.js`, `index.wxml`, `index.wxss`

- [x] Load favorites in 12-row pages and append on bottom only when 收藏 is active.
- [x] Keep books, drafts and favorites visible during later `onShow` refreshes.

### Task 6: Verification and Publish

**Files:** all files above

- [x] Run `npm run mini:p2:smoke`, all mini-program JavaScript checks, `npm run lint`, `npm run build`, auth smoke and combo smoke.
- [x] Confirm no AppID is staged, commit the implementation, and push `main`.
