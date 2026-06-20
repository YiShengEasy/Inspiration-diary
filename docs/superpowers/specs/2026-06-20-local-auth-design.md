# Local Auth and User-Isolated Gallery Design

## Goal

Add secure, multi-user authentication to Inspiration Diary while keeping all application data and gallery assets backed by local infrastructure:

- PostgreSQL stores users, sessions, cards, notes, settings, and card ownership.
- PhotoPrism remains the local image library.
- The browser never receives PhotoPrism administrator credentials or reusable PhotoPrism preview/download tokens.
- Existing visual style, login-page animation, AI analysis flow, PhotoPrism upload flow, and database-backed card/note logic remain intact.

## Non-Goals

- Do not add a cloud identity provider.
- Do not add Redis in the first implementation.
- Do not change AI provider configuration behavior except requiring login before use.
- Do not redesign the UI beyond restoring real login/register behavior inside the current migrated style.
- Do not split the Express server into multiple services.

## Recommended Architecture

Use a local PostgreSQL-backed account system with server-side sessions.

The browser authenticates by receiving an `HttpOnly` session cookie from the Express server. Frontend JavaScript does not store or read access tokens. Every protected API request is authenticated by the server middleware reading the cookie, loading the session, and attaching the current user to the request.

The first implementation uses PostgreSQL for sessions. The code should still isolate session operations behind a small session-store interface so Redis can replace PostgreSQL later without changing route handlers or business logic.

## Database Schema

### `users`

Stores local user accounts.

- `id UUID PRIMARY KEY`
- `email TEXT NOT NULL UNIQUE`
- `password_hash TEXT NOT NULL`
- `display_name TEXT`
- `role TEXT NOT NULL DEFAULT 'user'`
- `created_at BIGINT NOT NULL`
- `updated_at BIGINT NOT NULL`

Passwords are hashed with Argon2id. If Argon2 is not practical in the current Node build, bcrypt may be used as the fallback. Plaintext passwords must never be stored or logged.

### `sessions`

Stores server-side login sessions.

- `id TEXT PRIMARY KEY`
- `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `created_at BIGINT NOT NULL`
- `expires_at BIGINT NOT NULL`
- `last_seen_at BIGINT NOT NULL`
- `user_agent TEXT`

Indexes:

- `idx_sessions_user_id` on `sessions(user_id)`
- `idx_sessions_expires_at` on `sessions(expires_at)`

Session duration defaults to 7 days and should be configurable with an environment variable.

### Existing Business Tables

Add ownership columns:

- `cards.user_id UUID REFERENCES users(id) ON DELETE CASCADE`
- `notes.user_id UUID REFERENCES users(id) ON DELETE CASCADE`
- `settings.user_id UUID REFERENCES users(id) ON DELETE CASCADE`

Indexes:

- `idx_cards_user_created_at` on `cards(user_id, created_at DESC)`
- `idx_cards_user_week_created_at` on `cards(user_id, week_id, created_at)`
- `idx_notes_user_week` unique on `notes(user_id, week_id)`
- `idx_settings_user_key` unique on `settings(user_id, key)`

The existing `cards` primary key can stay unchanged. Reads and writes must always filter by authenticated `user_id`.

## Data Migration

When authentication is introduced, existing rows need an owner.

Migration behavior:

1. Ensure a first local administrator user exists.
2. Assign existing `cards`, `notes`, and `settings` rows with missing `user_id` to that first user.
3. After backfill, make `user_id` required for new writes.

The first local user may be created by normal registration if no users exist. Alternatively, an environment-provided bootstrap account can be supported:

- `AUTH_BOOTSTRAP_EMAIL`
- `AUTH_BOOTSTRAP_PASSWORD`

The implementation should avoid printing bootstrap secrets.

## Auth API

Add these routes:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Register

Input:

- `email`
- `password`
- optional `displayName`

Behavior:

- Normalize email to lowercase.
- Validate basic email shape and minimum password length.
- Reject duplicate email with a generic message.
- Hash password.
- Create user.
- Create session.
- Set session cookie.
- Return safe user profile: `id`, `email`, `displayName`, `role`.

Registration should be allowed by default for local development. A future environment flag can disable open registration if needed.

### Login

Input:

- `email`
- `password`

Behavior:

- Normalize email.
- Use a generic failure message for unknown user and wrong password.
- On success, create session, set cookie, and return safe user profile.

### Logout

Behavior:

- Delete the active server-side session if present.
- Clear the session cookie.
- Return success even if no active session exists.

### Me

Behavior:

- If the session is valid, return the safe user profile.
- If missing or expired, return `401`.

## Cookie Policy

Session cookie:

- Name: `inspiration_session`
- `HttpOnly`
- `SameSite=Lax`
- `Path=/`
- `Secure` when `AUTH_COOKIE_SECURE=true` or when deployed behind HTTPS

Do not use localStorage or sessionStorage for auth tokens.

## Protected API Surface

Add `requireAuth` middleware and protect:

- `/api/db/*`
- `/api/store-image`
- `/api/analyze-image`
- `/api/test-model`
- `/api/photos/*`

Unauthenticated requests return `401`.

For resources owned by another user:

- Use `404` for card/photo/note reads to avoid confirming that another user's resource exists.
- Use `403` or `404` for writes; `404` is preferred for consistency.

## Data Access Rules

The server must inject `user_id` from the authenticated session.

The client must not send `userId` for ownership. If the client sends one, the server ignores it.

Rules:

- Weekly notes are read and written by `(user_id, week_id)`.
- Current-week cards are read by `(user_id, week_id)`.
- All-history pagination counts and returns only `cards.user_id = currentUser.id`.
- Card creation writes the current user's id.
- Card deletion requires `id` and current user's id.
- Card term updates require `id` and current user's id.
- Settings are stored by `(user_id, key)`, so each user has independent AI/settings values.

## PhotoPrism Storage and Read Proxy

PhotoPrism remains the local image library. The app server remains the only component that knows PhotoPrism username, password, preview token, and download token.

Upload flow:

1. Authenticated browser posts image data to `/api/store-image`.
2. Express verifies the session.
3. Express uploads to PhotoPrism using server-side credentials.
4. Express returns card image identifiers needed by the app.

Read flow:

1. Browser renders application-owned URLs, not PhotoPrism URLs:
   - `/api/photos/:photoUid/thumb`
   - `/api/photos/:photoUid/full`
2. Express verifies the session.
3. Express checks that the current user owns a card with that `photo_uid`.
4. Express fetches the thumbnail or full image from PhotoPrism.
5. Express streams the image response back to the browser.

This prevents a user from opening another user's images by guessing or copying a PhotoPrism URL. It also avoids exposing PhotoPrism preview/download tokens to frontend JavaScript or HTML.

The implementation may keep legacy `image_url` and `thumbnail_url` columns during migration, but new frontend rendering should prefer app proxy URLs.

## Frontend Flow

The current login screen style and animation stay.

Startup flow:

1. App starts in an auth-checking state.
2. App calls `GET /api/auth/me`.
3. If authenticated, load cards, notes, settings, and UI state.
4. If unauthenticated, show `LoginScreen`.

Login/register flow:

1. User enters email and password in the existing login page.
2. Submit calls `/api/auth/login` or `/api/auth/register`.
3. On success, App stores the returned safe user profile in React state only.
4. Business data loads after auth success.

401 handling:

- If a protected API returns `401`, clear user state and show the login screen.
- Avoid retaining another user's cards or settings in memory after logout/session expiry.

Logout flow:

- Add a logout action in the authenticated app shell or settings.
- Call `/api/auth/logout`.
- Clear local user and business state.
- Return to login screen.

## Session Store Abstraction

Define a small server-side interface:

- `createSession(userId, meta)`
- `getSession(sessionId)`
- `deleteSession(sessionId)`
- `cleanupExpiredSessions()`

First implementation: PostgreSQL.

Future Redis implementation can reuse the same route and middleware code by replacing only the store implementation.

## Rate Limiting

Add lightweight in-memory rate limiting for auth endpoints:

- Register and login are limited by IP and normalized email.
- Return a generic error after too many attempts.

This is sufficient for a local-first app. If the app is exposed beyond localhost or LAN, a stronger persistent limiter can be added later.

## Logging and Secrets

Never log:

- Passwords
- Password hashes
- Session cookie values
- PhotoPrism tokens
- AI provider API keys

Existing model diagnostics should keep showing only safe metadata, such as provider name and whether a key exists, not key content.

## Error Handling

Standard JSON shape:

```json
{ "error": "Human readable message." }
```

Auth failures should be generic:

- Login failure: `邮箱或密码不正确`
- Missing session: `未登录`
- Expired session: `登录已过期`

Backend logs may include server-side error context without secrets.

## Testing and Verification

Required checks:

- Register creates a user, session, and cookie.
- Login creates a new valid session.
- Logout deletes the session and clears the cookie.
- Refreshing the browser keeps the session while it is valid.
- Unauthenticated `/api/db/cards` returns `401`.
- Unauthenticated `/api/store-image` returns `401`.
- Unauthenticated `/api/analyze-image` returns `401`.
- User A cannot list, update, delete, or image-proxy User B's cards.
- All-history pagination counts only the current user's cards.
- Notes are isolated by user and week.
- Settings are isolated by user.
- Photo proxy refuses unowned `photoUid`.
- Docker production mode still runs at `http://localhost:3005`.
- `npm run lint` and `npm run build` pass.

## Implementation Order

1. Add auth dependencies and server-side password/session helpers.
2. Add users and sessions schema initialization.
3. Add `user_id` columns, indexes, and migration backfill.
4. Add auth routes and `requireAuth` middleware.
5. Protect database, AI, upload, and photo routes.
6. Apply user-scoped SQL to notes, cards, settings, and pagination.
7. Add PhotoPrism read proxy.
8. Update frontend auth client and login/register flow.
9. Update image URL generation to use app proxy routes.
10. Add logout and 401 handling.
11. Run lint, build, Docker restart, API checks, and browser checks.

## Open Decisions

The design intentionally fixes these choices:

- First implementation stores sessions in PostgreSQL, not Redis.
- The app uses server-side sessions and `HttpOnly` cookies, not frontend-managed JWTs.
- The image read path goes through the app server proxy.
- Existing historical data is assigned to the first local user during migration.

The product choices needed for the first implementation are settled in this design.
