# Smart Book Suggestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in smart suggestions that recommend adding newly uploaded image or Markdown cards to the best matching inspiration book, with user confirmation before membership is changed.

**Architecture:** Keep matching on the frontend and reuse existing book APIs. `src/lib/bookSuggestion.ts` provides pure scoring helpers, `InspirationBooksView` renders and persists the two toggles, and `App` coordinates upload-completion events, book loading, duplicate checks, the confirmation modal, and `setCardBookMembership`.

**Tech Stack:** React 19, TypeScript, Vite, existing `authFetch` settings APIs, existing `booksClient` APIs, existing Express/Postgres backend without new routes.

---

## File Structure

- Create `src/lib/bookSuggestion.ts`
  - Pure TypeScript helper for normalization, scoring, and selecting the best matching inspiration book.
  - No React imports, no network calls.
- Modify `src/components/InspirationBooksView.tsx`
  - Add a compact smart suggestion control area at the top of the books page.
  - Render two independent toggles: image suggestions and Markdown suggestions.
  - Call parent callbacks when toggles change.
- Modify `src/App.tsx`
  - Load and save suggestion settings through existing `loadSettings` and `saveSettings`.
  - Load books for matching using existing `loadBooks`.
  - Trigger suggestion matching after image terms update and after Markdown card creation.
  - Render a confirmation modal and call `setCardBookMembership` on confirm.

## Task 1: Add Pure Matching Helper

**Files:**
- Create: `src/lib/bookSuggestion.ts`

- [ ] **Step 1: Create helper types and text normalization**

Create `src/lib/bookSuggestion.ts`:

```ts
import type { ImageCard, InspirationBook } from "../types";

export interface BookSuggestionMatch {
  book: InspirationBook;
  score: number;
  matchedTerms: string[];
}

function normalizeText(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/[~`!@#$%^&*()_\-+=[\]{}|\\:;"'<>,.?/，。！？；：“”‘’（）【】《》、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 2: Add token extraction**

Append:

```ts
function splitTokens(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function cardTexts(card: ImageCard): string[] {
  return unique([
    ...(card.terms || []),
    card.type === "md" ? card.mdName || "" : "",
    card.type === "md" ? card.mdSummary || "" : "",
  ]);
}

function bookText(book: InspirationBook): string {
  return normalizeText(`${book.title} ${book.description || ""}`);
}
```

- [ ] **Step 3: Add scoring function**

Append:

```ts
function scoreBook(card: ImageCard, book: InspirationBook): BookSuggestionMatch | null {
  const target = bookText(book);
  if (!target) return null;

  const texts = cardTexts(card);
  const matchedTerms: string[] = [];
  let score = 0;

  for (const rawText of texts) {
    const normalized = normalizeText(rawText);
    if (!normalized) continue;

    if (target.includes(normalized)) {
      score += normalized.length >= 4 ? 8 : 5;
      matchedTerms.push(rawText);
      continue;
    }

    const targetTokens = new Set(splitTokens(target));
    const textTokens = splitTokens(normalized);
    const overlap = textTokens.filter((token) => targetTokens.has(token));
    if (overlap.length > 0) {
      score += overlap.length * 2;
      matchedTerms.push(rawText);
      continue;
    }

    for (const token of textTokens) {
      if (token.length >= 3 && target.includes(token)) {
        score += 1;
        matchedTerms.push(rawText);
        break;
      }
    }
  }

  if (score <= 0) return null;
  return { book, score, matchedTerms: unique(matchedTerms).slice(0, 4) };
}
```

- [ ] **Step 4: Add public selector**

Append:

```ts
export function findBestBookSuggestion(
  card: ImageCard,
  books: InspirationBook[],
  options: { minScore?: number } = {},
): BookSuggestionMatch | null {
  const minScore = options.minScore ?? 6;
  const matches = books
    .map((book) => scoreBook(card, book))
    .filter((match): match is BookSuggestionMatch => Boolean(match))
    .sort((a, b) => b.score - a.score);

  const best = matches[0] || null;
  if (!best || best.score < minScore) return null;
  return best;
}
```

## Task 2: Add Suggestion Settings UI To Books Page

**Files:**
- Modify: `src/components/InspirationBooksView.tsx`

- [ ] **Step 1: Extend props**

Update `InspirationBooksViewProps`:

```ts
interface InspirationBooksViewProps {
  refreshToken: number;
  onZoom: (card: ImageCard) => void;
  onDeleteTerm: (cardId: string, termIndex: number) => void;
  onUpdateTerms: (cardId: string, terms: string[]) => void;
  onBookMembershipChanged: () => void;
  smartSuggestImages: boolean;
  smartSuggestMarkdown: boolean;
  onSmartSuggestImagesChange: (enabled: boolean) => void;
  onSmartSuggestMarkdownChange: (enabled: boolean) => void;
  smartSuggestSyncStatus: "clean" | "saving" | "error";
}
```

- [ ] **Step 2: Destructure new props**

Add to the function parameter destructuring:

```ts
smartSuggestImages,
smartSuggestMarkdown,
onSmartSuggestImagesChange,
onSmartSuggestMarkdownChange,
smartSuggestSyncStatus,
```

- [ ] **Step 3: Add a local toggle renderer**

Inside `InspirationBooksView`, before `return`, add:

```tsx
const renderSmartToggle = (
  label: string,
  enabled: boolean,
  onChange: (enabled: boolean) => void,
) => (
  <button
    type="button"
    onClick={() => onChange(!enabled)}
    className={`inline-flex h-8 items-center gap-2 rounded-full border px-2.5 text-[11px] font-semibold transition-all ${
      enabled
        ? "border-stone-900/20 bg-stone-900 text-[#fbf7ed] shadow-sm dark:border-amber-200/40 dark:bg-amber-200 dark:text-stone-950"
        : "border-stone-900/10 bg-white/45 text-stone-600 hover:border-stone-900/20 hover:text-stone-900 dark:border-white/10 dark:bg-white/[0.05] dark:text-stone-400 dark:hover:text-stone-100"
    }`}
    aria-pressed={enabled}
  >
    <span className={`h-3.5 w-3.5 rounded-full border ${
      enabled ? "border-[#fbf7ed] bg-[#fbf7ed] dark:border-stone-950 dark:bg-stone-950" : "border-current"
    }`} />
    {label}
  </button>
);
```

- [ ] **Step 4: Render smart controls near the page header**

In the header section of `InspirationBooksView`, under the title/description and before the search/action controls, insert:

```tsx
<div className="mt-4 flex flex-col gap-2 rounded-[8px] border border-stone-900/10 bg-white/35 px-3 py-3 dark:border-white/10 dark:bg-white/[0.04] md:flex-row md:items-center md:justify-between">
  <div>
    <div className="text-[12px] font-semibold text-stone-900 dark:text-stone-100">智能建议收录</div>
    <div className="mt-0.5 text-[11px] leading-snug text-stone-600 dark:text-stone-500">
      上传后根据标签和灵感册名称/描述推荐入册。
    </div>
  </div>
  <div className="flex flex-wrap items-center gap-2">
    {renderSmartToggle("图片建议入册", smartSuggestImages, onSmartSuggestImagesChange)}
    {renderSmartToggle("MD 建议入册", smartSuggestMarkdown, onSmartSuggestMarkdownChange)}
    {smartSuggestSyncStatus === "saving" ? (
      <span className="text-[10px] text-stone-500 dark:text-stone-500">同步中</span>
    ) : smartSuggestSyncStatus === "error" ? (
      <span className="text-[10px] text-red-700 dark:text-red-300">设置同步失败</span>
    ) : null}
  </div>
</div>
```

## Task 3: Wire Settings In App

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Import book APIs and helper**

Add imports near existing imports:

```ts
import { loadBooks, loadCardBookMembership, setCardBookMembership } from "./lib/booksClient";
import { findBestBookSuggestion, type BookSuggestionMatch } from "./lib/bookSuggestion";
```

- [ ] **Step 2: Add settings constants and state**

Near constants:

```ts
const SMART_BOOK_SUGGEST_IMAGES_KEY = "smart_book_suggest_images";
const SMART_BOOK_SUGGEST_MARKDOWN_KEY = "smart_book_suggest_markdown";
```

Inside `App` state:

```ts
const [smartSuggestImages, setSmartSuggestImages] = useState(false);
const [smartSuggestMarkdown, setSmartSuggestMarkdown] = useState(false);
const [smartSuggestSyncStatus, setSmartSuggestSyncStatus] = useState<"clean" | "saving" | "error">("clean");
const [smartSuggestion, setSmartSuggestion] = useState<{
  card: ImageCard;
  match: BookSuggestionMatch;
} | null>(null);
const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(() => new Set());
const [isApplyingSmartSuggestion, setIsApplyingSmartSuggestion] = useState(false);
const [smartSuggestionError, setSmartSuggestionError] = useState<string | null>(null);
```

- [ ] **Step 3: Load smart settings with existing settings load**

In the existing `loadSettings().then((dbSettings) => { ... })` block, add:

```ts
if (dbSettings[SMART_BOOK_SUGGEST_IMAGES_KEY] !== undefined) {
  setSmartSuggestImages(dbSettings[SMART_BOOK_SUGGEST_IMAGES_KEY] === "true");
}
if (dbSettings[SMART_BOOK_SUGGEST_MARKDOWN_KEY] !== undefined) {
  setSmartSuggestMarkdown(dbSettings[SMART_BOOK_SUGGEST_MARKDOWN_KEY] === "true");
}
```

- [ ] **Step 4: Add setting save helper**

Inside `App`, add:

```ts
const persistSmartSuggestSetting = async (key: string, value: boolean) => {
  setSmartSuggestSyncStatus("saving");
  try {
    await saveSettings({ [key]: String(value) });
    setSmartSuggestSyncStatus("clean");
  } catch (err) {
    console.error("Failed to save smart suggestion setting:", err);
    setSmartSuggestSyncStatus("error");
  }
};

const handleSmartSuggestImagesChange = (enabled: boolean) => {
  setSmartSuggestImages(enabled);
  void persistSmartSuggestSetting(SMART_BOOK_SUGGEST_IMAGES_KEY, enabled);
};

const handleSmartSuggestMarkdownChange = (enabled: boolean) => {
  setSmartSuggestMarkdown(enabled);
  void persistSmartSuggestSetting(SMART_BOOK_SUGGEST_MARKDOWN_KEY, enabled);
};
```

## Task 4: Add Suggestion Coordinator In App

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add suggestion key helper**

```ts
const suggestionKey = (cardId: string, bookId: string) => `${cardId}:${bookId}`;
```

- [ ] **Step 2: Add `maybeSuggestBookMembership`**

```ts
const maybeSuggestBookMembership = async (card: ImageCard) => {
  const shouldSuggest = card.type === "md" ? smartSuggestMarkdown : smartSuggestImages;
  if (!shouldSuggest || smartSuggestion) return;

  try {
    const books = await loadBooks();
    if (books.length === 0) return;

    const match = findBestBookSuggestion(card, books);
    if (!match) return;

    const key = suggestionKey(card.id, match.book.id);
    if (dismissedSuggestions.has(key)) return;

    const memberships = await loadCardBookMembership(card.id);
    const alreadyContains = memberships.some((book) => book.id === match.book.id && book.containsCard);
    if (alreadyContains) return;

    setSmartSuggestion({ card, match });
    setSmartSuggestionError(null);
  } catch (err) {
    console.warn("Smart book suggestion skipped:", err);
  }
};
```

- [ ] **Step 3: Add confirm and dismiss handlers**

```ts
const dismissSmartSuggestion = () => {
  if (smartSuggestion) {
    const key = suggestionKey(smartSuggestion.card.id, smartSuggestion.match.book.id);
    setDismissedSuggestions((current) => new Set(current).add(key));
  }
  setSmartSuggestion(null);
  setSmartSuggestionError(null);
};

const confirmSmartSuggestion = async () => {
  if (!smartSuggestion) return;
  setIsApplyingSmartSuggestion(true);
  setSmartSuggestionError(null);
  try {
    await setCardBookMembership(smartSuggestion.card.id, smartSuggestion.match.book.id, true);
    setBookRefreshToken((token) => token + 1);
    dismissSmartSuggestion();
  } catch (err) {
    setSmartSuggestionError(err instanceof Error ? err.message : "加入灵感册失败");
  } finally {
    setIsApplyingSmartSuggestion(false);
  }
};
```

## Task 5: Trigger Suggestions After Uploads

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Trigger after image terms update**

Inside `analyzeAndUpdateTerms`, after `await updateCardTerms(cardId, weekId, extractedTerms);`, add:

```ts
await maybeSuggestBookMembership({ ...newCard, terms: extractedTerms });
```

- [ ] **Step 2: Trigger after Markdown save**

After `await saveCard(newCard);` in `handleUploadMd`, add:

```ts
await maybeSuggestBookMembership(newCard);
```

## Task 6: Render Confirmation Modal

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add modal JSX near other top-level modals**

Add near the existing modal render area:

```tsx
<AnimatePresence>
  {smartSuggestion && (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-stone-950/45 backdrop-blur-sm"
        onClick={dismissSmartSuggestion}
      />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        className="relative w-full max-w-md rounded-[8px] border border-stone-900/10 bg-[#fbf7ed] p-5 text-stone-900 shadow-[0_24px_70px_rgba(28,25,23,0.25)] dark:border-white/10 dark:bg-stone-950 dark:text-stone-100"
      >
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-stone-900 text-[#fbf7ed] dark:bg-amber-200 dark:text-stone-950">
            <BookOpen size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="font-serif text-lg font-bold italic leading-snug">
              这条灵感可能适合加入《{smartSuggestion.match.book.title}》
            </h3>
            {smartSuggestion.match.book.description ? (
              <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
                {smartSuggestion.match.book.description}
              </p>
            ) : null}
          </div>
        </div>

        {smartSuggestion.match.matchedTerms.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {smartSuggestion.match.matchedTerms.map((term) => (
              <span key={term} className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-900 dark:bg-amber-300/15 dark:text-amber-100">
                {term}
              </span>
            ))}
          </div>
        ) : null}

        {smartSuggestionError ? (
          <div className="mt-4 rounded-[6px] bg-red-100 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200">
            {smartSuggestionError}
          </div>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={dismissSmartSuggestion}
            className="h-9 rounded-[6px] border border-stone-900/10 px-3 text-sm font-semibold text-stone-600 transition-colors hover:bg-stone-900/[0.04] dark:border-white/10 dark:text-stone-300 dark:hover:bg-white/[0.07]"
          >
            暂不加入
          </button>
          <button
            type="button"
            onClick={confirmSmartSuggestion}
            disabled={isApplyingSmartSuggestion}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[6px] bg-stone-900 px-3 text-sm font-semibold text-[#fbf7ed] transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-wait disabled:opacity-70 dark:bg-amber-200 dark:text-stone-950"
          >
            {isApplyingSmartSuggestion ? <Loader2 size={14} className="animate-spin" /> : <BookOpen size={14} />}
            加入灵感册
          </button>
        </div>
      </motion.div>
    </div>
  )}
</AnimatePresence>
```

## Task 7: Pass Props To Books View

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update `InspirationBooksView` usage**

Add props to the existing component usage:

```tsx
smartSuggestImages={smartSuggestImages}
smartSuggestMarkdown={smartSuggestMarkdown}
onSmartSuggestImagesChange={handleSmartSuggestImagesChange}
onSmartSuggestMarkdownChange={handleSmartSuggestMarkdownChange}
smartSuggestSyncStatus={smartSuggestSyncStatus}
```

## Task 8: Verify

**Files:**
- Verify: `src/lib/bookSuggestion.ts`
- Verify: `src/components/InspirationBooksView.tsx`
- Verify: `src/App.tsx`

- [ ] **Step 1: Run TypeScript check**

Run: `npm run lint`

Expected: `tsc --noEmit` completes successfully.

- [ ] **Step 2: Inspect diff**

Run: `git diff -- src/lib/bookSuggestion.ts src/components/InspirationBooksView.tsx src/App.tsx`

Expected: Changes are limited to helper, books-page toggles, settings wiring, upload triggers, and confirmation modal.

- [ ] **Step 3: Manual validation**

In the Web UI:

- Open the books page and verify both toggles are visible.
- Turn on image suggestions and leave Markdown suggestions off; upload an image with labels matching a book title or description and confirm a suggestion appears.
- Turn on Markdown suggestions and leave image suggestions off; upload a Markdown file with terms matching a book title or description and confirm a suggestion appears.
- Click `加入灵感册` and confirm the card appears in that book.
- Click `暂不加入` and confirm the same card/book suggestion does not immediately repeat.
- Confirm that cards already in the suggested book do not prompt again.
