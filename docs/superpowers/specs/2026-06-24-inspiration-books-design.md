# Inspiration Books Design

## Goal

Add a "收录成册" feature to Inspiration Diary.

Users can create custom inspiration books and add any inspiration card to one or more books. The feature must preserve the current local-auth, PostgreSQL, PhotoPrism proxy, weekly board, all-history pagination, and image/Markdown card behavior.

## Non-Goals

- Do not add public sharing.
- Do not add collaboration.
- Do not add export to PDF, image, or Markdown.
- Do not move cards out of their original week.
- Do not delete cards when a book is deleted.
- Do not redesign the whole app navigation.

## Core Model

Use a many-to-many relationship:

- One user can create many books.
- One book can contain many cards.
- One card can be collected into many books.

Books are private to the authenticated user. Every table and route must be scoped by `user_id`.

## Database Schema

### `inspiration_books`

Stores user-owned book metadata.

- `id TEXT PRIMARY KEY`
- `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `title TEXT NOT NULL`
- `description TEXT`
- `created_at BIGINT NOT NULL`
- `updated_at BIGINT NOT NULL`

Indexes:

- `idx_inspiration_books_user_updated_at` on `(user_id, updated_at DESC)`

### `inspiration_book_cards`

Stores which cards are collected into which books.

- `book_id TEXT NOT NULL REFERENCES inspiration_books(id) ON DELETE CASCADE`
- `card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE`
- `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `added_at BIGINT NOT NULL`
- Primary key or unique index on `(user_id, book_id, card_id)`

Indexes:

- `idx_inspiration_book_cards_user_book_added_at` on `(user_id, book_id, added_at DESC)`
- `idx_inspiration_book_cards_user_card` on `(user_id, card_id)`

The relationship table includes `user_id` even though book and card are user-owned. This keeps all access checks simple and indexed.

## Backend API

All routes use the existing `requirePostgresAuth` middleware and current `authFetch` frontend path.

### Books

`GET /api/db/books`

Returns all books owned by the current user, sorted by `updated_at DESC`.

Each item includes:

- `id`
- `title`
- `description`
- `createdAt`
- `updatedAt`
- `cardCount`
- `coverCard`

`coverCard` is the most recently added card in the book. It can be `null` for empty books.

`POST /api/db/books`

Creates a book.

Input:

- `title`
- optional `description`

Rules:

- Title must not be empty.
- Server generates the book id.
- Server injects `user_id`.

`PUT /api/db/books/:bookId`

Updates title and description.

Rules:

- Only updates rows where `user_id = currentUser.id`.
- Returns `404` if the book does not exist for the current user.

`DELETE /api/db/books/:bookId`

Deletes the book and collection relationships.

Rules:

- Does not delete any cards.
- Returns success for a valid owned book deletion.
- Returns `404` for missing or unowned books.

### Book Cards

`GET /api/db/books/:bookId/cards?page=1&pageSize=12&q=`

Returns paginated cards in a book.

Rules:

- Book must belong to current user.
- Query joins `inspiration_book_cards` to `cards`.
- Search uses existing card `terms_text`, so image tags and Markdown summaries remain searchable.
- Sort by `added_at DESC`.
- Response shape matches all-history pagination:

```json
{
  "cards": [],
  "total": 0,
  "page": 1,
  "pageSize": 12,
  "totalPages": 1
}
```

`POST /api/db/books/:bookId/cards`

Adds a card to a book.

Input:

- `cardId`

Rules:

- Book and card must both belong to current user.
- Re-adding an existing pair is idempotent.
- Updates the book `updated_at`.

`DELETE /api/db/books/:bookId/cards/:cardId`

Removes a card from a book.

Rules:

- Removes only the relationship.
- Does not delete the card.
- Updates the book `updated_at`.
- Returns `404` if the book is unowned or missing.

`GET /api/db/cards/:cardId/books`

Returns all books owned by the current user and whether the card is in each book.

Response item:

- `id`
- `title`
- `description`
- `cardCount`
- `containsCard`

Rules:

- Card must belong to current user.
- Returns `404` for missing or unowned card.

## Frontend Data Layer

Add book APIs to `src/lib/dbClient.ts` or a focused `src/lib/booksClient.ts`.

Recommended focused client functions:

- `loadBooks()`
- `createBook({ title, description })`
- `updateBook(bookId, { title, description })`
- `deleteBook(bookId)`
- `loadBookCards({ bookId, page, pageSize, query })`
- `loadCardBookMembership(cardId)`
- `setCardBookMembership(cardId, bookId, shouldContain)`

All functions use `authFetch`.

## UI Design

### Navigation Entry

Add a primary "灵感册" entry to the authenticated app.

This entry must use an irregular button, not a standard rounded rectangle.

Style:

- Shape: torn-paper bookmark / page index tab.
- Visual language: handmade paper, notebook tab, lightly skewed edge.
- Interaction: hover makes the tab slide or lift slightly as if being pulled out.
- Icon: use a familiar icon such as `BookOpen` or `Archive`.
- Text: `灵感册`.
- It should fit the current analog journal, Polaroid, paper tape, and ink aesthetic.

Implementation can use CSS `clip-path`, pseudo-elements, subtle rotation, and shadows. It should remain keyboard focusable and accessible as a button.

### Book List View

When the user opens "灵感册", show a book list view.

Each book item shows:

- cover preview from the latest collected card
- title
- optional description
- card count
- updated time

Empty state:

- Show a simple prompt to create the first book.
- Do not use a marketing hero page.

Book creation:

- Provide a compact create form or modal.
- Required title.
- Optional description.

### Add Card To Books

Every `PolaroidCard` gets a collection entry.

Interaction:

- Add a small `BookOpen` or bookmark icon near existing hover controls.
- Clicking opens a compact popover.
- Popover lists all books with checkboxes.
- Checking a book adds the card.
- Unchecking removes the card from that book.
- The popover also allows quick-create: enter a title, create book, and add the current card.

The card itself remains in its week and all-history views.

### Book Detail View

Clicking a book opens a detail view.

Features:

- title and description
- edit title/description
- delete book
- paginated card grid
- search within the book
- remove card from this book

Card rendering reuses existing `PolaroidCard` where possible. The remove action must be visually distinct from deleting the original card.

## State And Synchronization

- Adding/removing card membership refreshes the popover membership state.
- Book list refreshes after creating, deleting, or adding/removing cards.
- Book detail refreshes after membership changes.
- Deleting a card through existing card delete automatically removes it from all books through foreign-key cascade.
- Deleting a book does not change week cards or all-history cards.

## Error Handling

- `401`: existing `authFetch` behavior returns to login.
- `404`: missing or unowned book/card.
- `400`: empty book title or invalid input.
- Duplicate add: return success, not an error.

Frontend:

- Show short inline error messages in book create/edit popovers.
- Disable submit while saving.
- Avoid leaving stale checked states after failed add/remove.

## Testing And Verification

Required checks:

- `npm run lint`
- `npm run build`
- Docker production rebuild
- Existing `npm run auth:smoke`
- New smoke coverage for books:
  - create book
  - add one card to two books
  - list books with counts
  - query card membership
  - load book cards with pagination
  - remove card from one book
  - delete book without deleting card
  - confirm user B cannot see or mutate user A's books

Manual browser checks:

- "灵感册" irregular tab appears in authenticated UI.
- Create a book.
- Add one card to multiple books.
- Enter a book and see the card.
- Remove card from book without deleting card.
- Delete book without deleting card.

## Scope For First Implementation

The first implementation includes:

- private books
- many-to-many card membership
- book list
- book detail
- card-to-books popover
- irregular "灵感册" navigation tab
- backend and smoke verification

The first implementation does not include:

- public sharing
- collaborative books
- export
- drag-to-reorder cards inside a book
- custom cover selection
- tags on books
