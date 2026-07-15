# Lightweight Knowledge Vectors Implementation Plan

> **For agentic workers:** Execute inline in this session. Do not delegate. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pgvector-backed semantic candidate recall to manually triggered knowledge AI suggestions without introducing a separate vector service.

**Architecture:** Store versioned knowledge-node embeddings in PostgreSQL, generate only missing/stale vectors through an external OpenAI-compatible embeddings endpoint, and merge semantic candidates with the existing deterministic ranking. Every vector failure falls back to the current behavior.

**Tech Stack:** TypeScript, PostgreSQL 13, pgvector, Express, node:test

---

### Task 1: Schema and runtime configuration

**Files:**
- Create: `database/migrations/004_knowledge_vectors.sql`
- Modify: `src/server/runtimeConfig.ts`
- Modify: `.env.example`
- Test: `tests/knowledge-schema.test.ts`
- Test: `tests/server-runtime-config.test.ts`

- [ ] Add a migration that creates the `vector` extension and tenant-scoped `knowledge_node_embeddings` table without an ANN index.
- [ ] Add explicit feature, endpoint, model, and dimension configuration with validation.
- [ ] Run `npm run test:knowledge` and targeted runtime-config tests.

### Task 2: External Embedding client

**Files:**
- Create: `src/server/knowledge/embeddings.ts`
- Create: `tests/knowledge-embeddings.test.ts`

- [ ] Build bounded embedding text from node title, type, tags, and search text.
- [ ] Implement a timeout-bounded OpenAI-compatible batch client and strict numeric/dimension validation.
- [ ] Test URL normalization, batching response order, malformed responses, and timeouts.

### Task 3: Vector persistence and retrieval

**Files:**
- Modify: `src/server/knowledge/repository.ts`
- Test: `tests/knowledge-repository.test.ts`

- [ ] List active nodes with missing/stale embeddings for one model and dimension.
- [ ] Upsert vectors with content fingerprints and timestamps.
- [ ] Retrieve exact cosine neighbors while excluding inactive, linked, and cross-tenant nodes.
- [ ] Test parameterization and mapping through a queryable test double.

### Task 4: Manual AI candidate integration

**Files:**
- Modify: `src/server/knowledge/service.ts`
- Modify: `src/server/knowledge/router.ts`
- Modify: `server.ts`
- Test: `tests/knowledge-rules.test.ts`
- Test: `tests/knowledge-router.test.ts`

- [ ] Inject one shared embedding provider into knowledge services.
- [ ] On manual AI suggestion only, refresh at most 500 nodes in bounded batches.
- [ ] Merge semantic and deterministic candidates with semantic evidence and stable limits.
- [ ] Catch vector errors and preserve the existing fallback flow.
- [ ] Verify that suggestions still never insert formal links.

### Task 5: Runtime verification

**Files:**
- Modify: `docs/deployment/alibaba-cloud-ecs.md`

- [ ] Run `npm run test:knowledge`, `npm run lint`, and `npm run build`.
- [ ] Install pgvector for PostgreSQL 13 on ECS, apply migration 004, and verify the extension/table.
- [ ] Configure an embedding model, trigger one manual suggestion, and confirm cached vectors are reused.
- [ ] Verify the knowledge service, graph endpoint, and existing PostgreSQL data remain healthy.
