# Card Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Web-only favorite flag for inspiration cards and support favorite-only queries.

**Architecture:** Store favorite state directly on the user-owned `cards` row with indexed `is_favorite` and `favorited_at` columns. Extend the existing authenticated cards API, then wire the React data layer and board/detail UI so favorite state stays synchronized across current-week cards, all-history pagination, and the detail modal.

**Tech Stack:** Express, PostgreSQL, React 19, TypeScript, Vite, Tailwind utility classes, lucide-react icons, existing `authFetch` and smoke-test scripts.

---

## File Structure

- Modify `server.ts`
  - Add schema columns and indexes.
  - Include favorite fields in card select queries.
  - Add `favorite=true` support to `GET /api/db/cards`.
  - Add `PUT /api/db/cards/:id/favorite`.
- Modify `src/types.ts`
  - Add `isFavorite` and `favoritedAt` to `ImageCard`.
- Modify `src/lib/dbClient.ts`
  - Add `favoriteOnly` to `loadAllCardsPage`.
  - Add `updateCardFavorite`.
  - Add local cache helper for favorite state.
- Modify `src/components/PolaroidCard.tsx`
  - Add a `Star` favorite button.
- Modify `src/App.tsx`
  - Add board-level favorite filter.
  - Add favorite toggle handler and detail favorite button.
  - Keep current-week and all-history lists synchronized.
- Modify `scripts/auth-smoke.mjs`
  - Add authenticated and cross-user favorite assertions.

## Task 1: Backend Schema, Mapping, and Favorite API

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: Add favorite columns and indexes**

In `server.ts`, inside PostgreSQL schema verification after the existing `ALTER TABLE cards ADD COLUMN IF NOT EXISTS insight_note TEXT;`, add:

```ts
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS favorited_at BIGINT;");
```

After the existing card indexes:

```ts
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_created_at ON cards(user_id, created_at DESC);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_week_created_at ON cards(user_id, week_id, created_at);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_photo_uid ON cards(user_id, photo_uid);");
```

add:

```ts
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_favorite_created_at ON cards(user_id, is_favorite, created_at DESC);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_favorited_at ON cards(user_id, favorited_at DESC);");
```

- [ ] **Step 2: Extend card row mapping**

Find the existing `mapCardRows` helper in `server.ts`. Add these properties to each mapped card object:

```ts
    isFavorite: Boolean(row.is_favorite),
    favoritedAt: row.favorited_at == null ? null : Number(row.favorited_at),
```

Keep existing camel-case mappings such as `weekId`, `dayIndex`, `imageUrl`, `thumbnailUrl`, and `insightNote` unchanged.

- [ ] **Step 3: Include favorite fields in card SELECT lists**

In every `SELECT` that returns card rows through `mapCardRows`, include `is_favorite, favorited_at`.

At minimum update these query fragments:

```sql
SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash, terms, deco_type, angle, created_at, type, md_content, md_summary, md_name, insight_note,
```

to:

```sql
SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash, terms, deco_type, angle, created_at, type, md_content, md_summary, md_name, insight_note, is_favorite, favorited_at,
```

Do the same for the card detail route:

```sql
SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash,
       terms, deco_type, angle, created_at, type, md_content, md_summary, md_name, insight_note, is_favorite, favorited_at,
```

Run this search to catch all card row query sites:

```bash
rg -n "md_name, insight_note|insight_note," server.ts
```

- [ ] **Step 4: Add favorite filtering to `GET /api/db/cards`**

Inside `app.get("/api/db/cards"...`, after reading `weekId`, add:

```ts
    const favoriteOnly = String(req.query.favorite || "").toLowerCase() === "true";
```

For the specific-week branch, change the SQL `WHERE` from:

```sql
WHERE user_id = $1 AND week_id = $2
```

to:

```sql
WHERE user_id = $1 AND week_id = $2
  ${favoriteOnly ? "AND is_favorite = true" : ""}
```

For the all-history branch, after the `q` clause is handled, add:

```ts
    if (favoriteOnly) {
      whereClauses.push("is_favorite = true");
    }
```

- [ ] **Step 5: Add `PUT /api/db/cards/:id/favorite`**

Place this route before `app.delete("/api/db/cards/:id"...`:

```ts
app.put("/api/db/cards/:id/favorite", requirePostgresAuth, async (req: AuthenticatedRequest, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }

  const favorite = req.body?.favorite;
  if (typeof favorite !== "boolean") {
    return res.status(400).json({ error: "favorite boolean is required." });
  }

  const favoritedAt = favorite ? Date.now() : null;
  try {
    const result = await pgPool.query(
      `UPDATE cards
       SET is_favorite = $1, favorited_at = $2
       WHERE id = $3 AND user_id = $4
       RETURNING id, is_favorite, favorited_at`,
      [favorite, favoritedAt, req.params.id, req.user!.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Card not found" });
    }

    const row = result.rows[0];
    return res.json({
      id: row.id,
      isFavorite: Boolean(row.is_favorite),
      favoritedAt: row.favorited_at == null ? null : Number(row.favorited_at),
    });
  } catch (err: any) {
    console.error("Error updating card favorite:", err);
    return res.status(500).json({ error: err.message || "Failed to update favorite" });
  }
});
```

- [ ] **Step 6: Run typecheck/build for backend syntax**

Run:

```bash
npm run lint
```

Expected: TypeScript exits with code `0`.

- [ ] **Step 7: Commit backend API**

```bash
git add server.ts
git commit -m "feat: add card favorite API"
```

## Task 2: Client Types and Data API

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/dbClient.ts`

- [ ] **Step 1: Add favorite fields to `ImageCard`**

In `src/types.ts`, add these optional fields after `insightNote?: string;`:

```ts
  isFavorite?: boolean;
  favoritedAt?: number | null;
```

- [ ] **Step 2: Add cache helper in `dbClient.ts`**

In `src/lib/dbClient.ts`, after `updateCachedCardInsightNote`, add:

```ts
function updateCachedCardFavorite(cardId: string, weekId: string | undefined, isFavorite: boolean, favoritedAt: number | null) {
  const updateCard = (card: ImageCard) => (
    card.id === cardId ? { ...card, isFavorite, favoritedAt } : card
  );

  if (weekId) {
    const existing = activeWeekCardsMemory.get(weekId) || [];
    const updated = existing.map(updateCard);
    activeWeekCardsMemory.set(weekId, updated);
    notifyCardsSubscribers(weekId, updated);
  }

  const allCards = activeWeekCardsMemory.get("all");
  if (allCards) {
    const nextAllCards = allCards.map(updateCard);
    activeWeekCardsMemory.set("all", nextAllCards);
    notifyCardsSubscribers("all", nextAllCards);
  }
}
```

- [ ] **Step 3: Add `favoriteOnly` to paginated card loading**

Change the `loadAllCardsPage` signature to:

```ts
export async function loadAllCardsPage(params: {
  page: number;
  pageSize: number;
  query?: string;
  favoriteOnly?: boolean;
}): Promise<PaginatedCardsResult> {
```

In the Firestore fallback branch, replace the `filtered` calculation with:

```ts
    const filtered = allCards.filter((card) => {
      if (params.favoriteOnly && !card.isFavorite) return false;
      if (!q) return true;
      if (card.terms.some((term) => term.toLowerCase().includes(q))) return true;
      if (card.mdName?.toLowerCase().includes(q)) return true;
      if (card.mdSummary?.toLowerCase().includes(q)) return true;
      if (card.insightNote?.toLowerCase().includes(q)) return true;
      return false;
    });
```

In the PostgreSQL URL builder, after adding `q`, add:

```ts
    if (params.favoriteOnly) {
      searchParams.set("favorite", "true");
    }
```

- [ ] **Step 4: Add `updateCardFavorite`**

In `src/lib/dbClient.ts`, near `updateCardInsightNote`, add:

```ts
export async function updateCardFavorite(cardId: string, weekId: string | undefined, favorite: boolean): Promise<{ isFavorite: boolean; favoritedAt: number | null }> {
  if (isPostgresMode) {
    const res = await authFetch(`/api/db/cards/${encodeURIComponent(cardId)}/favorite`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite }),
    });
    if (!res.ok) {
      throw new Error(`Failed to update favorite: ${res.statusText}`);
    }
    const body = await res.json();
    const next = {
      isFavorite: Boolean(body.isFavorite),
      favoritedAt: body.favoritedAt == null ? null : Number(body.favoritedAt),
    };
    updateCachedCardFavorite(cardId, weekId, next.isFavorite, next.favoritedAt);
    return next;
  }

  const favoritedAt = favorite ? Date.now() : null;
  await updateDoc(doc(db, "cards", cardId), {
    isFavorite: favorite,
    favoritedAt,
  });
  updateCachedCardFavorite(cardId, weekId, favorite, favoritedAt);
  return { isFavorite: favorite, favoritedAt };
}
```

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run lint
```

Expected: TypeScript exits with code `0`.

- [ ] **Step 6: Commit client data layer**

```bash
git add src/types.ts src/lib/dbClient.ts
git commit -m "feat: add card favorite client API"
```

## Task 3: Card and Board UI

**Files:**
- Modify: `src/components/PolaroidCard.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add favorite props to `PolaroidCard`**

In `src/components/PolaroidCard.tsx`, change imports:

```ts
import { FileVideo, Layers3, Plus, Star, X } from "lucide-react";
```

Add to `PolaroidCardProps`:

```ts
  onToggleFavorite?: (card: ImageCard) => void;
  isFavoriteUpdating?: boolean;
```

Add to the component destructuring:

```ts
  onToggleFavorite,
  isFavoriteUpdating = false,
```

- [ ] **Step 2: Add star button on each card**

Place this button before the existing delete button:

```tsx
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite?.(card);
          }}
          disabled={isFavoriteUpdating}
          className={`absolute -top-2 left-2 z-40 grid h-7 w-7 place-items-center rounded-full border shadow-sm transition-all active:scale-95 disabled:opacity-60 ${
            card.isFavorite
              ? "border-amber-500/40 bg-amber-300 text-stone-950 shadow-amber-900/10 dark:border-amber-200/50 dark:bg-amber-300 dark:text-stone-950"
              : "border-stone-200 bg-stone-100 text-stone-400 opacity-0 hover:text-amber-700 group-hover/card:opacity-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-500 dark:hover:text-amber-200"
          }`}
          title={card.isFavorite ? "取消收藏" : "收藏这条灵感"}
          aria-label={card.isFavorite ? "取消收藏" : "收藏这条灵感"}
        >
          <Star size={13} className={card.isFavorite ? "fill-current" : ""} />
        </button>
```

- [ ] **Step 3: Add favorite state and handler in `App.tsx`**

Change the `lucide-react` import to include `Star`:

```ts
import { Sun, Moon, Sparkles, BookOpen, Clock, Loader2, Save, Settings, Search, X, Copy, Calendar, Globe, Wand2, Trash, RefreshCw, LogOut, ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut, Maximize2, Move, Image as ImageIcon, FileText, Tags, FileVideo, Upload, Star } from "lucide-react";
```

Change the `dbClient` import to include `updateCardFavorite`:

```ts
  updateCardFavorite,
```

Add state near the search state:

```ts
  const [favoriteOnly, setFavoriteOnly] = useState<boolean>(false);
  const [favoriteUpdatingCardIds, setFavoriteUpdatingCardIds] = useState<Set<string>>(() => new Set());
```

Add this helper near `syncCardInsightNote`:

```ts
  const syncCardFavorite = useCallback((cardId: string, isFavorite: boolean, favoritedAt: number | null) => {
    setCards((current) => current.map((card) => card.id === cardId ? { ...card, isFavorite, favoritedAt } : card));
    setAllCardsPageCards((current) => current.map((card) => card.id === cardId ? { ...card, isFavorite, favoritedAt } : card));
    setZoomedCard((current) => current?.id === cardId ? { ...current, isFavorite, favoritedAt } : current);
  }, []);
```

Add this handler near the other card handlers:

```ts
  const handleToggleFavorite = useCallback(async (card: ImageCard) => {
    const nextFavorite = !card.isFavorite;
    const optimisticFavoritedAt = nextFavorite ? Date.now() : null;
    const previousFavorite = Boolean(card.isFavorite);
    const previousFavoritedAt = card.favoritedAt ?? null;

    setFavoriteUpdatingCardIds((current) => new Set(current).add(card.id));
    syncCardFavorite(card.id, nextFavorite, optimisticFavoritedAt);
    try {
      const result = await updateCardFavorite(card.id, card.weekId, nextFavorite);
      syncCardFavorite(card.id, result.isFavorite, result.favoritedAt);
      if (searchScope === "all") {
        await loadHistoricalCardsPage(allCardsPage);
      }
    } catch (err) {
      console.error("Failed to update favorite:", err);
      syncCardFavorite(card.id, previousFavorite, previousFavoritedAt);
    } finally {
      setFavoriteUpdatingCardIds((current) => {
        const next = new Set(current);
        next.delete(card.id);
        return next;
      });
    }
  }, [allCardsPage, searchScope, syncCardFavorite]);
```

- [ ] **Step 4: Apply favorite filter to data loading and visible cards**

In `loadHistoricalCardsPage`, pass the filter:

```ts
      const result = await loadAllCardsPage({
        page,
        pageSize: ALL_CARDS_PAGE_SIZE,
        query: searchQuery,
        favoriteOnly,
      });
```

Update the all-history effect dependency:

```ts
  }, [authUser, mainView, searchScope, allCardsPage, searchQuery, favoriteOnly]);
```

Update the page reset effect:

```ts
  useEffect(() => {
    setAllCardsPage(1);
  }, [searchQuery, searchScope, favoriteOnly]);
```

Replace the start of `filteredCards` with:

```ts
  const filteredCards = cards.filter((card) => {
    if (favoriteOnly && !card.isFavorite) return false;
    if (!searchQuery.trim()) return true;
```

- [ ] **Step 5: Add favorite filter control**

In the search controls, after the scope switcher `div`, add:

```tsx
            <button
              type="button"
              onClick={() => setFavoriteOnly((current) => !current)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-all active:scale-95 ${
                favoriteOnly
                  ? "border-amber-500/40 bg-amber-300 text-stone-950 shadow-sm dark:border-amber-200/40 dark:bg-amber-300 dark:text-stone-950"
                  : "border-stone-200/70 bg-white/70 text-stone-500 hover:text-amber-800 dark:border-stone-700 dark:bg-stone-800/80 dark:text-stone-400 dark:hover:text-amber-200"
              }`}
              title={favoriteOnly ? "显示全部灵感" : "只看收藏"}
              aria-pressed={favoriteOnly}
            >
              <Star size={13} className={favoriteOnly ? "fill-current" : ""} />
              <span>收藏</span>
            </button>
```

- [ ] **Step 6: Wire card list star buttons**

Where `PolaroidCard` is rendered for current-week cards and all-history cards, pass:

```tsx
                      onToggleFavorite={handleToggleFavorite}
                      isFavoriteUpdating={favoriteUpdatingCardIds.has(card.id)}
```

Keep existing props such as `onDeleteCard`, `onDeleteTerm`, `onZoom`, and `onUpdateTerms`.

- [ ] **Step 7: Run typecheck**

Run:

```bash
npm run lint
```

Expected: TypeScript exits with code `0`.

- [ ] **Step 8: Commit card and board UI**

```bash
git add src/components/PolaroidCard.tsx src/App.tsx
git commit -m "feat: add favorite controls to board"
```

## Task 4: Detail Modal Favorite Control

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add detail favorite button**

In the detail modal header actions near the existing collection/book button, add:

```tsx
                      <button
                        type="button"
                        onClick={() => void handleToggleFavorite(zoomedCard)}
                        disabled={favoriteUpdatingCardIds.has(zoomedCard.id)}
                        className={`grid h-9 w-9 place-items-center rounded-full border shadow-sm transition-all active:scale-95 disabled:opacity-60 ${
                          zoomedCard.isFavorite
                            ? "border-amber-500/40 bg-amber-300 text-stone-950 dark:border-amber-200/50 dark:bg-amber-300 dark:text-stone-950"
                            : "border-stone-900/10 bg-[#fbf7ed] text-stone-600 hover:-translate-y-0.5 hover:border-amber-700/20 hover:text-amber-800 dark:border-white/10 dark:bg-white/[0.07] dark:text-stone-300 dark:hover:border-amber-200/30 dark:hover:text-amber-200"
                        }`}
                        title={zoomedCard.isFavorite ? "取消收藏" : "收藏这条灵感"}
                        aria-label={zoomedCard.isFavorite ? "取消收藏" : "收藏这条灵感"}
                      >
                        <Star size={16} className={zoomedCard.isFavorite ? "fill-current" : ""} />
                      </button>
```

Place it beside the `BookOpen` collection action so download/delete remain footer icon actions.

- [ ] **Step 2: Confirm unfavorite behavior in favorite-only view**

No extra deletion code should be added. The existing `filteredCards` and all-history reload handle the card leaving the favorite-only list. Confirm `visibleCards` is still derived as:

```ts
  const visibleCards = mainView === "books" ? [] : searchScope === "all" ? allCardsPageCards : filteredCards;
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run lint
```

Expected: TypeScript exits with code `0`.

- [ ] **Step 4: Commit detail control**

```bash
git add src/App.tsx
git commit -m "feat: add favorite action to detail modal"
```

## Task 5: Smoke Tests and Final Verification

**Files:**
- Modify: `scripts/auth-smoke.mjs`

- [ ] **Step 1: Add unauthenticated favorite assertion**

After the existing unauthenticated cards assertion:

```js
const unauthFavorite = await request("/api/db/cards/missing/favorite", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ favorite: true }),
});
assert(unauthFavorite.status === 401, `expected unauth favorite 401, got ${unauthFavorite.status}`);
```

- [ ] **Step 2: Add User A favorite assertions**

After `insightSearchBodyA` assertions, add:

```js
const invalidFavoriteA = await request(`/api/db/cards/${encodeURIComponent(cardId)}/favorite`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookieA },
  body: JSON.stringify({ favorite: "yes" }),
});
assert(invalidFavoriteA.status === 400, `expected invalid favorite 400, got ${invalidFavoriteA.status}`);

const favoriteA = await request(`/api/db/cards/${encodeURIComponent(cardId)}/favorite`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookieA },
  body: JSON.stringify({ favorite: true }),
});
const favoriteBodyA = await json(favoriteA);
assert(favoriteA.ok, `favorite A failed ${favoriteA.status}: ${JSON.stringify(favoriteBodyA)}`);
assert(favoriteBodyA.isFavorite === true, "expected A favorite response true");
assert(typeof favoriteBodyA.favoritedAt === "number", `expected numeric favoritedAt, got ${favoriteBodyA.favoritedAt}`);

const favoriteListA = await request(`/api/db/cards?weekId=all&page=1&pageSize=10&favorite=true&q=${encodeURIComponent(term)}`, {
  headers: { Cookie: cookieA },
});
const favoriteListBodyA = await json(favoriteListA);
assert(favoriteListA.ok, `favorite list A failed ${favoriteListA.status}: ${JSON.stringify(favoriteListBodyA)}`);
assert(favoriteListBodyA.total === 1, `expected A favorite total 1, got ${favoriteListBodyA.total}`);
assert(favoriteListBodyA.cards?.[0]?.id === cardId, `expected favorite card ${cardId}, got ${favoriteListBodyA.cards?.[0]?.id}`);
assert(favoriteListBodyA.cards?.[0]?.isFavorite === true, "expected listed card isFavorite true");

const weekFavoriteListA = await request(`/api/db/cards?weekId=2026-W25&favorite=true`, {
  headers: { Cookie: cookieA },
});
const weekFavoriteBodyA = await json(weekFavoriteListA);
assert(weekFavoriteListA.ok, `week favorite list A failed ${weekFavoriteListA.status}: ${JSON.stringify(weekFavoriteBodyA)}`);
assert(Array.isArray(weekFavoriteBodyA), "expected week favorite list to be array");
assert(weekFavoriteBodyA.some((card) => card.id === cardId && card.isFavorite === true), "expected week favorite list to include card");
```

- [ ] **Step 3: Add User B isolation and unfavorite assertions**

After `bodyB.total === 0` assertion, add:

```js
const favoriteB = await request(`/api/db/cards/${encodeURIComponent(cardId)}/favorite`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookieB },
  body: JSON.stringify({ favorite: true }),
});
assert(favoriteB.status === 404, `expected B favorite A card 404, got ${favoriteB.status}`);

const favoriteListB = await request(`/api/db/cards?weekId=all&page=1&pageSize=10&favorite=true&q=${encodeURIComponent(term)}`, {
  headers: { Cookie: cookieB },
});
const favoriteListBodyB = await json(favoriteListB);
assert(favoriteListB.ok, `favorite list B failed ${favoriteListB.status}: ${JSON.stringify(favoriteListBodyB)}`);
assert(favoriteListBodyB.total === 0, `expected B favorite total 0, got ${favoriteListBodyB.total}`);

const unfavoriteA = await request(`/api/db/cards/${encodeURIComponent(cardId)}/favorite`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookieA },
  body: JSON.stringify({ favorite: false }),
});
const unfavoriteBodyA = await json(unfavoriteA);
assert(unfavoriteA.ok, `unfavorite A failed ${unfavoriteA.status}: ${JSON.stringify(unfavoriteBodyA)}`);
assert(unfavoriteBodyA.isFavorite === false, "expected A favorite response false");
assert(unfavoriteBodyA.favoritedAt === null, `expected null favoritedAt, got ${unfavoriteBodyA.favoritedAt}`);

const afterUnfavoriteListA = await request(`/api/db/cards?weekId=all&page=1&pageSize=10&favorite=true&q=${encodeURIComponent(term)}`, {
  headers: { Cookie: cookieA },
});
const afterUnfavoriteBodyA = await json(afterUnfavoriteListA);
assert(afterUnfavoriteListA.ok, `after unfavorite list A failed ${afterUnfavoriteListA.status}: ${JSON.stringify(afterUnfavoriteBodyA)}`);
assert(afterUnfavoriteBodyA.total === 0, `expected A favorite total 0 after unfavorite, got ${afterUnfavoriteBodyA.total}`);

const normalListAfterUnfavoriteA = await request(`/api/db/cards?weekId=all&page=1&pageSize=10&q=${encodeURIComponent(term)}`, {
  headers: { Cookie: cookieA },
});
const normalListAfterUnfavoriteBodyA = await json(normalListAfterUnfavoriteA);
assert(normalListAfterUnfavoriteA.ok, `normal list after unfavorite failed ${normalListAfterUnfavoriteA.status}: ${JSON.stringify(normalListAfterUnfavoriteBodyA)}`);
assert(normalListAfterUnfavoriteBodyA.total === 1, "normal list should still include card after unfavorite");
assert(normalListAfterUnfavoriteBodyA.cards?.[0]?.isFavorite === false, "normal list should show isFavorite false after unfavorite");
```

- [ ] **Step 4: Run final verification**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands exit with code `0`.

If Docker app is running at `http://localhost:3005`, rebuild before smoke:

```bash
npm run docker:prod:detached
npm run auth:smoke
```

Expected:

```text
auth smoke passed
```

- [ ] **Step 5: Commit smoke coverage**

```bash
git add scripts/auth-smoke.mjs
git commit -m "test: cover card favorites"
```

## Self-Review

- Spec coverage: the plan covers schema, indexed backend queries, toggle API, card/detail UI, favorite-only current-week and all-history filters, search combination, multi-user isolation, and smoke verification.
- Scope check: this is a single Web feature. Mini program favorites are explicitly out of scope.
- Placeholder scan: no placeholder markers or unspecified implementation steps remain.
- Type consistency: the plan uses `isFavorite`, `favoritedAt`, `favoriteOnly`, and `updateCardFavorite` consistently across backend responses, `ImageCard`, `dbClient`, and `App`.
