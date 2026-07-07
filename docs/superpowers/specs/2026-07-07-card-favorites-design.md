# Card Favorites Design

## Goal

Add a Web favorite feature for inspiration cards.

Users can mark any card as a favorite and query favorites from the board. Favorites are a fast personal filter, separate from inspiration books. Inspiration books remain for organizing cards into custom collections; favorites are a one-click card state.

## Non-Goals

- Do not reuse inspiration books as a hidden "favorites" book.
- Do not add public sharing, collaboration, or ranking.
- Do not change current card upload, analysis, PhotoPrism proxy, Markdown, video, combo-card, or inspiration-book behavior.
- Do not remove existing all-history pagination.
- Do not add favorites to the mini program in this Web task.

## Core Model

Favorites live directly on `cards`.

- One card has one favorite state for its owner.
- Cards are already user-owned, so a boolean field is simpler and faster than a separate join table.
- All reads and writes remain scoped by `user_id`.

## Database Schema

Add columns during startup schema verification:

```sql
ALTER TABLE cards ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS favorited_at BIGINT;
```

Indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_cards_user_favorite_created_at
  ON cards(user_id, is_favorite, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cards_user_favorited_at
  ON cards(user_id, favorited_at DESC);
```

`idx_cards_user_favorite_created_at` supports the current all-history list order when `favorite=true`.
`idx_cards_user_favorited_at` is added now so a later "recently favorited" view will not require another migration.

## Backend API

All routes use the existing PostgreSQL auth middleware and continue to return only cards owned by the current user.

### List Cards

Extend the existing cards endpoint:

```http
GET /api/db/cards?weekId=all&page=1&pageSize=12&q=xxx&favorite=true
GET /api/db/cards?weekId=2026-W27&favorite=true
```

Rules:

- `favorite=true` filters to favorite cards.
- Any other `favorite` value is treated as no favorite filter.
- For `weekId=all`, favorite filtering combines with pagination and search.
- For a specific `weekId`, favorite filtering applies to that week query.
- Search continues to use `terms_text`, so tags, Markdown summaries, and insight notes remain searchable.

Response card rows include:

- `isFavorite`
- `favoritedAt`

### Toggle Favorite

Add:

```http
PUT /api/db/cards/:id/favorite
```

Body:

```json
{ "favorite": true }
```

Rules:

- `favorite: true` sets `is_favorite = true` and `favorited_at = Date.now()`.
- `favorite: false` sets `is_favorite = false` and `favorited_at = null`.
- Missing or non-boolean `favorite` returns `400`.
- Missing or unowned cards return `404`.
- Unauthenticated requests return `401` through existing auth middleware.
- The response returns the updated favorite state:

```json
{
  "id": "card_id",
  "isFavorite": true,
  "favoritedAt": 1783420000000
}
```

## Frontend Data Layer

Update `ImageCard` in `src/types.ts`:

- `isFavorite?: boolean`
- `favoritedAt?: number | null`

Update `src/lib/dbClient.ts`:

- `loadAllCardsPage({ page, pageSize, query, favoriteOnly })`
- `updateCardFavorite(cardId, favorite)`
- Week card loading should pass `favorite=true` when the board is in current-week favorite-only mode.
- Local cache updates should keep current week, all-history cache, and detail modal cards in sync.

The Firestore fallback can filter favorite state client-side if cards include it. This task mainly targets the current PostgreSQL Web runtime.

## UI Design

### Card Favorite Button

Add a small `Star` icon button to each `PolaroidCard`.

- Empty star: not favorited.
- Filled/highlighted star: favorited.
- Click toggles favorite and stops propagation so the card does not open.
- White/day theme uses ink-gold or cinnabar accents.
- Dark theme uses warm gold.
- Failed toggle reverts to the previous state and logs or shows a light inline error.

The delete button remains separate.

### Detail Favorite Button

Add the same favorite action to the detail modal.

- It uses the same card state as the list.
- Toggling in detail updates the current card, current-week list, and all-history list.
- If the current view is favorite-only and the user unfavorites the open card, closing the detail modal should reveal the filtered list without that card.

### Favorite Query Control

Add a compact favorite filter near the existing search and scope controls.

- Label: `收藏`
- Off: all cards for the selected scope.
- On: only favorites for the selected scope.
- It works with both `本周` and `所有历史周`.
- It stacks with search text, for example `收藏 + 水墨`.

Current-week behavior:

- Use the existing week list surface.
- Only favorite cards are shown when the filter is on.
- If no favorites match, show the existing empty-state style with copy indicating no favorite cards.

All-history behavior:

- Calls `/api/db/cards?weekId=all&page=...&favorite=true`.
- Keeps the existing page size and pagination UI.
- Reset to page 1 when the favorite filter changes.

## Data Flow

Favorite toggle:

1. User clicks a star.
2. Frontend optimistically updates the card state.
3. Frontend calls `PUT /api/db/cards/:id/favorite`.
4. On success, merge returned favorite state into all local copies.
5. On failure, revert the optimistic state.

Favorite query:

1. User enables `收藏`.
2. If scope is current week, the current week fetch includes `favorite=true` or filters the loaded week cards.
3. If scope is all history, `loadAllCardsPage` includes `favorite=true`.
4. Pagination metadata comes from the backend as it does today.

## Error Handling

- `401`: existing `authFetch` flow emits `auth:required`.
- `400`: invalid favorite payload, handled as a developer/client error.
- `404`: card missing or not owned by user.
- `500`: log server error and keep the previous UI state after rollback.
- Network failure: rollback optimistic toggle and keep the user on the same page.

## Testing

Extend `scripts/auth-smoke.mjs`:

- Unauthenticated favorite toggle returns `401`.
- User A can favorite their own card.
- User A can query `favorite=true` and see that card.
- User A can combine `favorite=true` with `q`.
- User A can unfavorite the card and it disappears from `favorite=true`.
- User B cannot favorite or query User A's card.
- Normal all-history query without `favorite=true` still returns the card.

Run verification:

```bash
npm run lint
npm run build
npm run auth:smoke
```

If preview is requested, rebuild Docker after the implementation.

## Acceptance Criteria

- A visible favorite star appears on Web cards and in the detail modal.
- Favorite state persists after refresh.
- Current-week favorites can be filtered.
- All-history favorites are paginated through the backend.
- Search and favorites work together.
- Multi-user isolation is preserved.
- Inspiration books continue to work independently.
