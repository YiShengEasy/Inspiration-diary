# ai-design-termboard Style Migration Design

Date: 2026-06-20
Project: Inspiration-diary
Reference project: /Users/yisheng/Documents/SLUAN/ai-design-termboard

## Goal

Migrate the visual style, login page, and frontend interactions from `ai-design-termboard` into `Inspiration-diary` while preserving the current backend and data handling behavior in `Inspiration-diary`.

This includes all confirmed reference interactions:

- Firebase login/register screen with ink reveal animation.
- Auth-gated app shell and logout button.
- Weather particle background inside day slots.
- Weekly preview modal with masonry layout.
- Card stack drag/swipe animation.
- Zoom modal previous/next navigation and keyboard support.
- Animated delete confirmation modal.
- Header, dark-mode, card, empty-state, modal, and motion styling refinements.

## Non-Goals

- Do not replace the current PhotoPrism upload/storage flow.
- Do not remove or downgrade PostgreSQL/Firebase data mode support.
- Do not remove `refreshCards`, `loadSettings`, `saveSettings`, or third-party model settings.
- Do not change card, note, or settings data shape.
- Do not rewrite server routes or AI request semantics as part of this style migration.

## Current Context

`Inspiration-diary` already has production-oriented behavior that is not fully present in `ai-design-termboard`:

- Image upload stores through `/api/store-image` before saving the card.
- AI term extraction runs asynchronously after the card exists.
- Cards can be refreshed manually through `refreshCards`.
- Settings can load from and save to the database.
- Third-party model/provider settings are supported in addition to Gemini and Anthropic.
- PhotoPrism URLs and thumbnails are part of `ImageCard`.

`ai-design-termboard` is the visual and interaction reference:

- `LoginScreen` provides the auth UI, ink reveal, poem layout, motion timing, and error states.
- `WeatherBackground` provides animated canvas effects for day slots.
- `WeeklyPreviewModal` and `MasonryGrid` provide the weekly overview.
- `DaySlot`, `PolaroidCard`, and `App` include gesture, modal, and animation behavior to port.

## Proposed Approach

Use a targeted visual and interaction migration. Import reference UI components and merge App-level interactions manually, but keep `Inspiration-diary` as the source of truth for business logic.

Files likely to change:

- `src/lib/firebase.ts`: add Firebase Auth export while preserving Firestore export.
- `src/components/LoginScreen.tsx`: add from reference project.
- `src/components/WeatherBackground.tsx`: add from reference project.
- `src/components/WeeklyPreviewModal.tsx`: add from reference project, adjusted only if needed for current card image URLs.
- `src/components/ui/ink-reveal.tsx`: add from reference project.
- `src/components/ui/masonry-grid.tsx`: add from reference project.
- `src/lib/utils.ts`: add only if required by `MasonryGrid`.
- `src/index.css`: add missing dark variant support and reference-compatible base styling.
- `src/components/TimelineHeader.tsx`: add weekly preview control and matching dark styling.
- `src/components/DaySlot.tsx`: add weather background, drag/swipe card stack animation, sparkle empty state, and upload affordance animation.
- `src/components/PolaroidCard.tsx`: align delete button styling and dark shadows while keeping thumbnail support for board cards.
- `src/App.tsx`: add auth gate, logout, weekly preview state, zoom carousel navigation, delete confirmation animation, and preserve current upload/settings/refresh logic.

## Architecture

### Auth Shell

`App` will own auth state:

- `authInitialized`
- `isLoggedIn`

On mount, `onAuthStateChanged(auth, ...)` decides whether to show the app or `LoginScreen`. The loading state shows a centered spinner. `LoginScreen` handles email/password login and registration with Firebase Auth, then calls `onLogin`.

This adds UI gating only. It does not change how existing cards, notes, settings, uploads, or server routes work after the user is logged in.

### Visual Components

Imported visual components should remain self-contained:

- `InkReveal` only draws a canvas mask over the login background.
- `WeatherBackground` only draws decorative particles inside day slots.
- `MasonryGrid` only controls visual layout and reveal animation for weekly preview cards.
- `WeeklyPreviewModal` receives cards and close handler; it does not own data loading.

### App Interactions

`App` will add UI-only state:

- `showWeeklyPreview`
- `cardToDelete`
- `deletePhase`
- zoom carousel helpers
- keyboard navigation effect for zoomed card

Deletion changes from immediate confirm to a modal:

1. User clicks delete on a card.
2. `App` stores the target card in `cardToDelete`.
3. User confirms in the modal.
4. The delete animation plays.
5. Existing `deleteCard(card.id, card.weekId)` runs.

The actual deletion API remains unchanged.

### Upload And AI Flow

`handleUploadImage` must keep the current `Inspiration-diary` flow:

1. Validate `weekId`.
2. Build provider headers, including Gemini, Anthropic, and third-party mode.
3. Upload to `/api/store-image`.
4. Save a new card with PhotoPrism `imageUrl`, `thumbnailUrl`, and `photoUid`.
5. Run `/api/analyze-image` asynchronously.
6. Update terms if extraction succeeds.

Reference-project upload behavior must not overwrite this flow.

### Settings

`SettingsModal` usage in `App` must preserve:

- third-party provider props.
- `saveSettings(...)` database persistence.
- localStorage sync.
- existing model self-test behavior.

Only surrounding visual placement or top-bar button styling may change.

## Data Flow

Card data:

`subscribeCards` / `subscribeAllCards` -> `cards` state -> filtered weekly/global views -> `DaySlot`, `PolaroidCard`, `WeeklyPreviewModal`, zoom modal.

Card mutations:

`DaySlot` upload -> current PhotoPrism upload and async AI flow -> `saveCard` -> subscription/cache update.

Term edits:

`PolaroidCard` add/delete -> `handleUpdateCardTerms` / `handleDeleteTerm` -> existing `updateCardTerms`.

Notes:

`loadNote` -> `noteContent` and `noteHeight` -> debounced `saveNote`.

Settings:

`loadSettings` on startup -> React state and localStorage -> `SettingsModal` -> `saveSettings` plus localStorage and React state.

Auth:

Firebase Auth state controls whether `LoginScreen` or the app shell is rendered.

## Error Handling

- Login errors use the reference project's friendly bilingual messages.
- Auth initialization shows a spinner rather than rendering app content prematurely.
- Upload errors remain surfaced inside `DaySlot`.
- PhotoPrism upload errors keep current server response parsing.
- AI term extraction failures stay non-fatal after the card has been saved.
- Delete animation should not hide backend deletion errors; errors remain logged and the modal closes only after the attempted delete path completes.
- Keyboard handlers must be cleaned up on unmount to avoid duplicate listeners.

## Testing And Verification

Run static verification:

- `npm run lint`
- `npm run build`

Run browser verification after starting the dev server:

- Login page renders and animates.
- Login/register form shows validation and password visibility toggle.
- Authenticated app shell renders after login.
- Logout returns to login.
- Day slots show weather animation and preserve upload/paste/drop behavior.
- Card stacks can switch with arrows and drag/swipe.
- Weekly preview opens from the header and lays out cards in masonry columns.
- Zoom modal supports close, previous/next buttons, Escape, ArrowLeft, and ArrowRight.
- Delete modal plays animation and then deletes through existing data path.
- PhotoPrism-uploaded images still render using thumbnail/original URLs.
- AI settings still load, save, and support third-party provider fields.
- Manual refresh button remains available and works.
- Light and dark modes remain readable.

## Scope Boundaries

The migration is allowed to add UI state, auth rendering gates, visual components, motion wrappers, and modal components.

The migration is not allowed to simplify, replace, or remove current production data flows. If a reference-project implementation conflicts with current `Inspiration-diary` logic, keep `Inspiration-diary` logic and adapt only the presentation layer around it.
