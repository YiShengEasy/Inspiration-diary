# Project Structure

The application is a Vite/React web client with an Express/TypeScript server.

- `src/`: web client and shared libraries.
- `src/server/`: authentication, storage, database and upload services.
- `server.ts`: Express composition root and legacy route definitions.
- `database/migrations/`: ordered PostgreSQL migrations.
- `scripts/`: release, migration, smoke and one-shot operations.
- `tests/`: focused server and browser-helper tests.

## Private OSS direct uploads

- `src/server/direct-upload/`: upload policy, session service, OSS gateway,
  business claims and bounded cleanup.
- `npm run uploads:cleanup`: runs one cleanup batch (at most 100 sessions). It is
  intended for an external 15-minute cron/systemd/launchd schedule; the web
  process does not run a timer.
- `npm run uploads:smoke`: performs three real 100 MiB direct-to-OSS uploads and
  deletes only objects below `pending/smoke/`. It refuses to run unless
  `DIRECT_UPLOAD_SMOKE_CONFIRM=UPLOAD_3X100M_AND_DELETE_TEST_OBJECTS` is set.

Run database migrations before enabling `WEB_DIRECT_OSS_UPLOAD_MODE`.
