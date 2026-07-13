# No-AI Knowledge Base Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不增加 AI 调用的前提下，把现有图片、视频、Markdown、组合卡片、灵感册和周记组织为可编辑、可搜索、可双向链接、可局部可视化的知识库。

**Architecture:** `knowledge_nodes` 是指向现有业务实体的轻量索引，PostgreSQL 仍保存原始卡片/灵感册/周记；Wikilink、正式关系和反馈单独持久化。服务端完成账号隔离、搜索和候选评分，浏览器完成最多 50 节点的图布局；AI 关闭时整个模块不访问任何模型接口。

**Tech Stack:** Express, TypeScript, PostgreSQL pg_trgm, React 19, react-markdown, @xyflow/react, node:test, Vitest, React Testing Library.

---

### Task 1: Add Knowledge Test and UI Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`

- [ ] **Step 1: Install the graph and browser-test packages**

Run:

```bash
npm install @xyflow/react
npm install --save-dev vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

- [ ] **Step 2: Add exact test commands**

```json
{
  "test:knowledge": "tsx --test tests/knowledge-*.test.ts",
  "test:ui": "vitest run",
  "test": "npm run test:particle && npm run test:server && npm run test:knowledge && npm run test:ui"
}
```

- [ ] **Step 3: Configure jsdom**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", setupFiles: ["./tests/setup.ts"], include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
});
```

- [ ] **Step 4: Verify the empty harness and commit**

```bash
npm run test:ui
git add package.json package-lock.json vitest.config.ts tests/setup.ts
git commit -m "test: add knowledge UI harness"
```

Expected: Vitest exits 0 even before feature tests are added.

### Task 2: Create the Knowledge Core Migration

**Files:**
- Create: `database/migrations/002_knowledge_core.sql`
- Create: `tests/knowledge-schema.test.ts`

- [ ] **Step 1: Write a failing schema contract test**

The test reads the SQL file and asserts tenant keys, partial uniqueness, relation checks, feedback canonical-pair check and trigram index are present.

- [ ] **Step 2: Create nodes and indexes**

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE knowledge_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('card','book','weekly_note','concept')),
  entity_id text,
  slug text NOT NULL,
  title text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  properties jsonb NOT NULL DEFAULT '{}',
  search_text text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  auto_added boolean NOT NULL DEFAULT false,
  content_fingerprint text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  deleted_at bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  CHECK (jsonb_typeof(properties) = 'object')
);
CREATE UNIQUE INDEX knowledge_nodes_entity_unique ON knowledge_nodes(user_id, entity_type, entity_id) WHERE entity_id IS NOT NULL;
CREATE UNIQUE INDEX knowledge_nodes_slug_unique ON knowledge_nodes(user_id, slug);
CREATE INDEX knowledge_nodes_active_updated_idx ON knowledge_nodes(user_id, is_active, updated_at DESC);
CREATE INDEX knowledge_nodes_tags_gin_idx ON knowledge_nodes USING gin(tags);
CREATE INDEX knowledge_nodes_search_trgm_idx ON knowledge_nodes USING gin(search_text gin_trgm_ops);
```

- [ ] **Step 3: Create links and suggestion feedback**

```sql
CREATE TABLE knowledge_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_node_id uuid NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  target_node_id uuid NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  relation_type text NOT NULL CHECK (relation_type IN ('mentions','related','references','derived_from','belongs_to','contrasts','supports')),
  origin text NOT NULL CHECK (origin IN ('manual','wikilink','tag_suggestion','ai')),
  context text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  CHECK (source_node_id <> target_node_id),
  UNIQUE(user_id, source_node_id, target_node_id, relation_type, origin)
);
CREATE INDEX knowledge_links_source_idx ON knowledge_links(user_id, source_node_id);
CREATE INDEX knowledge_links_target_idx ON knowledge_links(user_id, target_node_id);

CREATE TABLE knowledge_suggestion_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lower_node_id uuid NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  higher_node_id uuid NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('dismissed','accepted')),
  lower_fingerprint text NOT NULL,
  higher_fingerprint text NOT NULL,
  created_at bigint NOT NULL,
  CHECK (lower_node_id::text < higher_node_id::text),
  UNIQUE(user_id, lower_node_id, higher_node_id, lower_fingerprint, higher_fingerprint)
);
```

- [ ] **Step 4: Pass schema tests and commit**

```bash
npx tsx --test tests/knowledge-schema.test.ts
git add database/migrations/002_knowledge_core.sql tests/knowledge-schema.test.ts
git commit -m "feat: add knowledge core schema"
```

### Task 3: Implement Pure Knowledge Rules First

**Files:**
- Create: `src/server/knowledge/types.ts`
- Create: `src/server/knowledge/slug.ts`
- Create: `src/server/knowledge/fingerprint.ts`
- Create: `src/server/knowledge/properties.ts`
- Create: `src/server/knowledge/wikilinks.ts`
- Create: `src/server/knowledge/candidates.ts`
- Create: `src/features/knowledge-base/graphLayout.ts`
- Create: `tests/knowledge-rules.test.ts`

- [ ] **Step 1: Write failing rule tests**

Test stable collision-safe slugs, reordered-property fingerprint stability, Wikilinks with alias, unresolved title links, flat-property validation, canonical node pairs, scoring threshold 0.32, maximum 10 candidates and graph caps of 50 nodes/100 edges.

- [ ] **Step 2: Define shared relation and property types**

```ts
export type KnowledgeEntityType = "card" | "book" | "weekly_note" | "concept";
export type KnowledgeRelationType = "mentions" | "related" | "references" | "derived_from" | "belongs_to" | "contrasts" | "supports";
export type KnowledgeLinkOrigin = "manual" | "wikilink" | "tag_suggestion" | "ai";
export type PropertyValue = string | string[] | number | boolean | { nodeId: string };
```

Reject nested objects except the exact `{ nodeId: string }` form; reject Markdown syntax in property values; enforce 50 keys, 80-character key names and 2,000 serialized characters per value.

- [ ] **Step 3: Parse stable Wikilinks**

```ts
parseWikilinks("参见 [[blue-particle-a1b2|蓝色粒子]] 与 [[未来视觉语言]]")
// [{ target: "blue-particle-a1b2", alias: "蓝色粒子" }, { target: "未来视觉语言" }]
```

Deduplicate by target while preserving first context. A slug stays unchanged when the title changes.

- [ ] **Step 4: Implement deterministic tag candidate scoring**

```ts
score = tagJaccard * 0.55
      + (sameBook ? 0.20 : 0)
      + sharedPropertyRatio * 0.15
      + creationProximity * 0.10;
```

Exclude self, inactive nodes, formal links and feedback matching current fingerprints. Require one shared tag, or both same-book and shared-property evidence. Return score ≥ 0.32, descending score then node UUID, maximum 10.

- [ ] **Step 5: Pass tests and commit**

```bash
npx tsx --test tests/knowledge-rules.test.ts
git add src/server/knowledge src/features/knowledge-base/graphLayout.ts tests/knowledge-rules.test.ts
git commit -m "feat: add deterministic knowledge rules"
```

### Task 4: Build the Tenant-Safe Repository and Service

**Files:**
- Create: `src/server/knowledge/repository.ts`
- Create: `src/server/knowledge/nodeProjection.ts`
- Create: `src/server/knowledge/service.ts`
- Create: `tests/knowledge-service.test.ts`

- [ ] **Step 1: Write failing repository/service tests**

Cover cross-user isolation, auto-add default true, opt-out affecting only future cards, manual reactivation, source deletion, optimistic revision conflict, unresolved concept creation/merge and Wikilink-only synchronization.

- [ ] **Step 2: Centralize source projection**

```ts
export interface KnowledgeProjection {
  entityType: KnowledgeEntityType;
  entityId: string;
  title: string;
  tags: string[];
  searchText: string;
  properties: Record<string, PropertyValue>;
  markdown?: string;
}
```

For cards, combine type, `md_name`, `md_content`, `md_summary`, `insight_note`, `terms`, original filenames and combo search text. For books/weekly notes, combine their existing titles, notes and membership metadata. Never copy media bytes.

- [ ] **Step 3: Make card persistence transaction-aware**

Extract existing card upsert/delete logic from `server.ts` into functions accepting `pg.PoolClient`. After a top-level image/video/Markdown/combo card is saved, read `knowledge_auto_add`; missing means true. In the same transaction, upsert/refresh its node when enabled or already present.

- [ ] **Step 4: Implement editable Markdown as an existing card**

Creating a knowledge Markdown note inserts a normal `cards.type='md'` row using the current ISO week and day, then creates a `knowledge_nodes.entity_type='card'` reference. Do not create a second Markdown content table. Soft delete sets both the card's knowledge node `deleted_at` and `is_active=false`; the ordinary card delete flow remains the only permanent source deletion.

- [ ] **Step 5: Synchronize only Wikilink-origin edges**

Within the save transaction: resolve active user-owned slug; otherwise resolve exact normalized title; otherwise create a concept node. Delete stale `origin='wikilink'` edges for the source and upsert current `mentions` edges. Leave manual/tag/AI edges untouched.

- [ ] **Step 6: Enforce optimistic locking**

```sql
UPDATE knowledge_nodes
SET title=$1, properties=$2, revision=revision+1, updated_at=$3
WHERE id=$4 AND user_id=$5 AND revision=$6 AND is_active=true
RETURNING *;
```

Return a typed conflict result when zero rows update but the node exists.

- [ ] **Step 7: Pass tests and commit**

```bash
npx tsx --test tests/knowledge-service.test.ts
git add src/server/knowledge server.ts tests/knowledge-service.test.ts
git commit -m "feat: index diary content as knowledge nodes"
```

### Task 5: Add the Knowledge API and Historical Backfill

**Files:**
- Create: `src/server/knowledge/router.ts`
- Create: `src/server/knowledge/serializers.ts`
- Create: `scripts/backfill-knowledge.ts`
- Create: `tests/knowledge-router.test.ts`
- Create: `tests/knowledge-config.test.ts`
- Modify: `src/server/runtimeConfig.ts`
- Modify: `.env.example`
- Modify: `.env.production.example`
- Modify: `server.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing API tests**

Test auth, tenant isolation, pagination, query bounds, CRUD, 409 conflict payload, join/leave, backlinks, manual links, candidate accept/dismiss, graph caps and resumable backfill.

- [ ] **Step 2: Add bounded endpoints**

```text
GET    /api/knowledge/nodes?q=&type=&page=1&pageSize=20
POST   /api/knowledge/markdown
GET    /api/knowledge/nodes/:id
PUT    /api/knowledge/nodes/:id
GET    /api/knowledge/entities/:entityType/:entityId
POST   /api/knowledge/entities/:entityType/:entityId/join
POST   /api/knowledge/nodes/:id/leave
GET    /api/knowledge/nodes/:id/backlinks
GET    /api/knowledge/nodes/:id/candidates
POST   /api/knowledge/nodes/:id/candidates/:targetId/accept
POST   /api/knowledge/nodes/:id/candidates/:targetId/dismiss
POST   /api/knowledge/links
DELETE /api/knowledge/links/:id
GET    /api/knowledge/nodes/:id/graph?depth=1
POST   /api/knowledge/backfill
```

Clamp `pageSize` to 100, graph depth to 1–2, nodes to 50 and edges to 100. Search exact slug/title first, then trigram, then escaped `ILIKE` for short Chinese terms. Every SQL statement includes `user_id`.

- [ ] **Step 3: Return conflict data without losing local text**

```json
{
  "error": "revision_conflict",
  "serverRevision": 8,
  "serverNode": { "id": "uuid", "title": "服务器标题", "markdown": "服务器正文" }
}
```

- [ ] **Step 4: Implement resumable 100-row backfill**

```json
{
  "cursor": "card-id-or-null",
  "processed": 100,
  "created": 96,
  "updated": 4,
  "nextCursor": "next-card-id-or-null",
  "done": false
}
```

The CLI supports `--audience=admin --batch-size=100`; the API supports one current-user batch per call. Both reuse the service and commit once per batch. Entity membership endpoints allow `card|book|weekly_note`; joining a source that has no node creates it on demand, and leaving only sets `is_active=false`.

- [ ] **Step 5: Mount behind the feature audience**

Parse boolean `KNOWLEDGE_BASE_ENABLED=false|true`, default `false`, in `runtimeConfig`. Expose only `{ knowledgeBase: boolean, knowledgeAiRelations: boolean, directUpload: boolean }` from authenticated `GET /api/runtime-capabilities`; expose no provider, path or credential values. Disabled knowledge routes return 404 and card saves perform no knowledge work.

- [ ] **Step 6: Pass tests and commit**

```bash
npx tsx --test tests/knowledge-router.test.ts tests/knowledge-config.test.ts
npm run lint
git add src/server/knowledge/router.ts src/server/knowledge/serializers.ts scripts/backfill-knowledge.ts tests/knowledge-router.test.ts tests/knowledge-config.test.ts src/server/runtimeConfig.ts .env.example .env.production.example server.ts package.json
git commit -m "feat: expose bounded knowledge APIs"
```

### Task 6: Add Client Types, API, Navigation, and Auto-Add Setting

**Files:**
- Create: `src/features/knowledge-base/types.ts`
- Create: `src/features/knowledge-base/api.ts`
- Create: `src/features/knowledge-base/KnowledgeBaseView.tsx`
- Create: `src/features/knowledge-base/KnowledgeBaseView.test.tsx`
- Create: `src/features/knowledge-base/KnowledgeBackfillPanel.tsx`
- Create: `src/features/knowledge-base/KnowledgeBackfillPanel.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/components/PolaroidCard.tsx`
- Modify: `src/components/ComboCardDetail.tsx`
- Modify: `src/lib/dbClient.ts`

- [ ] **Step 1: Write failing navigation and setting tests**

Test that the knowledge entry is hidden when disabled, opens lazily when enabled, the settings switch defaults on when `knowledge_auto_add` is absent, manual join/leave works, and backfill can pause and resume without losing its cursor.

- [ ] **Step 2: Extend the main view and lazy-load the feature**

```ts
type MainView = "board" | "books" | "tags" | "particles" | "knowledge";
const KnowledgeBaseView = lazy(() => import("./features/knowledge-base/KnowledgeBaseView"));
```

Render it inside `Suspense`; loading/failure must leave board navigation usable.

- [ ] **Step 3: Add the default-on setting**

```ts
const knowledgeAutoAdd = settings.knowledge_auto_add !== "false";
```

Label it “上传后自动加入知识库”. Saving sends only `knowledge_auto_add: "true" | "false"`; turning it off does not deactivate prior nodes.

- [ ] **Step 4: Add API types with no `any`**

Model list/detail/backlinks/candidates/graph/conflict responses separately. The API layer throws a `KnowledgeRevisionConflict` carrying server state on HTTP 409.

- [ ] **Step 5: Add manual membership and resumable history controls**

Card/combo detail menus show “加入知识库” for a missing/inactive node and “移出知识库” for an active node. `KnowledgeBackfillPanel` requests one 100-row batch at a time, displays created/updated totals, stores `nextCursor` in component state, stops before the next request when paused, and resumes from that cursor. Books and weekly notes use the same entity join endpoint when first referenced.

- [ ] **Step 6: Pass UI tests and commit**

```bash
npm run test:ui -- KnowledgeBaseView
npm run lint
git add src/features/knowledge-base src/App.tsx src/components/SettingsModal.tsx src/components/PolaroidCard.tsx src/components/ComboCardDetail.tsx src/lib/dbClient.ts
git commit -m "feat: add knowledge navigation and settings"
```

### Task 7: Build Search, Markdown Editing, Properties, and Links

**Files:**
- Create: `src/features/knowledge-base/KnowledgeList.tsx`
- Create: `src/features/knowledge-base/KnowledgeEditor.tsx`
- Create: `src/features/knowledge-base/WikilinkAutocomplete.tsx`
- Create: `src/features/knowledge-base/PropertiesEditor.tsx`
- Create: `src/features/knowledge-base/RelationsPanel.tsx`
- Create: `src/features/knowledge-base/KnowledgeEditor.test.tsx`
- Modify: `src/components/MarkdownContent.tsx`

- [ ] **Step 1: Write failing interaction tests**

Cover debounced search, create Markdown, 800 ms autosave, Wikilink insertion with stable slug, property validation, backlinks, candidate accept/dismiss and 409 conflict preserving the unsaved local text.

- [ ] **Step 2: Implement list and detail states**

Keep only one 20-row page in memory plus selected detail. Use `AbortController` to cancel stale search requests. Show node kind, title, tags, snippet and active state without fetching media originals.

- [ ] **Step 3: Add Markdown autosave and conflict UI**

Autosave 800 ms after the last edit. On 409, stop autosave and show “复制本地内容” and “重新加载服务器版本”; never replace editor state automatically.

- [ ] **Step 4: Render Wikilinks as knowledge navigation**

Preprocess `[[slug|label]]` into safe internal anchors, then have `MarkdownContent` call a provided `onKnowledgeLink(slug)`. Do not enable raw HTML.

- [ ] **Step 5: Add accessible property and relationship controls**

Use labeled native inputs, keyboard-operable candidate buttons, visible focus states and Chinese labels for the seven fixed relation types. Formal links use a solid indicator; unaccepted tag candidates use a dashed indicator.

- [ ] **Step 6: Pass tests and commit**

```bash
npm run test:ui -- KnowledgeEditor
npm run lint
git add src/features/knowledge-base src/components/MarkdownContent.tsx
git commit -m "feat: edit and link knowledge notes"
```

### Task 8: Add the Bounded Local Graph

**Files:**
- Create: `src/features/knowledge-base/KnowledgeGraph.tsx`
- Create: `src/features/knowledge-base/KnowledgeGraph.test.tsx`
- Modify: `src/features/knowledge-base/KnowledgeBaseView.tsx`

- [ ] **Step 1: Write failing graph and fallback tests**

Test 50-node/100-edge clamping, one/two-hop expansion, solid/dashed edges, node-kind colors, click-to-open and list fallback after graph rendering or API failure.

- [ ] **Step 2: Render deterministic browser-side layout**

Use `@xyflow/react` with the selected node at `(0,0)`, first-hop nodes on radius 240 and second-hop nodes on radius 430. Seed ordering by node UUID so reopening does not jump. Disable node editing; allow pan/zoom and fit view.

- [ ] **Step 3: Preserve a non-graph fallback**

Below the graph, render the same formal/candidate relationships as an accessible list. Catch graph errors locally and keep editor/search/backlinks functional.

- [ ] **Step 4: Lazy-load graph CSS and implementation**

Import graph code only after the knowledge view opens so the existing board's initial bundle is not expanded by the graph package.

- [ ] **Step 5: Pass tests and commit**

```bash
npm run test:ui -- KnowledgeGraph
npm run build
git add src/features/knowledge-base
git commit -m "feat: visualize local knowledge relationships"
```

### Task 9: Verify Performance, Backfill, and Rollback

**Files:**
- Create: `scripts/knowledge-performance-smoke.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `.env.production.example`
- Modify: `docs/PROJECT_STRUCTURE.md`

- [ ] **Step 1: Add a disposable 10k-node performance smoke**

Seed one test user and 10,000 nodes inside a transaction, run 100 search samples, 100 candidate samples and 100 graph samples, report p50/p95, then roll back the transaction.

- [ ] **Step 2: Add exact acceptance commands**

```json
{
  "knowledge:backfill": "tsx scripts/backfill-knowledge.ts",
  "knowledge:perf": "tsx scripts/knowledge-performance-smoke.ts"
}
```

Run:

```bash
npm run test:knowledge
npm run test:ui
npm run knowledge:perf
npm run lint
npm run build
```

Expected: search p95 < 500 ms; candidate and graph p95 < 300 ms; no knowledge action calls an AI endpoint.

- [ ] **Step 3: Document staged rollout**

```dotenv
KNOWLEDGE_BASE_ENABLED=false
KNOWLEDGE_AI_RELATIONS_ENABLED=false
```

Validate locally first, then roll out `false → true`. Rollback sets the flag to `false`; do not drop knowledge tables or delete backfilled nodes.

- [ ] **Step 4: Commit**

```bash
git add scripts/knowledge-performance-smoke.ts package.json .env.example .env.production.example docs/PROJECT_STRUCTURE.md
git commit -m "ops: verify knowledge core rollout"
```
