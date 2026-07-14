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

## Knowledge explorer

- `database/migrations/003_knowledge_explorer.sql` adds tenant-safe nested
  folders and many-to-many node memberships, then maps existing inspiration
  books into root folders.
- `src/server/knowledge/folders.ts` owns lazy child-folder reads, cursor-based
  30-item content pages, unfiled queries, depth/cycle validation and membership
  writes. Folder, content, candidate and graph reads stay separate so their
  joins cannot multiply one another.
- The Web knowledge page is a fixed-height three-pane explorer: lazy folder
  tree, typed content list and detail/relations inspector. Image rows use the
  authenticated `thumb-112` WebP variant; larger previews remain on demand.
- The local graph uses a browser-side radial layout and is capped at two hops,
  50 nodes and 100 edges. Candidate edges are hidden by default.
- Knowledge AI relations remain manual: generating suggestions does not write
  links, and the user must confirm a suggestion before persistence.
- `npm run knowledge:benchmark` runs isolated temporary-table plans and rolls
  back. It requires `KNOWLEDGE_BENCHMARK_DATABASE_URL`; optional node,
  membership and link counts default to 100k/1m/1m.
- Rollback is `KNOWLEDGE_BASE_ENABLED=false`; migrations are forward-only and
  preserve folder data.
