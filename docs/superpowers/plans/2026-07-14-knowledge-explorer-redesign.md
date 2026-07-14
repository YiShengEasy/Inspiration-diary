# Knowledge Explorer Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat knowledge list with a scalable three-pane folder explorer, recognizable content previews, deduplicated relation suggestions, and a readable radial local graph.

**Architecture:** PostgreSQL stores an adjacency-list folder tree and a many-to-many folder membership table while existing knowledge nodes remain the single content identity. Express exposes bounded folder, cursor-list, preview, and graph APIs; React renders separate tree, list, inspector, and graph components. All large collections are lazy, cursor-paginated, or hard-capped.

**Tech Stack:** TypeScript, React 19, Express 4, PostgreSQL, `@xyflow/react`, Tailwind CSS, Node test runner, Vitest, React Testing Library.

---

## File Map

- `database/migrations/003_knowledge_explorer.sql`: folder schema, tenant-safe constraints, indexes, and inspiration-book backfill.
- `src/server/knowledge/folders.ts`: folder validation, cursor encoding, tree and membership queries.
- `src/server/knowledge/previews.ts`: bounded preview metadata and internal thumbnail URL selection.
- `src/server/knowledge/router.ts`: authenticated folder and cursor-list HTTP routes.
- `src/server/knowledge/service.ts`: candidate deduplication, bounded candidate sourcing, and graph DTO enrichment.
- `src/server/knowledge/serializers.ts`: preview and folder-summary response mapping.
- `src/features/knowledge-base/types.ts`: explorer, cursor, preview, and graph view contracts.
- `src/features/knowledge-base/api.ts`: explorer API client functions.
- `src/features/knowledge-base/KnowledgeBaseView.tsx`: explorer state orchestration only.
- `src/features/knowledge-base/KnowledgeTree.tsx`: lazy hybrid folder tree and smart filters.
- `src/features/knowledge-base/KnowledgeList.tsx`: cursor-paginated typed content rows.
- `src/features/knowledge-base/KnowledgeInspector.tsx`: content preview, relations, candidate confirmation, and AI trigger.
- `src/features/knowledge-base/KnowledgeGraphPanel.tsx`: bounded React Flow radial graph.
- `src/features/knowledge-base/graphLayout.ts`: deterministic distance-aware radial layout.
- `tests/knowledge-schema.test.ts`: migration and index contract.
- `tests/knowledge-folders.test.ts`: folder rules, cursor behavior, and tenant isolation.
- `tests/knowledge-router.test.ts`: explorer API contract.
- `tests/knowledge-rules.test.ts`: candidate and radial-layout rules.
- `src/features/knowledge-base/KnowledgeBaseView.test.tsx`: three-pane behavior and visual type tests.
- `scripts/knowledge-explorer-benchmark.ts`: optional explicit large-data SQL benchmark, never run during normal startup.

### Task 1: Add Tenant-Safe Folder Storage

**Files:**
- Create: `database/migrations/003_knowledge_explorer.sql`
- Modify: `tests/knowledge-schema.test.ts`
- Create: `tests/knowledge-folders.test.ts`

- [ ] **Step 1: Write failing schema assertions**

Assert that migration 003 creates `knowledge_folders` and `knowledge_folder_nodes`, caps source types, uses composite tenant foreign keys, prevents duplicate memberships, and defines both folder-first and node-first indexes.

```ts
assert.match(sql, /CREATE TABLE knowledge_folders/i);
assert.match(sql, /FOREIGN KEY \(user_id, parent_id\)/i);
assert.match(sql, /PRIMARY KEY \(user_id, folder_id, node_id\)/i);
assert.match(sql, /knowledge_folder_nodes_node_idx/i);
```

- [ ] **Step 2: Run the schema test and verify failure**

Run: `npm run test:knowledge -- --test-name-pattern="knowledge explorer migration"`  
Expected: FAIL because migration 003 does not exist.

- [ ] **Step 3: Implement migration 003**

Create composite uniqueness on `(user_id, id)` for folders and nodes, a nullable parent FK, normalized sibling-name uniqueness, membership indexes, and idempotent book-folder/member backfill using `ON CONFLICT DO NOTHING`.

```sql
CREATE TABLE knowledge_folders (...);
CREATE UNIQUE INDEX knowledge_folders_user_id_unique ON knowledge_folders(user_id, id);
CREATE TABLE knowledge_folder_nodes (...);
CREATE INDEX knowledge_folder_nodes_node_idx ON knowledge_folder_nodes(user_id, node_id, folder_id);
```

- [ ] **Step 4: Run schema and migration tests**

Run: `npm run test:knowledge -- --test-name-pattern="migration|folder"`  
Expected: PASS.

- [ ] **Step 5: Commit storage checkpoint**

```bash
git add database/migrations/003_knowledge_explorer.sql tests/knowledge-schema.test.ts tests/knowledge-folders.test.ts
git commit -m "feat: add scalable knowledge folders"
```

### Task 2: Add Folder and Cursor Query Boundaries

**Files:**
- Create: `src/server/knowledge/folders.ts`
- Modify: `src/server/knowledge/router.ts`
- Modify: `tests/knowledge-folders.test.ts`
- Modify: `tests/knowledge-router.test.ts`

- [ ] **Step 1: Write failing unit tests for folder rules**

Cover cursor round trips, invalid cursors, maximum depth 8, cycle rejection, normalized sibling names, multi-folder membership, removing one membership without deleting the node, and unfiled `NOT EXISTS` behavior.

```ts
assert.deepEqual(decodeKnowledgeCursor(encodeKnowledgeCursor({ sortOrder: 12, id })), { sortOrder: 12, id });
await assert.rejects(() => service.moveFolder(userId, parentId, childId), /目录不能移动到自身的子目录/);
```

- [ ] **Step 2: Write failing router tests**

Cover authenticated GET/POST/PATCH/DELETE folder routes, folder node add/remove, folder cursor listing, unfiled listing, bounded page size, 400 validation responses, and tenant filtering.

- [ ] **Step 3: Implement `createKnowledgeFolderService`**

Expose focused methods:

```ts
listChildren(input): Promise<KnowledgeFolderPage>
createFolder(input): Promise<KnowledgeFolder>
updateFolder(input): Promise<KnowledgeFolder | null>
deleteFolder(input): Promise<boolean>
listFolderNodes(input): Promise<KnowledgeExplorerNodePage>
listUnfiledNodes(input): Promise<KnowledgeExplorerNodePage>
addNode(input): Promise<boolean>
removeNode(input): Promise<boolean>
```

Use opaque base64url JSON cursors containing the current sort tuple. Validate UUIDs, page size 1–100, depth, parent ownership, and cycles before writes.

- [ ] **Step 4: Mount bounded routes in the knowledge router**

Use existing `inTransaction` for every mutation. Map known folder errors to 400, duplicate sibling names to 409, and missing resources to 404 without exposing SQL details.

- [ ] **Step 5: Run folder and router tests**

Run: `npm run test:knowledge -- --test-name-pattern="folder|cursor|unfiled"`  
Expected: PASS.

- [ ] **Step 6: Commit API checkpoint**

```bash
git add src/server/knowledge/folders.ts src/server/knowledge/router.ts tests/knowledge-folders.test.ts tests/knowledge-router.test.ts
git commit -m "feat: add knowledge explorer folder APIs"
```

### Task 3: Add Typed Preview Metadata and Bounded Suggestions

**Files:**
- Create: `src/server/knowledge/previews.ts`
- Modify: `src/server/mediaDelivery.ts`
- Modify: `src/server/media/primaryRouter.ts`
- Modify: `src/server/media/assetRouter.ts`
- Modify: `server.ts`
- Modify: `src/server/knowledge/service.ts`
- Modify: `src/server/knowledge/serializers.ts`
- Modify: `src/features/knowledge-base/types.ts`
- Modify: `tests/knowledge-router.test.ts`
- Modify: `tests/knowledge-rules.test.ts`

- [ ] **Step 1: Write failing preview contract tests**

Cover image, Markdown, combo, video, book, weekly note, and concept preview kinds. Ensure image lists contain at most four URLs and never expose storage credentials.

```ts
assert.deepEqual(preview, { kind: "image", thumbnailUrls: ["/api/.../thumb-240"], mediaCount: 1 });
assert.equal(preview.thumbnailUrls.length <= 4, true);
```

- [ ] **Step 2: Write failing suggestion-dedup tests**

Feed duplicate targets from local and AI sources and assert one target row, the strongest score, merged evidence, and a default display limit of three.

- [ ] **Step 3: Implement preview projection**

Read only card metadata required for the current page. Prefer existing `thumbnail_url`, `photo_hash`, primary storage keys, combo image keys, and video poster metadata. Add a `thumb-112` media variant with default OSS process `image/resize,m_fill,w_112,h_112/quality,Q_55/format,webp`, expose authenticated primary/asset routes, and return only internal thumbnail routes.

- [ ] **Step 4: Deduplicate candidates before serialization**

Deduplicate by `targetNodeId`, merge evidence deterministically, sort by score descending then ID, and slice to three for the inspector while keeping the explicit AI request target pool bounded at eight.

- [ ] **Step 5: Run knowledge tests**

Run: `npm run test:knowledge -- --test-name-pattern="preview|candidate|suggestion"`  
Expected: PASS.

- [ ] **Step 6: Commit preview checkpoint**

```bash
git add src/server/knowledge/previews.ts src/server/knowledge/service.ts src/server/knowledge/serializers.ts src/server/mediaDelivery.ts src/server/media/primaryRouter.ts src/server/media/assetRouter.ts server.ts src/features/knowledge-base/types.ts tests/knowledge-router.test.ts tests/knowledge-rules.test.ts
git commit -m "feat: add typed knowledge previews"
```

### Task 4: Build the Three-Pane Knowledge Explorer

**Files:**
- Modify: `src/features/knowledge-base/api.ts`
- Modify: `src/features/knowledge-base/KnowledgeBaseView.tsx`
- Create: `src/features/knowledge-base/KnowledgeTree.tsx`
- Create: `src/features/knowledge-base/KnowledgeList.tsx`
- Create: `src/features/knowledge-base/KnowledgeInspector.tsx`
- Modify: `src/features/knowledge-base/KnowledgeBaseView.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Assert three labelled panes, lazy folder expansion, smart type filters, 30-item cursor loading, independent scroll containers, typed preview rows, selected detail, at most three suggestions, and manual AI trigger behavior.

```tsx
expect(screen.getByRole("tree", { name: "知识目录" })).toBeVisible();
expect(screen.getByRole("list", { name: "当前目录内容" })).toBeVisible();
expect(screen.getByRole("complementary", { name: "知识详情" })).toBeVisible();
```

- [ ] **Step 2: Add explorer API functions and types**

Implement `listKnowledgeFolders`, `createKnowledgeFolder`, `updateKnowledgeFolder`, `deleteKnowledgeFolder`, `listKnowledgeFolderNodes`, `listUnfiledKnowledgeNodes`, `addKnowledgeFolderNode`, and `removeKnowledgeFolderNode` with `AbortSignal` support.

- [ ] **Step 3: Implement focused pane components**

`KnowledgeTree` owns expansion and tree keyboard semantics. `KnowledgeList` renders type-specific rows and lazy thumbnails with `loading="lazy"`, 56×56 display size, and placeholders. `KnowledgeInspector` owns edit, relation, candidate, and AI controls but receives data and callbacks from the parent.

- [ ] **Step 4: Replace flat page orchestration**

Keep `KnowledgeBaseView` responsible for selected folder/filter/node, abortable loads, cursor state, status messages, and responsive pane navigation. Give desktop panes `min-h-0 overflow-auto` inside a viewport-height grid so the document does not grow with results.

- [ ] **Step 5: Run UI tests and typecheck**

Run: `npm run test:ui -- src/features/knowledge-base/KnowledgeBaseView.test.tsx`  
Expected: PASS.  
Run: `npm run lint`  
Expected: PASS.

- [ ] **Step 6: Commit explorer UI checkpoint**

```bash
git add src/features/knowledge-base
git commit -m "feat: build three-pane knowledge explorer"
```

### Task 5: Render the Radial Local Graph

**Files:**
- Modify: `src/features/knowledge-base/graphLayout.ts`
- Create: `src/features/knowledge-base/KnowledgeGraphPanel.tsx`
- Modify: `src/features/knowledge-base/KnowledgeInspector.tsx`
- Modify: `src/features/knowledge-base/KnowledgeBaseView.test.tsx`
- Modify: `tests/knowledge-rules.test.ts`

- [ ] **Step 1: Write failing radial-layout tests**

Assert current node at `(0,0)`, distance-one nodes on the first ring, distance-two nodes on a larger ring, deterministic ordering, 50-node/100-edge caps, and title labels instead of IDs.

- [ ] **Step 2: Implement distance-aware layout**

Group nodes by distance, sort by title then ID, place distance-one nodes on radius 190 and distance-two nodes on radius 330, and return only edges whose endpoints survived the cap.

- [ ] **Step 3: Implement the React Flow panel**

Render custom typed nodes, Chinese relation labels, solid formal edges, dashed candidate edges, depth 1/2 control, candidate toggle defaulting off, fit-view control, truncation notice, and node-click recentering.

- [ ] **Step 4: Run graph and UI tests**

Run: `npm run test:knowledge -- --test-name-pattern="graph|layout"`  
Expected: PASS.  
Run: `npm run test:ui -- src/features/knowledge-base/KnowledgeBaseView.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit graph checkpoint**

```bash
git add src/features/knowledge-base/graphLayout.ts src/features/knowledge-base/KnowledgeGraphPanel.tsx src/features/knowledge-base/KnowledgeInspector.tsx tests/knowledge-rules.test.ts src/features/knowledge-base/KnowledgeBaseView.test.tsx
git commit -m "feat: add readable radial knowledge graph"
```

### Task 6: Verify Scale, Migrations, and Release Readiness

**Files:**
- Create: `scripts/knowledge-explorer-benchmark.ts`
- Modify: `package.json`
- Modify: `docs/PROJECT_STRUCTURE.md`

- [ ] **Step 1: Add an explicit benchmark command**

Add `knowledge:benchmark` that requires `KNOWLEDGE_BENCHMARK_DATABASE_URL`, creates isolated benchmark rows in a transaction, runs `EXPLAIN (ANALYZE, BUFFERS)` for child folders, 30-item folder listing, unfiled listing, and one-hop graph, prints timings, and rolls back.

- [ ] **Step 2: Run the complete verification set**

```bash
npm run lint
npm run test:knowledge
npm run test:ui
npm run build
npm run db:migrate:status
```

Expected: all commands exit 0; migration status reports no pending migration after applying to the local database.

- [ ] **Step 3: Run a local smoke test**

Start with `.env.local`, open the knowledge page, expand an inspiration-book folder, open image/Markdown/combo/video rows, confirm independent scrolling, create and remove a manual folder membership, generate AI suggestions manually, and open the depth-two graph.

- [ ] **Step 4: Update architecture documentation**

Document the folder schema, endpoints, thumbnail behavior, graph limits, manual-AI rule, benchmark command, and rollback flag in `docs/PROJECT_STRUCTURE.md`.

- [ ] **Step 5: Commit completion checkpoint**

```bash
git add scripts/knowledge-explorer-benchmark.ts package.json docs/PROJECT_STRUCTURE.md
git commit -m "docs: complete knowledge explorer operations"
```
