# Optional Knowledge AI Relations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在知识库核心稳定后，增加默认关闭、仅手动触发、可缓存、可审计、可限额的 AI 深度关联，同时允许指定账号每日不限量。

**Architecture:** 服务端先用确定性规则选出最多 5/10 个候选，只把文字摘要发送给外部兼容模型；模型返回的结构化结果必须通过候选集合、关系类型和置信度校验。结果按内容指纹缓存并始终作为候选，用户接受后才写正式关系。单 Node 实例使用内存信号量限制全局并发，PostgreSQL 负责日配额、缓存与审计。

**Tech Stack:** Express, TypeScript, PostgreSQL, OpenAI-compatible HTTP API, React, node:test, Vitest.

---

### Task 1: Add AI Quota, Cache, and Usage Schema

**Files:**
- Create: `database/migrations/003_knowledge_ai.sql`
- Create: `tests/knowledge-ai-schema.test.ts`

- [ ] **Step 1: Write a failing schema contract test**

Assert that the SQL adds a nullable per-user override, accepts only `-1` or positive values, isolates cache/usage by user, indexes daily usage and preserves cache JSON as `jsonb`.

- [ ] **Step 2: Add the account override**

```sql
ALTER TABLE users
ADD COLUMN knowledge_ai_daily_limit_override integer;

ALTER TABLE users
ADD CONSTRAINT users_knowledge_ai_limit_check
CHECK (knowledge_ai_daily_limit_override IS NULL OR knowledge_ai_daily_limit_override = -1 OR knowledge_ai_daily_limit_override > 0);
```

- [ ] **Step 3: Add deterministic result cache**

```sql
CREATE TABLE knowledge_ai_relation_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_node_id uuid NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  cache_key text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('economy','precise')),
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  source_fingerprint text NOT NULL,
  candidate_fingerprints jsonb NOT NULL,
  result_json jsonb NOT NULL,
  expires_at bigint NOT NULL,
  created_at bigint NOT NULL,
  UNIQUE(user_id, source_node_id, cache_key)
);
CREATE INDEX knowledge_ai_cache_source_idx ON knowledge_ai_relation_cache(user_id, source_node_id, created_at DESC);
```

- [ ] **Step 4: Add auditable usage events**

```sql
CREATE TABLE ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('image_analysis','markdown_summary','knowledge_relation')),
  mode text,
  provider text NOT NULL,
  model text NOT NULL,
  provider_called boolean NOT NULL DEFAULT false,
  cache_hit boolean NOT NULL DEFAULT false,
  prompt_tokens integer,
  completion_tokens integer,
  estimated_tokens integer NOT NULL DEFAULT 0,
  success boolean NOT NULL,
  candidate_count integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  error_code text,
  day_key date NOT NULL,
  created_at bigint NOT NULL
);
CREATE INDEX ai_usage_user_day_idx ON ai_usage_events(user_id, purpose, day_key, provider_called);
```

`day_key` uses `Asia/Shanghai` calendar day. The daily limit counts `provider_called=true` regardless of provider success; cache hits never consume quota.

- [ ] **Step 5: Pass schema tests and commit**

```bash
npx tsx --test tests/knowledge-ai-schema.test.ts
git add database/migrations/003_knowledge_ai.sql tests/knowledge-ai-schema.test.ts
git commit -m "feat: add knowledge AI quota and cache schema"
```

### Task 2: Add Strict Runtime Configuration and Admin Policy

**Files:**
- Modify: `src/server/runtimeConfig.ts`
- Modify: `scripts/validate-runtime-config.ts`
- Modify: `.env.example`
- Modify: `.env.production.example`
- Create: `src/server/admin/requireAdmin.ts`
- Create: `tests/knowledge-ai-config.test.ts`

- [ ] **Step 1: Write failing configuration tests**

Test the boolean feature flag, default daily limit 20, global concurrency 2, per-user concurrency 1, 45-second timeout, 30-day cache TTL, prompt version, comma-separated UUID parsing and invalid-value rejection.

- [ ] **Step 2: Add exact runtime fields**

```ts
knowledgeAi: {
  enabled: boolean;
  dailyCallLimit: number;
  perUserConcurrency: number;
  globalConcurrency: number;
  timeoutMs: number;
  cacheTtlDays: number;
  promptVersion: string;
  unlimitedUserIds: Set<string>;
};
```

- [ ] **Step 3: Document secure defaults**

```dotenv
KNOWLEDGE_AI_RELATIONS_ENABLED=false
KNOWLEDGE_AI_DAILY_CALL_LIMIT=20
KNOWLEDGE_AI_PER_USER_CONCURRENCY=1
KNOWLEDGE_AI_GLOBAL_CONCURRENCY=2
KNOWLEDGE_AI_TIMEOUT_MS=45000
KNOWLEDGE_AI_CACHE_TTL_DAYS=30
KNOWLEDGE_AI_PROMPT_VERSION=knowledge-relations-v1
KNOWLEDGE_AI_UNLIMITED_USER_IDS=
```

- [ ] **Step 4: Add a reusable admin guard**

```ts
export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "admin_required" });
    return;
  }
  next();
}
```

- [ ] **Step 5: Pass tests and commit**

```bash
npx tsx --test tests/knowledge-ai-config.test.ts
npm run config:production
git add src/server/runtimeConfig.ts scripts/validate-runtime-config.ts .env.example .env.production.example src/server/admin/requireAdmin.ts tests/knowledge-ai-config.test.ts
git commit -m "feat: configure optional knowledge AI"
```

### Task 3: Implement Quota Resolution and Concurrency Limits

**Files:**
- Create: `src/server/knowledge-ai/quota.ts`
- Create: `src/server/knowledge-ai/semaphore.ts`
- Create: `src/server/knowledge-ai/usageRepository.ts`
- Create: `tests/knowledge-ai-quota.test.ts`

- [ ] **Step 1: Write failing quota tests**

Cover default 20, positive override, `-1` unlimited, environment-listed unlimited account, midnight in Asia/Shanghai, cache hits not charged, failures charged after provider start, one active request per user and two active requests globally.

- [ ] **Step 2: Resolve limits in one place**

```ts
export function resolveDailyLimit(input: {
  userId: string;
  databaseOverride: number | null;
  environmentUnlimited: ReadonlySet<string>;
  defaultLimit: number;
}): number | "unlimited" {
  if (input.environmentUnlimited.has(input.userId) || input.databaseOverride === -1) return "unlimited";
  return input.databaseOverride ?? input.defaultLimit;
}
```

- [ ] **Step 3: Reserve a request without race conditions**

Inside a database transaction, acquire `pg_advisory_xact_lock(hashtext('knowledge-ai:' || user_id))`, count today's `provider_called=true` relation events, reject at the limit, then create the event only immediately before the provider call. A request rejected before provider invocation records `provider_called=false` and does not consume quota.

- [ ] **Step 4: Add fail-fast semaphores**

Return 429 with `ai_user_busy` when the same user already has a request and 503 with `ai_capacity_busy` when two provider calls are active globally. Do not queue in process and do not retry automatically.

- [ ] **Step 5: Pass tests and commit**

```bash
npx tsx --test tests/knowledge-ai-quota.test.ts
git add src/server/knowledge-ai tests/knowledge-ai-quota.test.ts
git commit -m "feat: enforce knowledge AI usage limits"
```

### Task 4: Build the Prompt, Cache Key, and Result Validator

**Files:**
- Create: `src/server/knowledge-ai/types.ts`
- Create: `src/server/knowledge-ai/prompt.ts`
- Create: `src/server/knowledge-ai/cache.ts`
- Create: `src/server/knowledge-ai/validateResult.ts`
- Create: `tests/knowledge-ai-prompt.test.ts`

- [ ] **Step 1: Write failing prompt and validation tests**

Test economy 5/1000 limits, precise 10/3000 limits, no media URL/binary, deterministic cache keys, shuffled candidate normalization, invalid target/type/confidence rejection and 0.75 display threshold.

- [ ] **Step 2: Define the only accepted model output**

```ts
export interface KnowledgeAiRelationResult {
  targetNodeId: string;
  relationType: KnowledgeRelationType;
  confidence: number;
  reason: string;
}

export interface KnowledgeAiResponse {
  relations: KnowledgeAiRelationResult[];
}
```

Reason is plain text, maximum 160 characters. Relations below `0.75` are discarded. Maximum returned relations equals the mode's candidate limit.

- [ ] **Step 3: Build text-only mode payloads**

Economy sends title, tags, summary, properties, insight and at most 1,000 Markdown characters for the source plus at most 5 candidates. Precise sends the same fields, at most 3,000 Markdown characters, at most 10 candidates, existing relation labels and book context. Strip media URLs, base64, HTML and control characters.

- [ ] **Step 4: Generate a stable cache key**

```ts
sha256(JSON.stringify({
  sourceFingerprint,
  candidateFingerprints: [...candidateFingerprints].sort(),
  mode,
  model,
  promptVersion,
}))
```

- [ ] **Step 5: Pass tests and commit**

```bash
npx tsx --test tests/knowledge-ai-prompt.test.ts
git add src/server/knowledge-ai tests/knowledge-ai-prompt.test.ts
git commit -m "feat: validate knowledge AI relation results"
```

### Task 5: Add the Provider Adapter and Relation Service

**Files:**
- Create: `src/server/knowledge-ai/provider.ts`
- Create: `src/server/knowledge-ai/service.ts`
- Create: `tests/knowledge-ai-service.test.ts`

- [ ] **Step 1: Write failing service tests with a fake provider**

Cover feature off, user mode off, cached response, quota rejection, timeout abort, malformed JSON, low confidence, target outside candidates, no retry, usage success/failure, content change invalidating the cache key and a mid-request fingerprint change producing an expired result.

- [ ] **Step 2: Implement one OpenAI-compatible server-side call**

Use `runtimeConfig.thirdPartyAi` only. Send one request containing all bounded candidates, require a JSON response, pass an `AbortSignal.timeout(45000)`, and never send browser-supplied long-term credentials. Do not retry.

- [ ] **Step 3: Implement the service order exactly**

```text
authorize feature audience
→ load user setting (off/economy/precise; missing means off)
→ load source and deterministic candidates
→ build cache key
→ return valid cache hit and log it
→ acquire user/global capacity
→ reserve daily usage
→ call provider once
→ validate and cache result
→ finish usage event
→ release capacity in finally
```

- [ ] **Step 4: Keep results as candidates**

The service must not insert into `knowledge_links`. After the provider returns, reload source/candidate fingerprints; when any changed, store the result with `expires_at=now`, return `stale_result`, and do not display it. Valid caches expire after 30 days. Acceptance is a separate authenticated operation that rechecks source/target ownership, current fingerprints and a matching unexpired cached relation before inserting `origin='ai'`.

- [ ] **Step 5: Pass tests and commit**

```bash
npx tsx --test tests/knowledge-ai-service.test.ts
git add src/server/knowledge-ai tests/knowledge-ai-service.test.ts
git commit -m "feat: generate cached AI relation candidates"
```

### Task 6: Add User and Admin APIs

**Files:**
- Create: `src/server/knowledge-ai/router.ts`
- Create: `src/server/admin/knowledgeAiRouter.ts`
- Create: `tests/knowledge-ai-router.test.ts`
- Modify: `server.ts`

- [ ] **Step 1: Write failing API authorization tests**

Test manual POST only, off mode, tenant isolation, candidate acceptance, daily usage response, non-admin denial, `null|positive|-1` admin limits and environment-unlimited precedence.

- [ ] **Step 2: Add user endpoints**

```text
POST /api/knowledge/nodes/:id/ai-relations
POST /api/knowledge/nodes/:id/ai-relations/:targetId/accept
GET  /api/knowledge/ai-usage
```

The generation endpoint accepts `{ "mode": "economy" | "precise" }`; it never runs from GET, page load, upload, edit, search or graph requests. Usage returns `{ todayCalls, knowledgeCalls, promptTokens, completionTokens, estimatedTokens, tokenCountEstimated, limit, unlimited, cacheHits, failures, recentFailure, dayKey }`.

- [ ] **Step 3: Add an admin-only quota endpoint**

```text
PUT /api/admin/users/:id/knowledge-ai-limit
body: { "limit": null | -1 | positive-integer }
```

`null` restores default, `-1` means daily unlimited. Always record an audit log with admin user ID, target user ID, old value and new value; never expose API keys.

- [ ] **Step 4: Mount both routers behind authentication**

The AI router additionally enforces boolean `KNOWLEDGE_AI_RELATIONS_ENABLED=false|true`. The admin quota router remains available to admins while AI is off so limits can be prepared before rollout.

- [ ] **Step 5: Pass tests and commit**

```bash
npx tsx --test tests/knowledge-ai-router.test.ts
npm run lint
git add src/server/knowledge-ai/router.ts src/server/admin/knowledgeAiRouter.ts tests/knowledge-ai-router.test.ts server.ts
git commit -m "feat: expose manual knowledge AI controls"
```

### Task 7: Instrument Existing AI Purposes

**Files:**
- Create: `src/server/aiUsage.ts`
- Create: `tests/ai-usage.test.ts`
- Modify: `server.ts`

- [ ] **Step 1: Write failing usage-record tests**

Cover existing `/api/analyze-image` as `image_analysis`, `/api/summarize-md` as `markdown_summary`, success/failure latency, no secret payload storage and no application failure when audit insertion itself fails.

- [ ] **Step 2: Wrap existing AI calls without changing their quota**

```ts
await recordAiUsage({
  userId,
  purpose: "image_analysis" | "markdown_summary",
  provider,
  model,
  providerCalled: true,
  success,
  estimatedTokens,
  durationMs,
  errorCode,
});
```

Store provider-returned prompt/completion tokens when available; otherwise store `estimated_tokens=ceil(inputCharacters/2)` for Chinese-heavy text and mark the UI value as estimated. The new knowledge daily limit applies only to `purpose='knowledge_relation'`; existing image/Markdown behavior stays unchanged.

- [ ] **Step 3: Pass tests and commit**

```bash
npx tsx --test tests/ai-usage.test.ts
git add src/server/aiUsage.ts tests/ai-usage.test.ts server.ts
git commit -m "feat: audit AI usage by purpose"
```

### Task 8: Add Manual AI Controls to the Knowledge UI

**Files:**
- Create: `src/features/knowledge-base/KnowledgeAiControls.tsx`
- Create: `src/features/knowledge-base/KnowledgeAiControls.test.tsx`
- Create: `src/features/knowledge-base/KnowledgeAiAdminPanel.tsx`
- Create: `src/features/knowledge-base/KnowledgeAiAdminPanel.test.tsx`
- Modify: `src/features/knowledge-base/KnowledgeBaseView.tsx`
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/features/knowledge-base/api.ts`

- [ ] **Step 1: Write failing manual-trigger tests**

Assert that opening/searching/editing a node does not call the AI endpoint, mode defaults off, only a click starts generation, busy/quota/timeout states are readable, cache hits are labeled, and accepting one result creates a formal relation.

- [ ] **Step 2: Add three user modes**

Persist `knowledge_ai_mode=off|economy|precise` in existing settings. Missing/invalid means `off`. Explain exact limits beside modes: economy 5 candidates/1,000 Markdown chars; precise 10/3,000.

- [ ] **Step 3: Add a single explicit action**

Button label: “AI 深度关联”. Disable it while one request is active. Show remaining daily count or “每日不限量”, today's total/knowledge calls, input/output or estimated token totals, cache hits and the most recent failure; display validated candidates with confidence, reason and a separate “接受关系” button. On AI failure, keep deterministic tag candidates visible and editable.

- [ ] **Step 4: Add an admin-only quota editor**

Load only when `currentUser.role === 'admin'`. Accept default, positive integer or unlimited; require confirmation before saving unlimited; show that concurrency/timeout/audit still apply.

- [ ] **Step 5: Pass UI tests and commit**

```bash
npm run test:ui -- KnowledgeAi
npm run lint
git add src/features/knowledge-base src/components/SettingsModal.tsx
git commit -m "feat: add opt-in knowledge AI interface"
```

### Task 9: Verify Cost, Safety, and Rollback

**Files:**
- Create: `scripts/knowledge-ai-smoke.ts`
- Modify: `package.json`
- Modify: `docs/PROJECT_STRUCTURE.md`

- [ ] **Step 1: Add a fake-provider smoke mode**

The script creates a source plus 10 candidates, proves off mode performs zero provider calls, economy truncates to 5/1,000, precise truncates to 10/3,000, a repeated request is a cache hit and 21st default-user call is rejected while an unlimited account remains allowed.

- [ ] **Step 2: Add the command**

```json
{
  "knowledge:ai:smoke": "tsx scripts/knowledge-ai-smoke.ts"
}
```

- [ ] **Step 3: Run the complete gate**

```bash
npm run test:knowledge
npm run test:ui
npm run knowledge:ai:smoke
npm run lint
npm run build
```

Expected: all pass; no binary media appears in captured prompts; off mode generates no new knowledge AI usage; cache hits do not consume quota.

- [ ] **Step 4: Roll out in three explicit stages**

```dotenv
KNOWLEDGE_AI_RELATIONS_ENABLED=false
KNOWLEDGE_AI_RELATIONS_ENABLED=true
```

First validate with the flag `false` and fake-provider smoke tests. Then set it to `true` while only designated administrator accounts switch their user mode away from `off`; keep that canary for one full usage day before announcing the control to all users. Review provider calls, cache hit rate, failure rate and average candidates. Rollback changes the flag to `false`; cached results, accepted links and usage logs remain intact.

- [ ] **Step 5: Commit**

```bash
git add scripts/knowledge-ai-smoke.ts package.json docs/PROJECT_STRUCTURE.md
git commit -m "ops: verify optional knowledge AI rollout"
```
