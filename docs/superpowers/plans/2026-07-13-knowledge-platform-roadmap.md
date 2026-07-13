# Resource-Constrained Knowledge Platform Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 2核2G ECS 条件下，按“上传稳定性 → 无 AI 知识库 → 可选 AI 关联”的顺序完成改造，并让每一阶段都能独立上线、验收和回滚。

**Architecture:** PostgreSQL 继续作为唯一业务事实源，私有 OSS 保存媒体正文，Express 负责鉴权与元数据，浏览器完成大文件直传和局部图谱布局。三个子项目使用独立迁移、功能开关和发布闸门，不引入常驻队列、搜索集群、向量数据库或本地模型。

**Tech Stack:** React 19, TypeScript, Vite, Express, PostgreSQL, ali-oss, node:test, Vitest, React Testing Library, @xyflow/react.

---

### Task 1: Freeze the Baseline and Migration Contract

**Files:**
- Reference: `docs/superpowers/specs/2026-07-13-resource-constrained-knowledge-platform-design.md`
- Follow: `docs/superpowers/plans/2026-07-13-private-oss-direct-upload.md` Task 1

- [ ] **Step 1: Record the pre-change baseline**

Run:

```bash
git status --short
npm run lint
npm run build
npm run config:production
```

Expected: lint/build/config checks exit 0; record any pre-existing dirty files and never stage them with roadmap work.

- [ ] **Step 2: Reserve ordered SQL migrations**

Use these immutable migration numbers:

```text
001_upload_sessions.sql
002_knowledge_core.sql
003_knowledge_ai.sql
```

The direct-upload plan owns creation of the runner. It must create `schema_migrations(version text primary key, applied_at bigint not null)`, acquire a PostgreSQL advisory lock, apply pending files in lexical order, and record each successful file in the same transaction.

- [ ] **Step 3: Verify the migration commands after direct-upload Task 1**

```json
{
  "db:migrate": "tsx scripts/migrate-database.ts",
  "db:migrate:status": "tsx scripts/migrate-database.ts --status"
}
```

- [ ] **Step 4: Verify the migration foundation commit exists**

```bash
git log -1 --oneline -- database/migrations src/server/database/migrations.ts scripts/migrate-database.ts
```

### Task 2: Execute Infrastructure Hardening

**Files:**
- Follow: `docs/superpowers/plans/2026-07-13-private-oss-direct-upload.md`

- [ ] **Step 1: Implement the direct-upload plan completely**

Do not enable production traffic until its unit, API, build, cleanup and three-concurrent-video checks pass.

- [ ] **Step 2: Release in admin-only mode**

```dotenv
WEB_DIRECT_OSS_UPLOAD_MODE=admin
KNOWLEDGE_BASE_ENABLED=false
KNOWLEDGE_AI_RELATIONS_ENABLED=false
```

- [ ] **Step 3: Hold the canary gate for one day**

Pass conditions:

```text
upload failure rate < 2%
zero unauthorized object access
zero Node OOM/restart caused by upload
three concurrent 100 MiB uploads keep Node RSS delta < 100 MiB
cleanup leaves no expired pending object older than 24 hours
```

- [ ] **Step 4: Expand direct upload**

Set `WEB_DIRECT_OSS_UPLOAD_MODE=all`. Keep legacy upload endpoints available for the small program and as Web rollback until the knowledge-core canary is complete.

### Task 3: Execute the No-AI Knowledge Core

**Files:**
- Follow: `docs/superpowers/plans/2026-07-13-knowledge-base-core.md`

- [ ] **Step 1: Implement migration, service, API and UI behind the flag**

```dotenv
KNOWLEDGE_BASE_ENABLED=false
```

- [ ] **Step 2: Backfill one account in bounded batches**

```bash
npm run knowledge:backfill -- --audience=admin --batch-size=100
```

Expected: each batch commits in under 2 seconds, can resume by cursor, and creates no duplicate `(user_id, entity_type, entity_id)` nodes.

- [ ] **Step 3: Enable the knowledge canary**

Enable the feature first in the local/staging environment. In production set `KNOWLEDGE_BASE_ENABLED=true`, use only the administrator account for the first validation session, and keep `KNOWLEDGE_AI_RELATIONS_ENABLED=false`.

Pass conditions:

```text
10k-node search p95 < 500 ms
local graph API p95 < 300 ms
tag candidate API p95 < 300 ms
AI usage does not increase when knowledge core is used
existing card/book/weekly-note flows remain valid
```

- [ ] **Step 4: Complete the knowledge rollout**

Keep `KNOWLEDGE_BASE_ENABLED=true` only after the database backup, backfill report, UI accessibility checks and rollback drill pass; otherwise immediately restore `false`.

### Task 4: Execute Optional AI Relations

**Files:**
- Follow: `docs/superpowers/plans/2026-07-13-knowledge-ai-relations.md`

- [ ] **Step 1: Keep the AI feature disabled after deployment**

```dotenv
KNOWLEDGE_AI_RELATIONS_ENABLED=false
KNOWLEDGE_AI_DAILY_CALL_LIMIT=20
KNOWLEDGE_AI_UNLIMITED_USER_IDS=
```

- [ ] **Step 2: Enable designated accounts only**

Use the admin endpoint to set `knowledge_ai_daily_limit_override=-1` for approved accounts. Unlimited daily allowance must still obey one concurrent request per user, two concurrent globally, 45-second timeout, cache, audit and failure logging.

- [ ] **Step 3: Verify manual-only behavior**

Open knowledge nodes, search and graphs without clicking “AI 深度关联”. Expected: `ai_usage_events` receives zero knowledge-relation calls.

- [ ] **Step 4: Expand only after cost review**

Review seven days of request count, cache hit rate, failures and average candidate count before announcing the AI control to all users. The global flag is boolean; every user's mode remains `off` until they opt in.

### Task 5: Production Completion Gate

**Files:**
- Modify: `docs/PROJECT_STRUCTURE.md`
- Modify: `.env.production.example`
- Modify: `scripts/release-production.sh`

- [ ] **Step 1: Run the complete verification set**

```bash
npm run lint
npm run test:server
npm run test:knowledge
npm run test:ui
npm run build
npm run config:production
npm run db:migrate:status
```

Expected: every command exits 0 and no migration is pending in the target release database.

- [ ] **Step 2: Back up and deploy committed changes only**

```bash
bash scripts/backup-postgres.sh
npm run release:prod
```

- [ ] **Step 3: Verify rollback controls**

Rollback order:

```dotenv
KNOWLEDGE_AI_RELATIONS_ENABLED=false
KNOWLEDGE_BASE_ENABLED=false
WEB_DIRECT_OSS_UPLOAD_MODE=off
```

Database migrations are forward-only; rollback hides new surfaces and restores legacy Web upload routing without dropping data.

- [ ] **Step 4: Commit roadmap documentation updates**

```bash
git add docs/PROJECT_STRUCTURE.md .env.production.example scripts/release-production.sh
git commit -m "docs: document knowledge platform operations"
```
