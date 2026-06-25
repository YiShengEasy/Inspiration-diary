# Native WeChat Mini Program Design

Project: Inspiration-diary
Date: 2026-06-25
Prototype source: `miniprogram/prototype`

## Goal

Build a native WeChat mini program that recreates the current `miniprogram/prototype` experience as closely as possible while reusing the existing Inspiration Diary backend.

The mini program is a new client. It should not replace the current Web app, rewrite the business data model, or expose the Web app's AI provider settings. The Web app keeps its email or phone plus password login flow. The mini program adds WeChat login, then guides users to complete a reusable Web account.

## Selected Approach

Use a native WeChat mini program under `miniprogram/app`.

Keep `miniprogram/prototype` as the visual and interaction reference. Do not ship the React/Vite prototype as the production mini program.

This approach was selected over:

- Directly calling existing Web APIs without an adapter, because the current Web APIs are cookie-session oriented.
- Taro, uni-app, or another cross-platform wrapper, because the target is a native WeChat mini program with close visual fidelity.

## Architecture

### Mini Program

Create a native mini program with:

- `app.json` for global configuration and the three bottom tabs.
- `pages/diary` for the weekly inspiration diary.
- `pages/toolbox` for the public image toolbox.
- `pages/me` for account status, registration guidance, profile state, and settings entries.
- `pages/editor` for shared image-tool editing.
- `pages/day-detail` for a day's card list.
- `pages/card-detail` for image and Markdown detail views.
- `pages/search` for archive search.
- `pages/books` for inspiration books.
- `pages/register-complete` for completing a Web-compatible account after WeChat login.
- Shared components for banners, tool cards, tab sections, bottom sheets, card stacks, day cards, editable tags, and empty states.
- Shared API modules for auth, cards, books, uploads, notes, and user/profile data.

### Backend

Keep the existing Express backend as the business source of truth.

Add a mini-program auth layer and token/session support so protected business routes can authenticate either:

- Web users through the existing `inspiration_session` cookie.
- Mini-program users through a mini-program token, such as `Authorization: Bearer <mini_token>` or `X-Mini-Session`.

Existing card, book, image, Markdown, and photo proxy routes should be reused wherever possible.

Update the auth data model without replacing the existing Web flow:

- Keep existing email/password users valid.
- Add phone-based account support for mini-program-created users.
- Add WeChat identity fields or a related identity table for mini-program login.
- Allow Web login to accept a single identifier field that can be either email or phone.

## Page Scope

The first version should recreate the current prototype structure in native mini-program form.

### Toolbox Tab

This is the default entry for guests.

Recreate:

- Top Inspiration Diary promotion banner.
- Three featured tool cards.
- Category tabs.
- Tool grid.
- Recommended cards.

Local tools available in the first version:

- Image crop.
- Pixel style conversion.
- Filter styles.
- Watermark.

Color extraction and AI-style entries may appear as experimental or coming-soon entries unless their real behavior is implemented.

### Inspiration Diary Tab

Registered users see the weekly diary.

Recreate:

- Week switcher.
- Search entry.
- Weekly summary card.
- Inspiration books entry.
- Day groups and stacked day covers.
- Upload action for image, camera, toolbox result, and Markdown or text note.

Guests or WeChat-only unregistered users should see a preview and registration guidance, not an empty blocked page.

### Me Tab

Recreate:

- Avatar and nickname area.
- Stats for inspiration count, this week's records, and tool usage.
- Account status banner.
- Drafts and local cache entries.
- Inspiration diary, tool works, and favorites sections.
- Privacy, about/version, and logout entries.

This tab is responsible for detecting `wechat_logged_in_unregistered` and guiding users to complete account registration.

### Prototype Modal Mapping

Convert prototype modal-style UI to mini-program pages or components:

- `ToolEditor` becomes `pages/editor`.
- `DayListModal` becomes `pages/day-detail`.
- `DetailModal` becomes `pages/card-detail`.
- `SearchPanel` becomes `pages/search`.
- `CollectionsModal` becomes `pages/books`.
- `CollectSheet`, `SaveSheet`, `UploadChoiceSheet`, and `WeekPickerSheet` remain bottom-sheet components.
- `WeeklySummaryModal` remains a component for the first version.

## Account Model

The mini program has three account states:

- `guest`: no WeChat login.
- `wechat_logged_in_unregistered`: WeChat identity exists, but no Web-compatible account is complete.
- `registered`: the user has a phone or email plus password account that can also log in on Web.

### Login And Registration Flow

1. A user triggers login from Me or from an action that needs persistence.
2. The mini program calls `wx.login`.
3. The backend exchanges the code for WeChat identity and returns mini-program auth state.
4. If the backend finds an existing registered account, the mini program enters `registered`.
5. If the WeChat identity is new or incomplete, the mini program enters `wechat_logged_in_unregistered`.
6. Me shows a strong registration prompt.
7. The user is asked to authorize their WeChat-bound phone number.
8. If the phone number is available, it is used as the default account identifier and the user sets a password.
9. If the user refuses phone authorization or no phone is available, the user must enter an email or phone number and set a password.
10. Registration completion unlocks personal diary data, sync, books, save-to-diary, search, edit, and delete actions.
11. Web login uses the same phone or email plus password account.

### Access Rules

- Local toolbox editing is allowed for guests.
- Saving processed images to the local album is allowed for guests.
- Saving to Inspiration Diary requires `registered`.
- Reading diary data, searching, editing tags, deleting cards, creating books, and collecting cards require `registered`.
- WeChat-only unregistered users may keep local drafts, but cannot sync personal diary data.

## Existing APIs To Reuse

Reuse these existing endpoints after adding mini-program token auth support:

- `POST /api/analyze-image`
- `POST /api/store-image`
- `POST /api/summarize-md`
- `GET /api/db/cards`
- `POST /api/db/cards`
- `DELETE /api/db/cards/:id`
- `PUT /api/db/cards/:id/terms`
- `PUT /api/db/cards/:id/insight-note`
- `GET /api/photos/:photoUid/:variant`
- `GET /api/photos/hash/:photoHash/:variant`
- `GET /api/db/books`
- `POST /api/db/books`
- `PUT /api/db/books/:bookId`
- `PUT /api/db/books/:bookId/cover`
- `DELETE /api/db/books/:bookId`
- `GET /api/db/books/:bookId/cards`
- `POST /api/db/books/:bookId/cards`
- `DELETE /api/db/books/:bookId/cards/:cardId`
- `GET /api/db/cards/:cardId/books`
- `GET /api/db/notes/:weekId`
- `POST /api/db/notes`

Keep `GET /api/db/settings` and `POST /api/db/settings` for Web. Do not expose AI provider configuration in the mini program first version.

## New APIs Required

### `POST /api/auth/wechat-login`

Mini program sends the `wx.login` code. The backend exchanges it for WeChat identity and returns:

- Mini-program token or session id.
- User summary.
- Account state: `wechat_logged_in_unregistered` or `registered`.
- Missing registration fields.

### `POST /api/auth/wechat-phone`

Mini program sends the WeChat phone authorization result. The backend resolves and stores the phone number for the pending WeChat identity.

### `POST /api/auth/complete-registration`

Completes account registration with:

- Phone or email.
- Password.
- Pending WeChat identity.

Phone is preferred. If WeChat phone authorization is rejected, email or manually entered phone is required.

This endpoint must create or attach a Web-compatible user account. If phone is used, the user can later log in on Web with phone plus password. If email is used, the user can log in on Web with email plus password.

### `GET /api/auth/account-status`

Returns the current mini-program account state and missing requirements for Me and guarded actions.

### `POST /api/auth/miniprogram-logout`

Invalidates or clears the mini-program session.

### `GET /api/miniprogram/me`

Aggregates Me page data:

- Nickname and avatar.
- Account state.
- Inspiration count.
- This week's record count.
- Tool usage count.
- Sync and storage status.

This avoids forcing the mini program to compose the Me page from many separate requests.

### `POST /api/miniprogram/tool-usage`

Records real tool usage counts. This can be delayed only if the first version hides or localizes the tool usage statistic.

### Draft APIs

Only needed if drafts must sync across devices:

- `GET /api/miniprogram/drafts`
- `POST /api/miniprogram/drafts`
- `DELETE /api/miniprogram/drafts/:id`

If first-version drafts are local only, these APIs are not required.

## Existing Auth API Changes

Update the current Web auth behavior without breaking existing users:

- `POST /api/auth/register` may continue to support email registration.
- `POST /api/auth/login` should accept `identifier` plus `password`, where `identifier` can be an email or phone number.
- Existing clients that still send `email` should continue to work during the transition.
- Auth responses should continue returning the existing user shape, with optional phone/profile fields added only where needed.
- The `users` table or a related profile table needs a unique phone field for mini-program-created accounts.

## Upload Protocol

Use `multipart/form-data` for Web and mini-program image uploads.

### Backend

Update `POST /api/store-image` to accept:

- `multipart/form-data` field `image`.
- Optional `source=web|miniprogram|toolbox`.
- Existing JSON body `{ imageBase64 }` as temporary backward compatibility.

Update `POST /api/analyze-image` to accept:

- `multipart/form-data` field `image`.
- Existing JSON body `{ imageBase64, mimeType }` as temporary backward compatibility.

Add a shared server-side parser that normalizes supported upload formats into:

- `buffer`
- `mimeType`
- `filename`

PhotoPrism storage and AI analysis should use this normalized structure.

### Web

Change Web uploads to use `FormData`:

- Original image upload sends the original `File` to `/api/store-image`.
- Analysis sends a compressed `Blob` generated from the current canvas compression path to `/api/analyze-image`.

### Mini Program

Use `wx.uploadFile`:

- Original image to `/api/store-image`.
- Compressed temporary image to `/api/analyze-image`.

## Core Data Flows

### Startup

1. Mini program reads local token.
2. It calls `GET /api/auth/account-status`.
3. Guests default to Toolbox.
4. Registered users default to Inspiration Diary.
5. WeChat-only unregistered users see Me registration guidance when they enter personal features.

### Save Image To Diary

1. Check account state. It must be `registered`.
2. Upload original image to `/api/store-image` with multipart.
3. Create a card through `POST /api/db/cards` with fallback tags so the save feels immediate.
4. Upload compressed image to `/api/analyze-image`.
5. Update card tags through `PUT /api/db/cards/:id/terms` when AI returns terms.

### Markdown Or Text Note

1. Send content to `POST /api/summarize-md`.
2. Create a `type=md` card with content, summary, and terms.
3. Render summary and tags in lists, full Markdown in the detail page.

### Books And Collection

Reuse the existing books APIs for:

- Listing books.
- Creating and editing books.
- Updating covers.
- Deleting books.
- Adding cards to books.
- Removing cards from books.
- Showing which books contain a card.

## Error Handling

- WeChat login failure: keep the current page and show retry.
- Unregistered account: route to account completion before personal save or sync actions.
- Phone authorization rejected: require email or manual phone plus password.
- Image upload failure: do not create a card.
- AI analysis failure: keep the saved card with fallback terms.
- PhotoPrism image read failure: show placeholder and retry.
- Token expiry: clear the local token and return to guest or login state.
- Upload size failure: return a clear backend error and ask the user to compress or choose a smaller image.

## Testing And Acceptance

### Backend

- Auth tests cover Web cookie auth and mini-program token auth.
- WeChat login and registration completion are tested with mocked WeChat responses.
- Protected card/book/photo routes reject guests and accept registered mini-program users.
- `/api/store-image` and `/api/analyze-image` accept multipart uploads.
- Existing JSON/base64 calls still work during the transition.

### Web

- Existing Web login still works.
- Web upload, store, analyze, save card, and display image flows still work after switching to `FormData`.
- Existing provider headers for Gemini, Anthropic, and third-party mode still reach `/api/analyze-image`.

### Mini Program

- The native mini program opens in WeChat Developer Tools without depending on the React/Vite prototype.
- Three tab first screens match the prototype's hierarchy, copy, spacing, and visual intent.
- Guests open Toolbox by default.
- Registered users open Inspiration Diary by default.
- Me detects `wechat_logged_in_unregistered` and guides account completion.
- Phone-number registration and email/manual-phone fallback registration both work.
- A Web user can log in with the phone or email plus password created from mini-program registration.
- Mini program can upload an image, save a card, receive fallback terms immediately, then update AI terms.
- Mini program can save Markdown or text notes and display summary plus tags.
- Books can be created, edited, and used to collect or remove cards.
- Unregistered users cannot read, save, edit, delete, or sync personal diary data.

## Implementation Boundary

This document is the approved product and architecture design. It does not implement the mini program or backend changes.

The next step is to create an implementation plan before editing application code.
