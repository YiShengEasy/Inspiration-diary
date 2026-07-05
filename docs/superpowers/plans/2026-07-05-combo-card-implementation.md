# Combo Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add combo inspiration cards that contain categorized reference images and multiple prompt/video generation records while remaining compatible with daily cards, books, search, and mini-program read-only views.

**Architecture:** Keep combo cards as normal `cards` rows with `type = "combo"` so existing daily/book/search flows continue to work. Store combo-specific reference images and prompt/video generation records in new Postgres tables, expose focused backend endpoints, and keep the Web detail experience in a dedicated component loaded from the existing card zoom modal.

**Tech Stack:** React 19, TypeScript, Express, PostgreSQL, multer, existing local/OSS storage provider abstraction, native WeChat mini-program JavaScript/WXML/WXSS.

---

## File Structure

- Modify `src/types.ts`: add combo image, combo generation, combo summary, and combo detail types.
- Modify `server.ts`: add Postgres schema, row mappers, list summary joins, combo CRUD/upload endpoints, and cleanup on card delete.
- Modify `src/lib/dbClient.ts`: add combo client helpers and include combo summary in `ImageCard`.
- Create `src/components/ComboCardDetail.tsx`: Web detail UI for reference images and prompt/video generation records.
- Modify `src/components/PolaroidCard.tsx`: show combo card cover, badge, counts, and click-through.
- Modify `src/App.tsx`: add create-combo entry points, combo modal integration, and state refresh.
- Modify `src/components/DaySlot.tsx`: add “创建组合” entry in the upload action path.
- Modify `src/components/InspirationBooksView.tsx`: add “创建组合” entry that auto-adds to the selected book.
- Modify `miniprogram/app/pages/diary/index.js`, `miniprogram/app/pages/books/index.js`, `miniprogram/app/pages/day-detail/index.js`, `miniprogram/app/pages/search/index.js`, `miniprogram/app/pages/card-detail/index.js`: normalize combo summary and labels.
- Modify `miniprogram/app/pages/card-detail/index.wxml` and `miniprogram/app/pages/card-detail/index.wxss`: render combo read-only detail.
- Create `scripts/combo-card-smoke.mjs`: backend smoke test for create/list/detail/upload/delete behavior.

## Task 1: Shared Types and Backend Schema

**Files:**
- Modify: `src/types.ts`
- Modify: `server.ts`

- [ ] **Step 1: Add combo types**

In `src/types.ts`, extend `ImageCard` and add new interfaces:

```ts
export type ComboImageRole = "character" | "scene" | "story" | "other";

export interface ComboSummary {
  coverImageUrl: string;
  imageCount: number;
  generationCount: number;
}

export interface ComboImage {
  id: string;
  cardId: string;
  role: ComboImageRole;
  storageProvider: "local" | "oss" | string;
  storageKey: string;
  imageUrl: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  createdAt: number;
}

export interface ComboGeneration {
  id: string;
  cardId: string;
  promptNote: string;
  storageProvider: "local" | "oss" | string;
  storageKey: string;
  videoUrl: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  posterUrl?: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface ComboCardDetail {
  card: ImageCard;
  images: ComboImage[];
  generations: ComboGeneration[];
}
```

Then update the existing `ImageCard` type:

```ts
type?: "image" | "md" | "video" | "combo";
comboSummary?: ComboSummary;
```

- [ ] **Step 2: Add Postgres tables**

In `server.ts`, inside `ensurePgSchema()` after `image_assets`, add:

```ts
await client.query(`
  CREATE TABLE IF NOT EXISTS combo_images (
    id VARCHAR(80) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id VARCHAR(50) NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'other',
    storage_provider VARCHAR(20) NOT NULL DEFAULT 'local',
    storage_key TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  );
`);
await client.query("CREATE INDEX IF NOT EXISTS idx_combo_images_user_card ON combo_images(user_id, card_id, sort_order, created_at);");
await client.query("CREATE INDEX IF NOT EXISTS idx_combo_images_storage_key ON combo_images(storage_provider, storage_key);");

await client.query(`
  CREATE TABLE IF NOT EXISTS combo_generations (
    id VARCHAR(80) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id VARCHAR(50) NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    prompt_note TEXT NOT NULL DEFAULT '',
    storage_provider VARCHAR(20) NOT NULL DEFAULT 'local',
    storage_key TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    duration_ms BIGINT DEFAULT 0,
    poster_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );
`);
await client.query("CREATE INDEX IF NOT EXISTS idx_combo_generations_user_card ON combo_generations(user_id, card_id, sort_order, created_at);");
await client.query("CREATE INDEX IF NOT EXISTS idx_combo_generations_storage_key ON combo_generations(storage_provider, storage_key);");
```

- [ ] **Step 3: Add row mappers**

In `server.ts` near `mapVideoAssetRow` and `mapImageAssetRow`, add:

```ts
function normalizeComboImageRole(value: unknown): "character" | "scene" | "story" | "other" {
  return value === "character" || value === "scene" || value === "story" || value === "other" ? value : "other";
}

function mapComboImageRow(row: any, req: express.Request) {
  return {
    id: row.id,
    cardId: row.card_id,
    role: normalizeComboImageRole(row.role),
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    imageUrl: signedImageUrl(`/api/combo-images/${encodeURIComponent(row.id)}`, req),
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    sortOrder: Number(row.sort_order || 0),
    createdAt: Number(row.created_at || 0),
  };
}

function mapComboGenerationRow(row: any, req: express.Request) {
  return {
    id: row.id,
    cardId: row.card_id,
    promptNote: row.prompt_note || "",
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    videoUrl: signedImageUrl(`/api/combo-generations/${encodeURIComponent(row.id)}/video`, req),
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    durationMs: Number(row.duration_ms || 0),
    posterUrl: row.poster_url ? signedImageUrl(row.poster_url, req) : "",
    sortOrder: Number(row.sort_order || 0),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}
```

- [ ] **Step 4: Include combo summary in card mapper**

Update `mapCardRows` in `server.ts` to add:

```ts
comboSummary: row.type === "combo" ? {
  coverImageUrl: row.combo_cover_image_id ? signedImageUrl(`/api/combo-images/${encodeURIComponent(row.combo_cover_image_id)}`, req) : "",
  imageCount: Number(row.combo_image_count || 0),
  generationCount: Number(row.combo_generation_count || 0),
} : undefined,
```

- [ ] **Step 5: Run type check**

Run:

```bash
npm run lint
```

Expected: fail only if later endpoint references are not implemented yet. If TypeScript fails because new properties are unused or mapper columns are absent, keep this task uncommitted and continue to Task 2 before committing.

## Task 2: Backend Combo APIs and Cleanup

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: Create reusable combo SQL fragments**

In `server.ts`, near the cards query helpers, add:

```ts
const comboSummarySelectSql = `
  (SELECT ci.id
   FROM combo_images ci
   WHERE ci.user_id = cards.user_id AND ci.card_id = cards.id
   ORDER BY CASE ci.role WHEN 'character' THEN 0 ELSE 1 END, ci.sort_order ASC, ci.created_at ASC
   LIMIT 1) AS combo_cover_image_id,
  (SELECT COUNT(*)::int FROM combo_images ci WHERE ci.user_id = cards.user_id AND ci.card_id = cards.id) AS combo_image_count,
  (SELECT COUNT(*)::int FROM combo_generations cg WHERE cg.user_id = cards.user_id AND cg.card_id = cards.id) AS combo_generation_count
`;
```

For book-card queries that alias cards as `c`, use this second fragment:

```ts
const comboSummarySelectSqlForC = `
  (SELECT ci.id
   FROM combo_images ci
   WHERE ci.user_id = c.user_id AND ci.card_id = c.id
   ORDER BY CASE ci.role WHEN 'character' THEN 0 ELSE 1 END, ci.sort_order ASC, ci.created_at ASC
   LIMIT 1) AS combo_cover_image_id,
  (SELECT COUNT(*)::int FROM combo_images ci WHERE ci.user_id = c.user_id AND ci.card_id = c.id) AS combo_image_count,
  (SELECT COUNT(*)::int FROM combo_generations cg WHERE cg.user_id = c.user_id AND cg.card_id = c.id) AS combo_generation_count
`;
```

- [ ] **Step 2: Add combo summary columns to card queries**

Update every cards query that feeds `mapCardRows` to include `${comboSummarySelectSql}` or `${comboSummarySelectSqlForC}`. The critical query shapes are:

```ts
// GET /api/db/cards
`SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash,
        terms, deco_type, angle, created_at, type, md_content, md_summary, md_name, insight_note,
        ${comboSummarySelectSql},
        (SELECT COALESCE(json_agg(va ORDER BY va.created_at DESC), '[]'::json)
         FROM video_assets va
         WHERE va.user_id = cards.user_id AND va.card_id = cards.id) AS video_assets,
        (SELECT COALESCE(json_agg(ia ORDER BY ia.created_at DESC), '[]'::json)
         FROM image_assets ia
         WHERE ia.user_id = cards.user_id AND ia.card_id = cards.id) AS image_assets
 FROM cards
 WHERE user_id = $1
 ORDER BY created_at DESC
 LIMIT $2 OFFSET $3`
```

```ts
// GET /api/db/books/:bookId/cards
`SELECT c.id, c.week_id, c.day_index, c.image_url, c.thumbnail_url, c.photo_uid, c.photo_hash,
        c.terms, c.deco_type, c.angle, c.created_at, c.type, c.md_content, c.md_summary, c.md_name, c.insight_note,
        ${comboSummarySelectSqlForC},
        (SELECT COALESCE(json_agg(va ORDER BY va.created_at DESC), '[]'::json)
         FROM video_assets va
         WHERE va.user_id = c.user_id AND va.card_id = c.id) AS video_assets
 FROM inspiration_book_cards bc
 INNER JOIN cards c ON c.id = bc.card_id AND c.user_id = $1
 WHERE bc.user_id = $1 AND bc.book_id = $2
 ORDER BY bc.added_at DESC
 LIMIT $3 OFFSET $4`
```

- [ ] **Step 3: Add create combo card endpoint**

Add before `app.post("/api/db/cards"`:

```ts
app.post("/api/db/combo-cards", requirePostgresAuth, async (req: AuthenticatedRequest, res) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  const userId = req.user!.id;
  const now = Date.now();
  const id = String(req.body.id || `combo_${crypto.randomUUID()}`);
  const weekId = String(req.body.weekId || "").trim();
  const dayIndex = Number.isFinite(Number(req.body.dayIndex)) ? Number(req.body.dayIndex) : 0;
  const bookId = String(req.body.bookId || "").trim();
  const title = String(req.body.title || "组合灵感").trim().slice(0, 120) || "组合灵感";
  const terms = Array.isArray(req.body.terms) && req.body.terms.length ? req.body.terms.map(String).slice(0, 8) : ["组合灵感", "视频创作"];
  const insightNote = String(req.body.insightNote || "").trim();
  if (!weekId) return res.status(400).json({ error: "weekId is required." });

  try {
    await pgPool.query("BEGIN");
    await pgPool.query(
      `INSERT INTO cards (id, user_id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash, terms, terms_text, deco_type, angle, created_at, type, md_content, md_summary, md_name, insight_note)
       VALUES ($1, $2, $3, $4, '', '', '', '', $5, $6, 'washi', 0, $7, 'combo', NULL, $8, $9, $10)`,
      [id, userId, weekId, dayIndex, terms, [...terms, title, insightNote].filter(Boolean).join(" "), now, "多图组合与视频生成记录", title, insightNote || null]
    );
    if (bookId) {
      const book = await pgPool.query("SELECT id FROM inspiration_books WHERE id = $1 AND user_id = $2", [bookId, userId]);
      if (book.rowCount > 0) {
        await pgPool.query(
          `INSERT INTO inspiration_book_cards (user_id, book_id, card_id, added_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, book_id, card_id) DO NOTHING`,
          [userId, bookId, id, now]
        );
        await pgPool.query("UPDATE inspiration_books SET updated_at = $1 WHERE id = $2 AND user_id = $3", [now, bookId, userId]);
      }
    }
    await pgPool.query("COMMIT");
    const cardResult = await pgPool.query(
      `SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash,
              terms, deco_type, angle, created_at, type, md_content, md_summary, md_name, insight_note,
              ${comboSummarySelectSql}
       FROM cards
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return res.json({ card: mapCardRows(cardResult.rows, req)[0] });
  } catch (err: any) {
    await pgPool.query("ROLLBACK").catch(() => undefined);
    return res.status(500).json({ error: err.message || "Failed to create combo card." });
  }
});
```

- [ ] **Step 4: Add combo detail endpoint**

Add:

```ts
app.get("/api/db/cards/:id/combo", requirePostgresAuth, async (req: AuthenticatedRequest, res) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  const userId = req.user!.id;
  const cardId = req.params.id;
  try {
    const cardResult = await pgPool.query(
      `SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash,
              terms, deco_type, angle, created_at, type, md_content, md_summary, md_name, insight_note,
              ${comboSummarySelectSql}
       FROM cards
       WHERE id = $1 AND user_id = $2 AND type = 'combo'`,
      [cardId, userId]
    );
    if (!cardResult.rows[0]) return res.status(404).json({ error: "Combo card not found." });
    const images = await pgPool.query(
      `SELECT id, card_id, role, storage_provider, storage_key, original_name, mime_type, size_bytes, sort_order, created_at
       FROM combo_images
       WHERE user_id = $1 AND card_id = $2
       ORDER BY sort_order ASC, created_at ASC`,
      [userId, cardId]
    );
    const generations = await pgPool.query(
      `SELECT id, card_id, prompt_note, storage_provider, storage_key, original_name, mime_type, size_bytes, duration_ms, poster_url, sort_order, created_at, updated_at
       FROM combo_generations
       WHERE user_id = $1 AND card_id = $2
       ORDER BY sort_order ASC, created_at ASC`,
      [userId, cardId]
    );
    return res.json({
      card: mapCardRows(cardResult.rows, req)[0],
      images: images.rows.map((row) => mapComboImageRow(row, req)),
      generations: generations.rows.map((row) => mapComboGenerationRow(row, req)),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to load combo detail." });
  }
});
```

- [ ] **Step 5: Add combo image upload endpoint**

Use the existing image storage factory. Add:

```ts
app.post("/api/db/cards/:id/combo/images", requirePostgresAuth, imageAssetUpload.single("image"), async (req: AuthenticatedRequest, res) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  if (!req.file) return res.status(400).json({ error: "Image file is required." });
  const userId = req.user!.id;
  const cardId = req.params.id;
  const role = normalizeComboImageRole(req.body.role);
  const sortOrder = Number.parseInt(String(req.body.sortOrder || "0"), 10) || 0;
  const id = `combo_img_${crypto.randomUUID()}`;
  const now = Date.now();
  try {
    const card = await pgPool.query("SELECT id FROM cards WHERE id = $1 AND user_id = $2 AND type = 'combo'", [cardId, userId]);
    if (card.rowCount === 0) return res.status(404).json({ error: "Combo card not found." });
    const stored = await imageAssetStorage.putObject({
      key: `combo-images/${userId}/${cardId}/${id}-${req.file.originalname}`,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
    });
    const result = await pgPool.query(
      `INSERT INTO combo_images (id, user_id, card_id, role, storage_provider, storage_key, original_name, mime_type, size_bytes, sort_order, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, card_id, role, storage_provider, storage_key, original_name, mime_type, size_bytes, sort_order, created_at`,
      [id, userId, cardId, role, stored.storageProvider, stored.storageKey, stored.originalName, stored.mimeType, stored.sizeBytes, sortOrder, now]
    );
    return res.json({ image: mapComboImageRow(result.rows[0], req) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to upload combo image." });
  }
});
```

- [ ] **Step 6: Add combo generation create/update/delete endpoints**

Create endpoint:

```ts
app.post("/api/db/cards/:id/combo/generations", requirePostgresAuth, videoUpload.single("video"), async (req: AuthenticatedRequest, res) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  if (!req.file) return res.status(400).json({ error: "Video file is required." });
  const userId = req.user!.id;
  const cardId = req.params.id;
  const id = `combo_gen_${crypto.randomUUID()}`;
  const now = Date.now();
  const promptNote = String(req.body.promptNote || "").trim();
  const sortOrder = Number.parseInt(String(req.body.sortOrder || "0"), 10) || 0;
  const durationMs = Number.parseInt(String(req.body.durationMs || "0"), 10) || 0;
  try {
    const card = await pgPool.query("SELECT id FROM cards WHERE id = $1 AND user_id = $2 AND type = 'combo'", [cardId, userId]);
    if (card.rowCount === 0) return res.status(404).json({ error: "Combo card not found." });
    const stored = await videoStorage.putObject({
      key: `combo-generations/${userId}/${cardId}/${id}-${req.file.originalname}`,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
    });
    const result = await pgPool.query(
      `INSERT INTO combo_generations (id, user_id, card_id, prompt_note, storage_provider, storage_key, original_name, mime_type, size_bytes, duration_ms, poster_url, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '', $11, $12, $12)
       RETURNING id, card_id, prompt_note, storage_provider, storage_key, original_name, mime_type, size_bytes, duration_ms, poster_url, sort_order, created_at, updated_at`,
      [id, userId, cardId, promptNote, stored.storageProvider, stored.storageKey, stored.originalName, stored.mimeType, stored.sizeBytes, durationMs, sortOrder, now]
    );
    await pgPool.query(
      "UPDATE cards SET terms_text = CONCAT_WS(' ', array_to_string(terms, ' '), md_name, md_summary, insight_note, $1) WHERE id = $2 AND user_id = $3",
      [promptNote, cardId, userId]
    );
    return res.json({ generation: mapComboGenerationRow(result.rows[0], req) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to create combo generation." });
  }
});
```

Update prompt endpoint:

```ts
app.put("/api/db/cards/:id/combo/generations/:generationId", requirePostgresAuth, async (req: AuthenticatedRequest, res) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  const promptNote = String(req.body.promptNote || "").trim();
  const sortOrder = Number.parseInt(String(req.body.sortOrder || "0"), 10) || 0;
  const result = await pgPool.query(
    `UPDATE combo_generations
     SET prompt_note = $1, sort_order = $2, updated_at = $3
     WHERE id = $4 AND card_id = $5 AND user_id = $6
     RETURNING id, card_id, prompt_note, storage_provider, storage_key, original_name, mime_type, size_bytes, duration_ms, poster_url, sort_order, created_at, updated_at`,
    [promptNote, sortOrder, Date.now(), req.params.generationId, req.params.id, req.user!.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Combo generation not found." });
  return res.json({ generation: mapComboGenerationRow(result.rows[0], req) });
});
```

Delete endpoint:

```ts
app.delete("/api/db/cards/:id/combo/generations/:generationId", requirePostgresAuth, async (req: AuthenticatedRequest, res) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  const result = await pgPool.query(
    `DELETE FROM combo_generations
     WHERE id = $1 AND card_id = $2 AND user_id = $3
     RETURNING storage_provider, storage_key`,
    [req.params.generationId, req.params.id, req.user!.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Combo generation not found." });
  await deleteVideoStorageObject(result.rows[0].storage_provider, result.rows[0].storage_key).catch(() => undefined);
  return res.json({ success: true });
});
```

- [ ] **Step 7: Add signed read routes**

First update `hasValidSignedImageUrl` to include the new route prefixes:

```ts
const signablePathPrefixes = ["/api/photos/", "/api/objects/", "/api/videos/", "/api/images/", "/api/combo-images/", "/api/combo-generations/"];
```

Add:

```ts
app.get("/api/combo-images/:imageId", requirePostgresAuthOrSignedPhoto, async (req, res) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  try {
    const signedRequest = hasValidSignedImageUrl(req);
    const authReq = req as AuthenticatedRequest;
    const result = signedRequest
      ? await pgPool.query(
          `SELECT id, storage_provider, storage_key, original_name, mime_type, size_bytes
           FROM combo_images
           WHERE id = $1`,
          [req.params.imageId]
        )
      : await pgPool.query(
          `SELECT id, storage_provider, storage_key, original_name, mime_type, size_bytes
           FROM combo_images
           WHERE id = $1 AND user_id = $2`,
          [req.params.imageId, authReq.user!.id]
        );
    const asset = result.rows[0];
    if (!asset) return res.status(404).json({ error: "Image not found" });
    if (asset.storage_provider === "oss") {
      const signedUrl = await imageAssetStorage.getSignedReadUrl(asset.storage_key);
      return res.redirect(302, signedUrl);
    }
    if (asset.storage_provider !== "local") {
      return res.status(501).json({ error: "Unsupported image storage provider." });
    }
    const localPath = imageStorageKeyToLocalPath(asset.storage_key);
    const stat = await fs.stat(localPath);
    res.setHeader("Content-Type", asset.mime_type || "image/jpeg");
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(asset.original_name || asset.id)}"`);
    return fsSync.createReadStream(localPath).pipe(res);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Image stream failed." });
  }
});

app.get("/api/combo-generations/:generationId/video", requirePostgresAuthOrSignedPhoto, async (req, res) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  try {
    const signedRequest = hasValidSignedImageUrl(req);
    const authReq = req as AuthenticatedRequest;
    const result = signedRequest
      ? await pgPool.query(
          `SELECT id, storage_provider, storage_key, original_name, mime_type, size_bytes
           FROM combo_generations
           WHERE id = $1`,
          [req.params.generationId]
        )
      : await pgPool.query(
          `SELECT id, storage_provider, storage_key, original_name, mime_type, size_bytes
           FROM combo_generations
           WHERE id = $1 AND user_id = $2`,
          [req.params.generationId, authReq.user!.id]
        );
    const asset = result.rows[0];
    if (!asset) return res.status(404).json({ error: "Video not found" });
    if (asset.storage_provider === "oss") {
      const signedUrl = await videoStorage.getSignedReadUrl(asset.storage_key);
      return res.redirect(302, signedUrl);
    }
    if (asset.storage_provider !== "local") {
      return res.status(501).json({ error: "Unsupported video storage provider." });
    }
    const localPath = storageKeyToLocalPath(asset.storage_key);
    const stat = await fs.stat(localPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", asset.mime_type || "video/mp4");
    res.setHeader("Cache-Control", "private, max-age=300");
    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      const start = match?.[1] ? Number.parseInt(match[1], 10) : 0;
      const end = match?.[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= fileSize) {
        res.setHeader("Content-Range", `bytes */${fileSize}`);
        return res.status(416).end();
      }
      const safeEnd = Math.min(end, fileSize - 1);
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${safeEnd}/${fileSize}`);
      res.setHeader("Content-Length", String(safeEnd - start + 1));
      return fsSync.createReadStream(localPath, { start, end: safeEnd }).pipe(res);
    }
    res.setHeader("Content-Length", String(fileSize));
    return fsSync.createReadStream(localPath).pipe(res);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Video stream failed." });
  }
});
```

- [ ] **Step 8: Add delete-card cleanup**

Before deleting a card in `DELETE /api/db/cards/:id`, query combo storage objects:

```ts
const comboImages = await pgPool.query(
  "SELECT storage_provider, storage_key FROM combo_images WHERE user_id = $1 AND card_id = $2",
  [req.user!.id, req.params.id]
);
const comboGenerations = await pgPool.query(
  "SELECT storage_provider, storage_key FROM combo_generations WHERE user_id = $1 AND card_id = $2",
  [req.user!.id, req.params.id]
);
```

After the database delete succeeds, clean objects:

```ts
await Promise.all([
  ...comboImages.rows.map((row) => deleteImageStorageObject(row.storage_provider, row.storage_key).catch(() => undefined)),
  ...comboGenerations.rows.map((row) => deleteVideoStorageObject(row.storage_provider, row.storage_key).catch(() => undefined)),
]);
```

- [ ] **Step 9: Verify and commit**

Run:

```bash
npm run lint
npm run build
```

Expected: both pass.

Commit:

```bash
git add server.ts src/types.ts
git commit -m "feat: add combo card backend"
```

## Task 3: Web Client API Helpers

**Files:**
- Modify: `src/lib/dbClient.ts`

- [ ] **Step 1: Import combo types**

Update the type import:

```ts
import { ComboCardDetail, ComboGeneration, ComboImage, ComboImageRole, ImageCard, PaginatedCardsResult, VideoAsset, ImageAsset } from "../types";
```

- [ ] **Step 2: Add combo API helpers**

Add after existing image/video asset helpers:

```ts
export async function createComboCard(params: {
  id?: string;
  weekId: string;
  dayIndex: number;
  bookId?: string;
  title?: string;
  terms?: string[];
  insightNote?: string;
}): Promise<{ card: ImageCard }> {
  const res = await authFetch("/api/db/combo-cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `组合卡片创建失败：${res.statusText}`);
  return data;
}

export async function loadComboCardDetail(cardId: string): Promise<ComboCardDetail> {
  const res = await authFetch(`/api/db/cards/${encodeURIComponent(cardId)}/combo`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `组合详情加载失败：${res.statusText}`);
  return data;
}

export async function uploadComboImage(params: {
  cardId: string;
  file: File;
  role: ComboImageRole;
  sortOrder?: number;
}): Promise<{ image: ComboImage }> {
  if (!isSupportedImageAssetFile(params.file)) throw new Error("仅支持 jpg、png、webp、gif 图片。");
  if (params.file.size > MAX_IMAGE_ASSET_UPLOAD_BYTES) throw new Error("图片不能超过 25MB。");
  const form = new FormData();
  form.append("image", params.file, params.file.name || "image.jpg");
  form.append("role", params.role);
  form.append("sortOrder", String(params.sortOrder || 0));
  const res = await authFetch(`/api/db/cards/${encodeURIComponent(params.cardId)}/combo/images`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `参考图上传失败：${res.statusText}`);
  return data;
}

export async function createComboGeneration(params: {
  cardId: string;
  file: File;
  promptNote: string;
  sortOrder?: number;
  durationMs?: number;
}): Promise<{ generation: ComboGeneration }> {
  if (!isSupportedVideoFile(params.file)) throw new Error("仅支持 mp4、mov、webm 视频。");
  if (params.file.size > MAX_VIDEO_UPLOAD_BYTES) throw new Error("视频不能超过 100MB。");
  const form = new FormData();
  form.append("video", params.file, params.file.name || "video.mp4");
  form.append("promptNote", params.promptNote);
  form.append("sortOrder", String(params.sortOrder || 0));
  if (typeof params.durationMs === "number") form.append("durationMs", String(params.durationMs));
  const res = await authFetch(`/api/db/cards/${encodeURIComponent(params.cardId)}/combo/generations`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `生成记录保存失败：${res.statusText}`);
  return data;
}

export async function updateComboGeneration(params: {
  cardId: string;
  generationId: string;
  promptNote: string;
  sortOrder: number;
}): Promise<{ generation: ComboGeneration }> {
  const res = await authFetch(`/api/db/cards/${encodeURIComponent(params.cardId)}/combo/generations/${encodeURIComponent(params.generationId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ promptNote: params.promptNote, sortOrder: params.sortOrder }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `生成记录更新失败：${res.statusText}`);
  return data;
}

export async function deleteComboGeneration(cardId: string, generationId: string): Promise<void> {
  const res = await authFetch(`/api/db/cards/${encodeURIComponent(cardId)}/combo/generations/${encodeURIComponent(generationId)}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `生成记录删除失败：${res.statusText}`);
}
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm run lint
```

Expected: pass.

Commit:

```bash
git add src/lib/dbClient.ts
git commit -m "feat: add combo card client helpers"
```

## Task 4: Web Daily Cards and Creation Entry

**Files:**
- Modify: `src/components/PolaroidCard.tsx`
- Modify: `src/components/DaySlot.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Render combo card in PolaroidCard**

In `src/components/PolaroidCard.tsx`, add `Layers3` to lucide imports:

```ts
import { FileVideo, Layers3, Plus, X } from "lucide-react";
```

Before the video branch, add:

```tsx
) : card.type === "combo" ? (
  <div
    onClick={() => onZoom(card)}
    className="relative aspect-square w-full overflow-hidden bg-stone-100 dark:bg-stone-900 border border-stone-200/50 dark:border-stone-700/50 shadow-inner cursor-zoom-in"
    title="查看组合卡片"
  >
    {card.comboSummary?.coverImageUrl ? (
      <img src={card.comboSummary.coverImageUrl} alt={card.mdName || "组合卡片"} className="h-full w-full object-cover" loading="lazy" />
    ) : (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-stone-500">
        <Layers3 size={34} />
        <span className="text-xs font-bold">组合卡片</span>
      </div>
    )}
    <div className="absolute left-2 top-2 rounded-full bg-stone-950/80 px-2 py-1 text-[9px] font-bold text-white">组合</div>
    <div className="absolute inset-x-2 bottom-2 rounded-[6px] bg-white/85 px-2 py-1 text-[10px] font-bold text-stone-700 backdrop-blur">
      {card.comboSummary?.imageCount || 0} 张参考图 / {card.comboSummary?.generationCount || 0} 条视频记录
    </div>
  </div>
```

- [ ] **Step 2: Add DaySlot action prop**

In `src/components/DaySlot.tsx`, extend props:

```ts
onCreateComboCard?: (dayIndex: number) => void;
```

In the plus/upload action area, add a button:

```tsx
<button
  type="button"
  onClick={() => onCreateComboCard?.(dayIndex)}
  className="inline-flex items-center gap-1 rounded-[6px] bg-stone-900 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-stone-800"
>
  <Layers3 size={12} />
  创建组合
</button>
```

Import `Layers3` from lucide if the file does not already import it.

- [ ] **Step 3: Add create handler in App**

In `src/App.tsx`, import `createComboCard` from `src/lib/dbClient.ts`, then add:

```ts
const handleCreateComboCard = useCallback(async (dayIndex: number) => {
  try {
    const result = await createComboCard({
      weekId,
      dayIndex,
      title: "组合灵感",
    });
    setCards((current) => [result.card, ...current.filter((card) => card.id !== result.card.id)]);
    setZoomedCard(result.card);
  } catch (err) {
    alert(err instanceof Error ? err.message : "组合卡片创建失败");
  }
}, [weekId]);
```

Pass it to each `DaySlot`:

```tsx
onCreateComboCard={handleCreateComboCard}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run lint
npm run build
```

Expected: both pass.

Commit:

```bash
git add src/components/PolaroidCard.tsx src/components/DaySlot.tsx src/App.tsx
git commit -m "feat: show and create combo cards"
```

## Task 5: Web Combo Detail Editor

**Files:**
- Create: `src/components/ComboCardDetail.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create ComboCardDetail component**

Create `src/components/ComboCardDetail.tsx`:

```tsx
import { Loader2, Plus, Trash, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ComboCardDetail, ComboImageRole, ImageCard } from "../types";
import {
  createComboGeneration,
  deleteComboGeneration,
  loadComboCardDetail,
  updateComboGeneration,
  uploadComboImage,
} from "../lib/dbClient";

const roleLabels: Record<ComboImageRole, string> = {
  character: "人物图",
  scene: "场景图",
  story: "故事图",
  other: "其他",
};

export function ComboCardDetailView({ card, onCardChanged }: {
  card: ImageCard;
  onCardChanged: (card: ImageCard) => void;
}) {
  const [detail, setDetail] = useState<ComboCardDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [role, setRole] = useState<ComboImageRole>("character");
  const [promptNote, setPromptNote] = useState("");
  const [saving, setSaving] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const next = await loadComboCardDetail(card.id);
      setDetail(next);
      onCardChanged(next.card);
    } catch (err) {
      setError(err instanceof Error ? err.message : "组合详情加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [card.id]);

  async function handleImages(files: FileList | null) {
    if (!files || !files.length) return;
    setSaving(true);
    try {
      for (const file of Array.from(files)) {
        await uploadComboImage({ cardId: card.id, file, role, sortOrder: detail?.images.length || 0 });
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "参考图上传失败");
    } finally {
      setSaving(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  async function handleVideo(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setSaving(true);
    try {
      await createComboGeneration({
        cardId: card.id,
        file,
        promptNote,
        sortOrder: detail?.generations.length || 0,
      });
      setPromptNote("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成记录保存失败");
    } finally {
      setSaving(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 text-stone-800 dark:text-stone-100">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-serif text-xl font-bold">组合卡片</h3>
          <p className="text-xs text-stone-500">{detail?.images.length || 0} 张参考图 / {detail?.generations.length || 0} 条视频记录</p>
        </div>
        {loading ? <Loader2 size={18} className="animate-spin text-stone-400" /> : null}
      </div>

      {error ? <div className="rounded-[6px] bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</div> : null}

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-bold">参考图片</h4>
          <div className="flex items-center gap-2">
            <select value={role} onChange={(event) => setRole(event.target.value as ComboImageRole)} className="h-8 rounded-[6px] border border-stone-200 bg-white px-2 text-xs">
              {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button type="button" onClick={() => imageInputRef.current?.click()} disabled={saving} className="inline-flex h-8 items-center gap-1 rounded-[6px] bg-stone-900 px-3 text-xs font-bold text-white">
              <Upload size={13} /> 上传
            </button>
          </div>
          <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif" multiple hidden onChange={(event) => void handleImages(event.target.files)} />
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {(detail?.images || []).map((image) => (
            <div key={image.id} className="overflow-hidden rounded-[8px] border border-stone-900/10 bg-white">
              <img src={image.imageUrl} alt={image.originalName} className="aspect-square w-full object-cover" />
              <div className="p-2 text-xs">
                <div className="font-bold">{roleLabels[image.role]}</div>
                <div className="truncate text-stone-500">{image.originalName}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-bold">生成记录</h4>
          <button type="button" onClick={() => videoInputRef.current?.click()} disabled={saving || !promptNote.trim()} className="inline-flex h-8 items-center gap-1 rounded-[6px] bg-stone-900 px-3 text-xs font-bold text-white disabled:opacity-50">
            <Plus size={13} /> 添加视频
          </button>
          <input ref={videoInputRef} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" hidden onChange={(event) => void handleVideo(event.target.files)} />
        </div>
        <textarea value={promptNote} onChange={(event) => setPromptNote(event.target.value)} placeholder="写下这一版视频的提示词或备注" className="mb-3 min-h-24 w-full rounded-[8px] border border-stone-200 bg-white p-3 text-sm outline-none focus:border-stone-500" />
        <div className="space-y-3">
          {(detail?.generations || []).map((generation) => (
            <div key={generation.id} className="rounded-[8px] border border-stone-900/10 bg-white p-3">
              <video src={generation.videoUrl} controls playsInline preload="metadata" className="mb-3 aspect-video w-full rounded-[6px] bg-stone-950 object-contain" />
              <textarea
                value={generation.promptNote}
                onChange={(event) => {
                  const promptNote = event.target.value;
                  setDetail((current) => current ? { ...current, generations: current.generations.map((item) => item.id === generation.id ? { ...item, promptNote } : item) } : current);
                }}
                onBlur={() => void updateComboGeneration({ cardId: card.id, generationId: generation.id, promptNote: generation.promptNote, sortOrder: generation.sortOrder })}
                className="min-h-20 w-full rounded-[6px] border border-stone-200 p-2 text-sm"
              />
              <button type="button" onClick={() => void deleteComboGeneration(card.id, generation.id).then(refresh)} className="mt-2 inline-flex h-8 items-center gap-1 rounded-[6px] bg-red-500/10 px-3 text-xs font-bold text-red-700">
                <Trash size={13} /> 删除
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Integrate into modal**

In `src/App.tsx`, import:

```ts
import { ComboCardDetailView } from "./components/ComboCardDetail";
```

In the zoom modal left/main content branch, add before the `md` branch:

```tsx
{zoomedCard.type === "combo" ? (
  <ComboCardDetailView
    card={zoomedCard}
    onCardChanged={(card) => {
      setZoomedCard(card);
      setCards((current) => current.map((item) => item.id === card.id ? card : item));
      setAllCardsPageCards((current) => current.map((item) => item.id === card.id ? card : item));
    }}
  />
) : zoomedCard.type === "md" ? (
```

Adjust the modal width class:

```ts
${zoomedCard.type === "md" || zoomedCard.type === "combo" ? "max-w-5xl" : "max-w-7xl"}
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm run lint
npm run build
```

Expected: both pass.

Commit:

```bash
git add src/components/ComboCardDetail.tsx src/App.tsx
git commit -m "feat: add combo card detail editor"
```

## Task 6: Inspiration Book Combo Creation

**Files:**
- Modify: `src/components/InspirationBooksView.tsx`

- [ ] **Step 1: Add create combo button**

Import `createComboCard` and `currentWeekId`/date helper already used in this component. Add handler:

```ts
async function handleCreateBookComboCard() {
  if (!selectedBookId) return;
  try {
    setUploading(true);
    const result = await createComboCard({
      weekId: currentWeekId(),
      dayIndex: todayDayIndex(),
      bookId: selectedBookId,
      title: `${selectedBook?.title || "灵感册"}组合`,
    });
    setCards((current) => [result.card, ...current]);
    await loadBookCards(selectedBookId);
  } catch (err) {
    setError(err instanceof Error ? err.message : "组合卡片创建失败");
  } finally {
    setUploading(false);
  }
}
```

If `todayDayIndex` is not shared, add this local helper:

```ts
function todayDayIndex() {
  const day = new Date().getDay();
  if (day === 0 || day === 6) return 5;
  return Math.max(0, day - 1);
}
```

Add button near the existing upload button:

```tsx
<button
  type="button"
  onClick={() => void handleCreateBookComboCard()}
  disabled={uploading || !selectedBookId}
  className="inline-flex h-9 items-center gap-1.5 rounded-[6px] bg-stone-900 px-3 text-xs font-bold text-white disabled:opacity-50"
>
  创建组合
</button>
```

- [ ] **Step 2: Verify and commit**

Run:

```bash
npm run lint
npm run build
```

Expected: both pass.

Commit:

```bash
git add src/components/InspirationBooksView.tsx
git commit -m "feat: create combo cards in books"
```

## Task 7: Mini-Program Read-Only Compatibility

**Files:**
- Modify: `miniprogram/app/pages/diary/index.js`
- Modify: `miniprogram/app/pages/books/index.js`
- Modify: `miniprogram/app/pages/day-detail/index.js`
- Modify: `miniprogram/app/pages/search/index.js`
- Modify: `miniprogram/app/pages/card-detail/index.js`
- Modify: `miniprogram/app/pages/card-detail/index.wxml`
- Modify: `miniprogram/app/pages/card-detail/index.wxss`

- [ ] **Step 1: Normalize combo cards in list pages**

In each list page `normalizeCard(card)`, add:

```js
const isCombo = card.type === "combo";
```

Then set:

```js
image: isCombo ? resolveAssetUrl((card.comboSummary && card.comboSummary.coverImageUrl) || "") : resolveAssetUrl(card.thumbnailUrl || card.imageUrl || ""),
title: card.mdName || terms[0] || (isCombo ? "组合卡片" : "灵感图片"),
summary: isCombo
  ? `${(card.comboSummary && card.comboSummary.imageCount) || 0} 张参考图 / ${(card.comboSummary && card.comboSummary.generationCount) || 0} 条视频记录`
  : (card.mdSummary || card.mdContent || card.insightNote || ""),
typeLabel: isCombo ? "组合" : (card.type === "md" ? "DOC" : "IMG"),
isCombo,
```

- [ ] **Step 2: Load combo detail on card detail page**

In `miniprogram/app/pages/card-detail/index.js`, add data:

```js
comboDetail: null,
```

After loading the card, if it is combo, call:

```js
if (card && card.type === "combo") {
  const comboDetail = await request({ url: `/api/db/cards/${encodeURIComponent(this.data.id)}/combo` });
  this.setData({ comboDetail });
}
```

In `normalizeCard`, add:

```js
const isCombo = card.type === "combo";
```

And use:

```js
image: isCombo ? resolveAssetUrl((card.comboSummary && card.comboSummary.coverImageUrl) || "") : resolveAssetUrl(card.image || card.imageUrl || card.thumbnailUrl || ""),
typeLabel: isCombo ? "组合" : (card.type === "md" ? "DOC" : "IMG"),
isCombo,
```

- [ ] **Step 3: Render combo detail WXML**

In `miniprogram/app/pages/card-detail/index.wxml`, before the normal tag list, add:

```xml
<view wx:if="{{card.isCombo && comboDetail}}" class="combo-section">
  <text class="combo-title">参考图片</text>
  <view class="combo-image-grid">
    <view wx:for="{{comboDetail.images}}" wx:key="id" class="combo-image-card">
      <image src="{{item.imageUrl}}" mode="aspectFill"></image>
      <text>{{item.role === 'character' ? '人物图' : item.role === 'scene' ? '场景图' : item.role === 'story' ? '故事图' : '其他'}}</text>
    </view>
  </view>
  <text class="combo-title">生成记录</text>
  <view wx:for="{{comboDetail.generations}}" wx:key="id" class="combo-generation">
    <video src="{{item.videoUrl}}" controls object-fit="contain"></video>
    <text class="combo-prompt">{{item.promptNote}}</text>
  </view>
</view>
```

- [ ] **Step 4: Add WXSS styles**

In `miniprogram/app/pages/card-detail/index.wxss`, add:

```css
.combo-section {
  margin-top: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 18rpx;
}

.combo-title {
  font-size: 26rpx;
  font-weight: 800;
  color: #2c2a24;
}

.combo-image-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14rpx;
}

.combo-image-card {
  overflow: hidden;
  border-radius: 16rpx;
  background: rgba(255, 255, 255, 0.76);
  border: 1rpx solid rgba(36, 32, 25, 0.1);
}

.combo-image-card image {
  width: 100%;
  height: 220rpx;
  display: block;
}

.combo-image-card text {
  display: block;
  padding: 12rpx;
  font-size: 22rpx;
  font-weight: 700;
  color: #5c584f;
}

.combo-generation {
  padding: 16rpx;
  border-radius: 18rpx;
  background: rgba(255, 255, 255, 0.72);
  border: 1rpx solid rgba(36, 32, 25, 0.1);
}

.combo-generation video {
  width: 100%;
  height: 360rpx;
  border-radius: 14rpx;
  overflow: hidden;
  background: #111;
}

.combo-prompt {
  display: block;
  margin-top: 14rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: #4b4740;
  white-space: pre-wrap;
}
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
node --check miniprogram/app/pages/diary/index.js
node --check miniprogram/app/pages/books/index.js
node --check miniprogram/app/pages/day-detail/index.js
node --check miniprogram/app/pages/search/index.js
node --check miniprogram/app/pages/card-detail/index.js
```

Expected: all commands exit with no output.

Commit:

```bash
git add miniprogram/app/pages/diary/index.js miniprogram/app/pages/books/index.js miniprogram/app/pages/day-detail/index.js miniprogram/app/pages/search/index.js miniprogram/app/pages/card-detail/index.js miniprogram/app/pages/card-detail/index.wxml miniprogram/app/pages/card-detail/index.wxss
git commit -m "feat: show combo cards in mini program"
```

## Task 8: Smoke Test and Local Release

**Files:**
- Create: `scripts/combo-card-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add smoke script**

Create `scripts/combo-card-smoke.mjs`:

```js
import assert from "node:assert/strict";

const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3005";
const token = process.env.SMOKE_AUTH_TOKEN || "";
assert(token, "SMOKE_AUTH_TOKEN is required");

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

const suffix = Date.now().toString(36);
const cardId = `smoke_combo_${suffix}`;
const create = await request("/api/db/combo-cards", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    id: cardId,
    weekId: "2026-W27",
    dayIndex: 0,
    title: "Smoke Combo",
    terms: ["组合测试"],
  }),
});
assert.equal(create.res.status, 200, JSON.stringify(create.body));
assert.equal(create.body.card.type, "combo");

const detail = await request(`/api/db/cards/${encodeURIComponent(cardId)}/combo`);
assert.equal(detail.res.status, 200, JSON.stringify(detail.body));
assert.equal(detail.body.card.id, cardId);
assert.deepEqual(detail.body.images, []);
assert.deepEqual(detail.body.generations, []);

const list = await request("/api/db/cards?weekId=2026-W27&page=1&pageSize=20&q=组合测试");
assert.equal(list.res.status, 200, JSON.stringify(list.body));
assert((list.body.cards || []).some((card) => card.id === cardId && card.type === "combo"));

const del = await request(`/api/db/cards/${encodeURIComponent(cardId)}`, { method: "DELETE" });
assert.equal(del.res.status, 200, JSON.stringify(del.body));

console.log("combo-card smoke passed");
```

- [ ] **Step 2: Add package script**

In `package.json`, add:

```json
"combo:smoke": "node scripts/combo-card-smoke.mjs"
```

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run lint
npm run build
```

Expected: both pass.

If local Docker is already running on 3005, run:

```bash
SMOKE_AUTH_TOKEN=<token> npm run combo:smoke
```

Expected:

```text
combo-card smoke passed
```

- [ ] **Step 4: Release to local 3005**

Run:

```bash
npm run docker:prod:detached
curl -sS -I http://127.0.0.1:3005/ | head
```

Expected: `HTTP/1.1 200 OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/combo-card-smoke.mjs package.json package-lock.json
git commit -m "test: add combo card smoke check"
```

## Self-Review

- Spec coverage: The plan covers combo card creation, daily-card compatibility, categorized reference images, multiple prompt/video generation records, book integration, search/list summaries, mini-program read-only support, deletion cleanup, and smoke testing.
- Deferred scope: Mini-program creation/editing remains outside first implementation, matching the approved spec.
- Placeholder scan: The plan contains no open-ended placeholder work. Media stream routes include the exact current local/OSS streaming logic used by the existing image and video endpoints.
- Type consistency: The plan consistently uses `type = "combo"`, `comboSummary`, `ComboImage`, `ComboGeneration`, `promptNote`, `sortOrder`, `character | scene | story | other`, and `/api/db/cards/:id/combo`.
