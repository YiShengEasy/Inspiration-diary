# Inspiration Books Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private multi-book collection support so each authenticated user can create inspiration books and collect one inspiration card into multiple books.

**Architecture:** PostgreSQL stores user-owned books and a user-scoped many-to-many `book_cards` relationship. Express exposes authenticated book APIs beside existing `/api/db/cards`, while React adds a focused books client, collection popover, book list/detail views, and a torn-paper irregular "灵感册" navigation tab.

**Tech Stack:** React 19, Vite, Express 4, PostgreSQL via `pg`, TypeScript, existing `authFetch` / `requirePostgresAuth`, Lucide icons, Tailwind CSS classes, Docker production verification.

---

## File Structure

- Modify `server.ts`: initialize book tables and add authenticated book APIs.
- Modify `src/types.ts`: add `InspirationBook`, `CardBookMembership`, and `PaginatedBookCardsResult` interfaces.
- Create `src/lib/booksClient.ts`: focused client functions for books and memberships using `authFetch`.
- Create `src/components/CardBookPopover.tsx`: card-level collect/remove popover with quick-create.
- Create `src/components/InspirationBooksView.tsx`: book list, create/edit/delete, book detail, pagination, and search.
- Modify `src/components/PolaroidCard.tsx`: add a collect button and wire the popover trigger.
- Modify `src/App.tsx`: add `books` app mode, irregular "灵感册" tab, and route handlers for book/detail views.
- Modify `scripts/auth-smoke.mjs`: extend smoke coverage for book ownership and membership.

Current worktree note: before implementation, check `git status --short`. As of planning, `server.ts`, `src/App.tsx`, and `miniprogram/` have existing uncommitted changes. Preserve them and do not revert unrelated edits.

## Task 1: Backend Book Schema And API

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: Add schema initialization**

Inside the existing PostgreSQL `initDb` block in `server.ts`, after `settings` table ownership/index setup, add:

```ts
await client.query(`
  CREATE TABLE IF NOT EXISTS inspiration_books (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );
`);
await client.query(`
  CREATE TABLE IF NOT EXISTS inspiration_book_cards (
    book_id TEXT NOT NULL REFERENCES inspiration_books(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at BIGINT NOT NULL
  );
`);
await client.query("CREATE INDEX IF NOT EXISTS idx_inspiration_books_user_updated_at ON inspiration_books(user_id, updated_at DESC);");
await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_inspiration_book_cards_unique ON inspiration_book_cards(user_id, book_id, card_id);");
await client.query("CREATE INDEX IF NOT EXISTS idx_inspiration_book_cards_user_book_added_at ON inspiration_book_cards(user_id, book_id, added_at DESC);");
await client.query("CREATE INDEX IF NOT EXISTS idx_inspiration_book_cards_user_card ON inspiration_book_cards(user_id, card_id);");
```

- [ ] **Step 2: Add server-side card row mapper**

Near the existing `GET /api/db/cards` route, extract the current inline `mapCards` logic into a reusable function:

```ts
function mapCardRows(rows: any[]) {
  return rows.map((row) => ({
    id: row.id,
    weekId: row.week_id,
    dayIndex: row.day_index,
    imageUrl: row.image_url,
    thumbnailUrl: row.thumbnail_url || "",
    photoUid: row.photo_uid || "",
    photoHash: row.photo_hash || "",
    terms: row.terms || [],
    decoType: row.deco_type,
    angle: Number(row.angle),
    createdAt: Number(row.created_at),
    type: row.type || "image",
    mdContent: row.md_content || "",
    mdSummary: row.md_summary || "",
    mdName: row.md_name || "",
  }));
}
```

Replace the existing local `mapCards` usages in `GET /api/db/cards` with `mapCardRows`.

- [ ] **Step 3: Add book row mapper**

Add this helper below `mapCardRows`:

```ts
function mapBookRow(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    cardCount: Number(row.card_count || 0),
    coverCard: row.cover_card ? mapCardRows([row.cover_card])[0] : null,
  };
}
```

- [ ] **Step 4: Implement `GET /api/db/books`**

Add this route before `GET /api/db/cards`:

```ts
app.get("/api/db/books", requirePostgresAuth, async (req, res) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await pgPool.query(
      `SELECT
         b.id,
         b.title,
         b.description,
         b.created_at,
         b.updated_at,
         COUNT(bc.card_id)::int AS card_count,
         (
           SELECT row_to_json(c)
           FROM (
             SELECT c2.id, c2.week_id, c2.day_index, c2.image_url, c2.thumbnail_url, c2.photo_uid, c2.photo_hash,
                    c2.terms, c2.deco_type, c2.angle, c2.created_at, c2.type, c2.md_content, c2.md_summary, c2.md_name
             FROM inspiration_book_cards bc2
             INNER JOIN cards c2 ON c2.id = bc2.card_id AND c2.user_id = $1
             WHERE bc2.user_id = $1 AND bc2.book_id = b.id
             ORDER BY bc2.added_at DESC
             LIMIT 1
           ) c
         ) AS cover_card
       FROM inspiration_books b
       LEFT JOIN inspiration_book_cards bc ON bc.book_id = b.id AND bc.user_id = $1
       WHERE b.user_id = $1
       GROUP BY b.id
       ORDER BY b.updated_at DESC`,
      [authReq.user!.id]
    );
    return res.json(result.rows.map(mapBookRow));
  } catch (err: any) {
    console.error("Error fetching inspiration books:", err);
    return res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 5: Implement create/update/delete book routes**

Add:

```ts
app.post("/api/db/books", requirePostgresAuth, async (req, res) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  try {
    const authReq = req as AuthenticatedRequest;
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    if (!title) return res.status(400).json({ error: "Book title is required." });

    const now = Date.now();
    const id = `book_${Math.random().toString(36).slice(2, 12)}_${now.toString(36)}`;
    const result = await pgPool.query(
      `INSERT INTO inspiration_books (id, user_id, title, description, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING id, title, description, created_at, updated_at, 0::int AS card_count, NULL::json AS cover_card`,
      [id, authReq.user!.id, title, description, now]
    );
    return res.json(mapBookRow(result.rows[0]));
  } catch (err: any) {
    console.error("Error creating inspiration book:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.put("/api/db/books/:bookId", requirePostgresAuth, async (req, res) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  try {
    const authReq = req as AuthenticatedRequest;
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    if (!title) return res.status(400).json({ error: "Book title is required." });

    const result = await pgPool.query(
      `UPDATE inspiration_books
       SET title = $1, description = $2, updated_at = $3
       WHERE id = $4 AND user_id = $5
       RETURNING id`,
      [title, description, Date.now(), req.params.bookId, authReq.user!.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Book not found" });
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error updating inspiration book:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/db/books/:bookId", requirePostgresAuth, async (req, res) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await pgPool.query(
      "DELETE FROM inspiration_books WHERE id = $1 AND user_id = $2",
      [req.params.bookId, authReq.user!.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Book not found" });
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error deleting inspiration book:", err);
    return res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 6: Implement book cards pagination**

Add:

```ts
app.get("/api/db/books/:bookId/cards", requirePostgresAuth, async (req, res) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.id;
    const bookId = req.params.bookId;
    const book = await pgPool.query("SELECT id FROM inspiration_books WHERE id = $1 AND user_id = $2", [bookId, userId]);
    if (book.rowCount === 0) return res.status(404).json({ error: "Book not found" });

    const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
    const rawPageSize = Number.parseInt(String(req.query.pageSize || "12"), 10) || 12;
    const pageSize = Math.min(60, Math.max(1, rawPageSize));
    const offset = (page - 1) * pageSize;
    const q = String(req.query.q || "").trim();
    const values: Array<string | number> = [userId, bookId];
    const searchSql = q ? `AND c.terms_text ILIKE $3` : "";
    if (q) values.push(`%${q}%`);

    const countResult = await pgPool.query(
      `SELECT COUNT(*)::int AS total
       FROM inspiration_book_cards bc
       INNER JOIN cards c ON c.id = bc.card_id AND c.user_id = $1
       WHERE bc.user_id = $1 AND bc.book_id = $2 ${searchSql}`,
      values
    );
    const total = Number(countResult.rows[0]?.total || 0);

    values.push(pageSize);
    const limitParam = values.length;
    values.push(offset);
    const offsetParam = values.length;
    const cardsResult = await pgPool.query(
      `SELECT c.id, c.week_id, c.day_index, c.image_url, c.thumbnail_url, c.photo_uid, c.photo_hash,
              c.terms, c.deco_type, c.angle, c.created_at, c.type, c.md_content, c.md_summary, c.md_name
       FROM inspiration_book_cards bc
       INNER JOIN cards c ON c.id = bc.card_id AND c.user_id = $1
       WHERE bc.user_id = $1 AND bc.book_id = $2 ${searchSql}
       ORDER BY bc.added_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      values
    );

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return res.json({ cards: mapCardRows(cardsResult.rows), total, page, pageSize, totalPages });
  } catch (err: any) {
    console.error("Error fetching inspiration book cards:", err);
    return res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 7: Implement add/remove card membership**

Add:

```ts
app.post("/api/db/books/:bookId/cards", requirePostgresAuth, async (req, res) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.id;
    const cardId = String(req.body.cardId || "").trim();
    if (!cardId) return res.status(400).json({ error: "cardId is required." });

    const owned = await pgPool.query(
      `SELECT b.id AS book_id, c.id AS card_id
       FROM inspiration_books b
       INNER JOIN cards c ON c.id = $2 AND c.user_id = $1
       WHERE b.id = $3 AND b.user_id = $1`,
      [userId, cardId, req.params.bookId]
    );
    if (owned.rowCount === 0) return res.status(404).json({ error: "Book or card not found" });

    const now = Date.now();
    await pgPool.query(
      `INSERT INTO inspiration_book_cards (user_id, book_id, card_id, added_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, book_id, card_id) DO NOTHING`,
      [userId, req.params.bookId, cardId, now]
    );
    await pgPool.query("UPDATE inspiration_books SET updated_at = $1 WHERE id = $2 AND user_id = $3", [now, req.params.bookId, userId]);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error adding card to inspiration book:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/db/books/:bookId/cards/:cardId", requirePostgresAuth, async (req, res) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.id;
    const book = await pgPool.query("SELECT id FROM inspiration_books WHERE id = $1 AND user_id = $2", [req.params.bookId, userId]);
    if (book.rowCount === 0) return res.status(404).json({ error: "Book not found" });

    await pgPool.query(
      "DELETE FROM inspiration_book_cards WHERE user_id = $1 AND book_id = $2 AND card_id = $3",
      [userId, req.params.bookId, req.params.cardId]
    );
    await pgPool.query("UPDATE inspiration_books SET updated_at = $1 WHERE id = $2 AND user_id = $3", [Date.now(), req.params.bookId, userId]);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error removing card from inspiration book:", err);
    return res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 8: Implement card membership query**

Add:

```ts
app.get("/api/db/cards/:cardId/books", requirePostgresAuth, async (req, res) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.id;
    const card = await pgPool.query("SELECT id FROM cards WHERE id = $1 AND user_id = $2", [req.params.cardId, userId]);
    if (card.rowCount === 0) return res.status(404).json({ error: "Card not found" });

    const result = await pgPool.query(
      `SELECT b.id, b.title, b.description, COUNT(all_bc.card_id)::int AS card_count,
              CASE WHEN own_bc.card_id IS NULL THEN false ELSE true END AS contains_card
       FROM inspiration_books b
       LEFT JOIN inspiration_book_cards all_bc ON all_bc.book_id = b.id AND all_bc.user_id = $1
       LEFT JOIN inspiration_book_cards own_bc ON own_bc.book_id = b.id AND own_bc.user_id = $1 AND own_bc.card_id = $2
       WHERE b.user_id = $1
       GROUP BY b.id, own_bc.card_id
       ORDER BY b.updated_at DESC`,
      [userId, req.params.cardId]
    );
    return res.json(result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description || "",
      cardCount: Number(row.card_count || 0),
      containsCard: Boolean(row.contains_card),
    })));
  } catch (err: any) {
    console.error("Error fetching card inspiration book membership:", err);
    return res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 9: Run checks**

Run:

```bash
npm run lint
npm run build
```

Expected:

```text
both commands exit 0
```

- [ ] **Step 10: Commit**

Run:

```bash
git add server.ts
git commit -m "feat: add inspiration book APIs"
```

Expected:

```text
commit command exits 0
```

## Task 2: Book Types And Client

**Files:**
- Modify: `src/types.ts`
- Create: `src/lib/booksClient.ts`

- [ ] **Step 1: Add shared book types**

Append to `src/types.ts`:

```ts
export interface InspirationBook {
  id: string;
  title: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  cardCount: number;
  coverCard: ImageCard | null;
}

export interface CardBookMembership {
  id: string;
  title: string;
  description: string;
  cardCount: number;
  containsCard: boolean;
}

export interface PaginatedBookCardsResult {
  cards: ImageCard[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
```

- [ ] **Step 2: Create client module**

Create `src/lib/booksClient.ts`:

```ts
import type { CardBookMembership, InspirationBook, PaginatedBookCardsResult } from "../types";
import { authFetch } from "./authClient";

async function parseJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || res.statusText);
  }
  return body as T;
}

export async function loadBooks(): Promise<InspirationBook[]> {
  const res = await authFetch("/api/db/books");
  return parseJson<InspirationBook[]>(res);
}

export async function createBook(input: { title: string; description?: string }): Promise<InspirationBook> {
  const res = await authFetch("/api/db/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson<InspirationBook>(res);
}

export async function updateBook(bookId: string, input: { title: string; description?: string }): Promise<void> {
  const res = await authFetch(`/api/db/books/${encodeURIComponent(bookId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await parseJson<{ success: boolean }>(res);
}

export async function deleteBook(bookId: string): Promise<void> {
  const res = await authFetch(`/api/db/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
  await parseJson<{ success: boolean }>(res);
}

export async function loadBookCards(params: {
  bookId: string;
  page: number;
  pageSize: number;
  query?: string;
}): Promise<PaginatedBookCardsResult> {
  const searchParams = new URLSearchParams({
    page: String(Math.max(1, params.page)),
    pageSize: String(Math.max(1, params.pageSize)),
  });
  const q = (params.query || "").trim();
  if (q) searchParams.set("q", q);
  const res = await authFetch(`/api/db/books/${encodeURIComponent(params.bookId)}/cards?${searchParams.toString()}`);
  return parseJson<PaginatedBookCardsResult>(res);
}

export async function loadCardBookMembership(cardId: string): Promise<CardBookMembership[]> {
  const res = await authFetch(`/api/db/cards/${encodeURIComponent(cardId)}/books`);
  return parseJson<CardBookMembership[]>(res);
}

export async function setCardBookMembership(cardId: string, bookId: string, shouldContain: boolean): Promise<void> {
  const url = `/api/db/books/${encodeURIComponent(bookId)}/cards${shouldContain ? "" : `/${encodeURIComponent(cardId)}`}`;
  const res = await authFetch(url, {
    method: shouldContain ? "POST" : "DELETE",
    headers: shouldContain ? { "Content-Type": "application/json" } : undefined,
    body: shouldContain ? JSON.stringify({ cardId }) : undefined,
  });
  await parseJson<{ success: boolean }>(res);
}
```

- [ ] **Step 3: Run checks**

Run:

```bash
npm run lint
npm run build
```

Expected:

```text
both commands exit 0
```

- [ ] **Step 4: Commit**

Run:

```bash
git add src/types.ts src/lib/booksClient.ts
git commit -m "feat: add inspiration book client"
```

Expected:

```text
commit command exits 0
```

## Task 3: Card Collection Popover

**Files:**
- Create: `src/components/CardBookPopover.tsx`
- Modify: `src/components/PolaroidCard.tsx`

- [ ] **Step 1: Create popover component**

Create `src/components/CardBookPopover.tsx`:

```tsx
import { useEffect, useState } from "react";
import { BookOpen, Loader2, Plus, X } from "lucide-react";
import type { CardBookMembership } from "../types";
import { createBook, loadCardBookMembership, setCardBookMembership } from "../lib/booksClient";

interface CardBookPopoverProps {
  cardId: string;
  onClose: () => void;
  onChanged?: () => void;
}

export default function CardBookPopover({ cardId, onClose, onChanged }: CardBookPopoverProps) {
  const [books, setBooks] = useState<CardBookMembership[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyBookId, setBusyBookId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const reload = async () => {
    setIsLoading(true);
    try {
      setBooks(await loadCardBookMembership(cardId));
    } catch (err: any) {
      setError(err.message || "加载灵感册失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, [cardId]);

  const toggleBook = async (bookId: string, nextValue: boolean) => {
    setBusyBookId(bookId);
    setError("");
    try {
      await setCardBookMembership(cardId, bookId, nextValue);
      setBooks((current) => current.map((book) => book.id === bookId ? { ...book, containsCard: nextValue } : book));
      onChanged?.();
    } catch (err: any) {
      setError(err.message || "更新收录失败");
      await reload();
    } finally {
      setBusyBookId(null);
    }
  };

  const createAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) {
      setError("请输入册名");
      return;
    }
    setIsCreating(true);
    setError("");
    try {
      const book = await createBook({ title });
      await setCardBookMembership(cardId, book.id, true);
      setNewTitle("");
      await reload();
      onChanged?.();
    } catch (err: any) {
      setError(err.message || "新建灵感册失败");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="absolute right-0 top-8 z-50 w-64 rounded-md border border-amber-900/10 dark:border-stone-700 bg-white/95 dark:bg-stone-900/95 shadow-xl backdrop-blur-md p-3 text-left">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700 dark:text-stone-200">
          <BookOpen size={14} />
          <span>收录到灵感册</span>
        </div>
        <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-100">
          <X size={14} />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-stone-500">
          <Loader2 size={14} className="animate-spin" />
          <span>正在读取...</span>
        </div>
      ) : (
        <div className="max-h-48 overflow-y-auto space-y-1">
          {books.length === 0 ? (
            <p className="py-3 text-xs text-stone-500 dark:text-stone-400">还没有灵感册。</p>
          ) : books.map((book) => (
            <label key={book.id} className="flex items-start gap-2 rounded-sm px-2 py-1.5 hover:bg-amber-50 dark:hover:bg-stone-800 cursor-pointer">
              <input
                type="checkbox"
                checked={book.containsCard}
                disabled={busyBookId === book.id}
                onChange={(e) => toggleBook(book.id, e.target.checked)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-xs text-stone-700 dark:text-stone-200 truncate">{book.title}</span>
                <span className="block text-[10px] text-stone-400">{book.cardCount} 张</span>
              </span>
            </label>
          ))}
        </div>
      )}

      <form onSubmit={createAndAdd} className="mt-3 flex gap-1.5">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="新建册名"
          className="min-w-0 flex-1 rounded-sm border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-950 px-2 py-1 text-xs outline-none focus:border-amber-500"
        />
        <button
          type="submit"
          disabled={isCreating}
          className="inline-flex items-center justify-center rounded-sm bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 px-2 disabled:opacity-50"
          title="新建并收录"
        >
          {isCreating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
        </button>
      </form>

      {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Add PolaroidCard props**

In `src/components/PolaroidCard.tsx`, import `BookOpen` and `CardBookPopover`:

```tsx
import { X, Plus, BookOpen } from "lucide-react";
import CardBookPopover from "./CardBookPopover";
```

Extend props:

```ts
onBookMembershipChanged?: () => void;
deleteCardTitle?: string;
```

Add state:

```ts
const [isBookPopoverOpen, setIsBookPopoverOpen] = useState(false);
```

Update the component signature to include the new optional props:

```tsx
export default function PolaroidCard({
  card,
  onDeleteCard,
  onDeleteTerm,
  onZoom,
  onUpdateTerms,
  onBookMembershipChanged,
  deleteCardTitle,
}: PolaroidCardProps) {
```

- [ ] **Step 3: Add collect button**

Near the existing delete button, add:

```tsx
<div className="absolute -top-2 -left-2 z-40">
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      setIsBookPopoverOpen((value) => !value);
    }}
    className="opacity-0 group-hover/card:opacity-100 bg-amber-50 dark:bg-stone-800 hover:bg-amber-100 dark:hover:bg-stone-700 text-amber-800 dark:text-amber-200 rounded-full p-1.5 transition-all cursor-pointer shadow-sm border border-amber-200/70 dark:border-stone-700"
    title="收录到灵感册"
  >
    <BookOpen size={12} strokeWidth={2.5} />
  </button>
  {isBookPopoverOpen && (
    <CardBookPopover
      cardId={card.id}
      onClose={() => setIsBookPopoverOpen(false)}
      onChanged={onBookMembershipChanged}
    />
  )}
</div>
```

Then change the existing whole-card delete button title from a hardcoded string to:

```tsx
title={deleteCardTitle || "删除这张相片卡"}
```

- [ ] **Step 4: Run checks**

Run:

```bash
npm run lint
npm run build
```

Expected:

```text
both commands exit 0
```

- [ ] **Step 5: Commit**

Run:

```bash
git add src/components/CardBookPopover.tsx src/components/PolaroidCard.tsx
git commit -m "feat: add card book collection popover"
```

Expected:

```text
commit command exits 0
```

## Task 4: Books View And Irregular Navigation Entry

**Files:**
- Create: `src/components/InspirationBooksView.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create books view component**

Create `src/components/InspirationBooksView.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Archive, BookOpen, ChevronLeft, ChevronRight, Edit3, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import type { ImageCard, InspirationBook } from "../types";
import { createBook, deleteBook, loadBookCards, loadBooks, updateBook, setCardBookMembership } from "../lib/booksClient";
import PolaroidCard from "./PolaroidCard";

const BOOK_PAGE_SIZE = 12;

interface InspirationBooksViewProps {
  onZoom: (card: ImageCard) => void;
  onDeleteTerm: (cardId: string, termIndex: number) => void;
  onUpdateTerms: (cardId: string, terms: string[]) => void;
}

export default function InspirationBooksView({ onZoom, onDeleteTerm, onUpdateTerms }: InspirationBooksViewProps) {
  const [books, setBooks] = useState<InspirationBook[]>([]);
  const [selectedBook, setSelectedBook] = useState<InspirationBook | null>(null);
  const [cards, setCards] = useState<ImageCard[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [isLoadingBooks, setIsLoadingBooks] = useState(false);
  const [isLoadingCards, setIsLoadingCards] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const refreshBooks = async () => {
    setIsLoadingBooks(true);
    try {
      const nextBooks = await loadBooks();
      setBooks(nextBooks);
      if (selectedBook) {
        setSelectedBook(nextBooks.find((book) => book.id === selectedBook.id) || null);
      }
    } catch (err: any) {
      setError(err.message || "加载灵感册失败");
    } finally {
      setIsLoadingBooks(false);
    }
  };

  const refreshCards = async () => {
    if (!selectedBook) return;
    setIsLoadingCards(true);
    try {
      const result = await loadBookCards({ bookId: selectedBook.id, page, pageSize: BOOK_PAGE_SIZE, query });
      setCards(result.cards);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err: any) {
      setError(err.message || "加载册内灵感失败");
    } finally {
      setIsLoadingCards(false);
    }
  };

  useEffect(() => {
    refreshBooks();
  }, []);

  useEffect(() => {
    refreshCards();
  }, [selectedBook?.id, page, query]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("请输入册名");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const book = await createBook({ title: cleanTitle, description: description.trim() });
      setTitle("");
      setDescription("");
      await refreshBooks();
      setSelectedBook(book);
    } catch (err: any) {
      setError(err.message || "新建灵感册失败");
    } finally {
      setIsSaving(false);
    }
  };

  const removeFromBook = async (cardId: string) => {
    if (!selectedBook) return;
    await setCardBookMembership(cardId, selectedBook.id, false);
    await refreshCards();
    await refreshBooks();
  };

  const deleteSelectedBook = async () => {
    if (!selectedBook) return;
    await deleteBook(selectedBook.id);
    setSelectedBook(null);
    setCards([]);
    await refreshBooks();
  };

  if (selectedBook) {
    return (
      <section className="w-full">
        <div className="mb-5 flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <button type="button" onClick={() => setSelectedBook(null)} className="mb-3 text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
              ← 返回灵感册
            </button>
            <h2 className="font-serif text-3xl text-stone-800 dark:text-stone-100">{selectedBook.title}</h2>
            {selectedBook.description && <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{selectedBook.description}</p>}
            <p className="mt-1 text-xs text-stone-400">共 {total} 张</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                placeholder="搜索册内灵感"
                className="pl-7 pr-3 py-2 rounded-md border border-stone-200 dark:border-stone-700 bg-white/70 dark:bg-stone-900/70 text-sm outline-none"
              />
            </div>
            <button type="button" onClick={deleteSelectedBook} className="p-2 rounded-md border border-red-200 text-red-500 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/30" title="删除灵感册">
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        {isLoadingCards ? (
          <div className="flex items-center gap-2 py-12 text-sm text-stone-500"><Loader2 className="animate-spin" size={16} /> 正在加载...</div>
        ) : cards.length === 0 ? (
          <div className="py-16 text-center text-sm text-stone-500 border border-dashed border-stone-200 dark:border-stone-700">这本册子还没有收录灵感。</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-8">
            {cards.map((card) => (
              <div key={card.id} className="relative">
                <PolaroidCard
                  card={card}
                  onDeleteCard={removeFromBook}
                  onDeleteTerm={onDeleteTerm}
                  onZoom={onZoom}
                  onUpdateTerms={onUpdateTerms}
                  deleteCardTitle="从本册移除"
                  onBookMembershipChanged={() => { refreshBooks(); refreshCards(); }}
                />
                <button
                  type="button"
                  onClick={() => removeFromBook(card.id)}
                  className="mt-2 w-full text-[11px] text-stone-500 hover:text-red-500"
                >
                  从本册移除
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex items-center justify-center gap-3">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="p-2 disabled:opacity-30"><ChevronLeft size={16} /></button>
          <span className="text-xs text-stone-500">{page} / {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="p-2 disabled:opacity-30"><ChevronRight size={16} /></button>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full">
      <div className="mb-5 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h2 className="font-serif text-3xl text-stone-800 dark:text-stone-100 flex items-center gap-2">
            <Archive size={24} />
            灵感册
          </h2>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">把分散的灵感收录成自己的主题册。</p>
        </div>
        <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="新建册名" className="px-3 py-2 rounded-md border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 text-sm outline-none" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="描述（可选）" className="px-3 py-2 rounded-md border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 text-sm outline-none" />
          <button type="submit" disabled={isSaving} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm disabled:opacity-50">
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            新建
          </button>
        </form>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      {isLoadingBooks ? (
        <div className="flex items-center gap-2 py-12 text-sm text-stone-500"><Loader2 className="animate-spin" size={16} /> 正在加载...</div>
      ) : books.length === 0 ? (
        <div className="py-16 text-center text-sm text-stone-500 border border-dashed border-stone-200 dark:border-stone-700">还没有灵感册，先新建一本。</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {books.map((book) => (
            <button
              key={book.id}
              type="button"
              onClick={() => { setSelectedBook(book); setPage(1); setQuery(""); }}
              className="text-left border border-stone-200 dark:border-stone-700 bg-white/70 dark:bg-stone-900/70 hover:bg-amber-50 dark:hover:bg-stone-800 transition-colors p-4 rounded-md"
            >
              <div className="aspect-[4/3] mb-3 bg-stone-100 dark:bg-stone-800 overflow-hidden rounded-sm flex items-center justify-center">
                {book.coverCard ? (
                  book.coverCard.type === "md" ? <BookOpen className="text-stone-400" size={32} /> : <img src={book.coverCard.thumbnailUrl || book.coverCard.imageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Archive className="text-stone-300" size={36} />
                )}
              </div>
              <h3 className="font-serif text-lg text-stone-800 dark:text-stone-100">{book.title}</h3>
              {book.description && <p className="mt-1 text-sm text-stone-500 line-clamp-2">{book.description}</p>}
              <p className="mt-3 text-xs text-stone-400">{book.cardCount} 张 · {new Date(book.updatedAt).toLocaleDateString()}</p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Add app view state**

In `src/App.tsx`, add:

```ts
const [mainView, setMainView] = useState<"board" | "books">("board");
```

When switching current/all history buttons, call `setMainView("board")`.

- [ ] **Step 3: Import books view**

Add:

```ts
import InspirationBooksView from "./components/InspirationBooksView";
```

- [ ] **Step 4: Add irregular navigation tab**

Near the existing top navigation controls, add this button:

```tsx
<button
  type="button"
  onClick={() => setMainView("books")}
  className={[
    "relative inline-flex items-center gap-2 px-4 py-2 text-sm font-serif transition-all shadow-sm",
    "bg-amber-100/80 dark:bg-amber-900/30 text-amber-950 dark:text-amber-100",
    "border border-amber-900/10 dark:border-amber-100/10",
    "[clip-path:polygon(0_8%,88%_0,100%_50%,88%_100%,0_92%,7%_50%)]",
    mainView === "books" ? "translate-x-1 -rotate-1" : "hover:translate-x-1 hover:-rotate-1"
  ].join(" ")}
  title="灵感册"
>
  <BookOpen size={15} />
  <span>灵感册</span>
</button>
```

Ensure `BookOpen` is imported from `lucide-react`.

- [ ] **Step 5: Render books view**

Where the main board/history content is rendered, branch on `mainView`:

```tsx
{mainView === "books" ? (
  <InspirationBooksView
    onZoom={setZoomedCard}
    onDeleteTerm={handleDeleteTerm}
    onUpdateTerms={handleUpdateCardTerms}
  />
) : (
  // existing current/all board content
)}
```

Keep all existing board/history JSX inside the `else` branch.

- [ ] **Step 6: Pass membership refresh to cards**

For every `PolaroidCard` rendered in `src/App.tsx`, add:

```tsx
onBookMembershipChanged={() => {
  if (searchScope === "all") {
    loadHistoricalCardsPage(allCardsPage);
  }
}}
```

For current-week cards, use a no-op or omit the prop.

- [ ] **Step 7: Run checks**

Run:

```bash
npm run lint
npm run build
```

Expected:

```text
both commands exit 0
```

- [ ] **Step 8: Commit**

Run:

```bash
git add src/components/InspirationBooksView.tsx src/App.tsx
git commit -m "feat: add inspiration books view"
```

Expected:

```text
commit command exits 0
```

## Task 5: Book Smoke Coverage

**Files:**
- Modify: `scripts/auth-smoke.mjs`

- [ ] **Step 1: Extend smoke script after card creation**

After the existing user A card creation in `scripts/auth-smoke.mjs`, add:

```js
async function createBook(cookie, title) {
  const res = await request("/api/db/books", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ title }),
  });
  const body = await json(res);
  assert(res.ok, `create book ${title} failed ${res.status}: ${JSON.stringify(body)}`);
  assert(body.id, `create book ${title} returned no id`);
  return body;
}

const bookA1 = await createBook(cookieA, `Smoke Book One ${suffix}`);
const bookA2 = await createBook(cookieA, `Smoke Book Two ${suffix}`);

for (const book of [bookA1, bookA2]) {
  const add = await request(`/api/db/books/${encodeURIComponent(book.id)}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieA },
    body: JSON.stringify({ cardId }),
  });
  assert(add.ok, `add card to book failed ${add.status}: ${JSON.stringify(await json(add))}`);
}

const booksA = await request("/api/db/books", { headers: { Cookie: cookieA } });
const booksABody = await json(booksA);
assert(booksA.ok, `list A books failed ${booksA.status}`);
assert(booksABody.some((book) => book.id === bookA1.id && book.cardCount === 1), "book one count missing");
assert(booksABody.some((book) => book.id === bookA2.id && book.cardCount === 1), "book two count missing");

const membership = await request(`/api/db/cards/${encodeURIComponent(cardId)}/books`, { headers: { Cookie: cookieA } });
const membershipBody = await json(membership);
assert(membership.ok, `membership failed ${membership.status}`);
assert(membershipBody.filter((book) => book.containsCard).length >= 2, "card should be in at least two books");

const bookCards = await request(`/api/db/books/${encodeURIComponent(bookA1.id)}/cards?page=1&pageSize=12&q=smoke-auth`, {
  headers: { Cookie: cookieA },
});
const bookCardsBody = await json(bookCards);
assert(bookCards.ok, `book cards failed ${bookCards.status}`);
assert(bookCardsBody.total === 1, `expected book card total 1, got ${bookCardsBody.total}`);

const bCannotSee = await request(`/api/db/books/${encodeURIComponent(bookA1.id)}/cards?page=1&pageSize=12`, {
  headers: { Cookie: cookieB },
});
assert(bCannotSee.status === 404, `expected B book cards 404, got ${bCannotSee.status}`);

const remove = await request(`/api/db/books/${encodeURIComponent(bookA1.id)}/cards/${encodeURIComponent(cardId)}`, {
  method: "DELETE",
  headers: { Cookie: cookieA },
});
assert(remove.ok, `remove card from book failed ${remove.status}`);

const afterRemove = await request(`/api/db/books/${encodeURIComponent(bookA1.id)}/cards?page=1&pageSize=12&q=smoke-auth`, {
  headers: { Cookie: cookieA },
});
const afterRemoveBody = await json(afterRemove);
assert(afterRemoveBody.total === 0, `expected removed book total 0, got ${afterRemoveBody.total}`);

const deleteBook = await request(`/api/db/books/${encodeURIComponent(bookA2.id)}`, {
  method: "DELETE",
  headers: { Cookie: cookieA },
});
assert(deleteBook.ok, `delete book failed ${deleteBook.status}`);

const cardStillThere = await request("/api/db/cards?weekId=all&page=1&pageSize=10&q=smoke-auth", {
  headers: { Cookie: cookieA },
});
const cardStillThereBody = await json(cardStillThere);
assert(cardStillThereBody.total === 1, "deleting book should not delete card");
```

- [ ] **Step 2: Run checks**

Run:

```bash
npm run lint
npm run build
```

Expected:

```text
both commands exit 0
```

- [ ] **Step 3: Commit**

Run:

```bash
git add scripts/auth-smoke.mjs
git commit -m "test: cover inspiration books"
```

Expected:

```text
commit command exits 0
```

## Task 6: Docker And Browser Verification

**Files:**
- No source files should change unless verification exposes a defect.

- [ ] **Step 1: Rebuild production Docker**

Run:

```bash
npm run docker:prod:detached
```

Expected:

```text
command exits 0 and container starts
```

- [ ] **Step 2: Confirm container status**

Run:

```bash
docker compose ps
```

Expected:

```text
output contains inspiration-diary-app-1, Up, and 0.0.0.0:3005->3000/tcp
```

- [ ] **Step 3: Run smoke tests**

Run:

```bash
npm run auth:smoke
```

Expected:

```text
auth smoke passed
```

- [ ] **Step 4: Browser text/state verification**

Open `http://localhost:3005/` in the in-app browser and verify without image preview confirmation:

- Login succeeds for an existing local user.
- Irregular `灵感册` tab is visible.
- `灵感册` tab uses a non-rectangular torn-paper/bookmark shape.
- Creating a book succeeds.
- A card can be added to two books from its card popover.
- Opening a book shows the card.
- Removing a card from one book does not delete it from the main board.
- Deleting a book does not delete the card.

- [ ] **Step 5: Final status check**

Run:

```bash
git status --short
```

Expected:

```text
no unexpected implementation changes remain
```

## Self-Review

Spec coverage:

- Many-to-many private books are implemented by Task 1 schema and API.
- User-scoped access is enforced by Task 1 routes using `requirePostgresAuth` and `user_id`.
- Frontend client functions are implemented by Task 2.
- Card collection popover and quick-create are implemented by Task 3.
- Irregular "灵感册" navigation tab and book list/detail views are implemented by Task 4.
- Smoke and Docker/browser verification are implemented by Tasks 5 and 6.

Type consistency:

- `InspirationBook`, `CardBookMembership`, and `PaginatedBookCardsResult` are defined in Task 2 and reused by later tasks.
- Backend response fields use `createdAt`, `updatedAt`, `cardCount`, `coverCard`, and `containsCard`, matching frontend names.
- `setCardBookMembership(cardId, bookId, shouldContain)` is the single client function used by both popover and book detail removal.

Scope check:

- The plan excludes sharing, export, collaboration, custom covers, and drag ordering.
- The plan preserves current weekly board, all-history pagination, auth, PhotoPrism proxy, image cards, and Markdown cards.
