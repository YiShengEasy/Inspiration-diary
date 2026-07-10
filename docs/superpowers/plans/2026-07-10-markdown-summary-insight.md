# Markdown Summary Insight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate an independent Markdown insight in the existing single AI request and persist it to the card's “感悟 / 备注” field.

**Architecture:** Extend `/api/summarize-md` so its shared fallback, prompt, normalizer, and Gemini schema return `insightNote` alongside `summary` and `terms`. Extend the existing Web upload handler to initialize a local fallback, accept a valid server insight, and pass it through the existing `ImageCard.insightNote`/`saveCard` persistence path.

**Tech Stack:** TypeScript, Express, React, PostgreSQL card persistence, Google GenAI structured responses, Vite, esbuild

---

## File Structure

- Modify `server.ts`: expand Markdown analysis output and provider-independent fallback normalization.
- Modify `src/App.tsx`: consume `insightNote` and save it on the new Markdown card.
- Verify with existing `npm run lint` and `npm run build`; the repository has no unit-test runner configured, so focused source assertions supplement compilation.

### Task 1: Extend the Markdown analysis response

**Files:**
- Modify: `server.ts:1601-1762`

- [ ] **Step 1: Establish focused pre-change assertions**

Run:

```bash
rg -n 'insightNote|required: \["summary", "terms", "insightNote"\]' server.ts
```

Expected: existing card persistence references may match, but the `/api/summarize-md` block does not yet include `insightNote` in its fallback, normalized response, or Gemini required fields.

- [ ] **Step 2: Add a deterministic local insight fallback**

Immediately after `fallbackSummary`, derive a bounded clean excerpt and add it to `fallback`:

```ts
const fallbackInsightSource = fallbackSummary || markdown
  .replace(/[#>*_`~\-[\]()]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 220);

const fallback = {
  summary: fallbackSummary || "已保存 Markdown 手稿，点击卡片查看完整内容。",
  terms: ["文档手稿", "资料整理"],
  insightNote: fallbackInsightSource
    ? `初步分析：这份文档主要围绕“${fallbackInsightSource}”展开，可结合实际目标进一步提炼重点和行动项。`
    : "初步分析：文档已保存，可结合实际目标进一步提炼重点和行动项。",
};
```

- [ ] **Step 3: Expand the model contract and prompt**

Change the strict JSON instruction and add a separate insight rule:

```ts
"输出必须是严格 JSON：{\"summary\":\"中文摘要，2到3句话\",\"terms\":[\"标签1\",\"标签2\",...],\"insightNote\":\"核心观点、启发和行动建议\"}。",
"summary 要客观概括内容；insightNote 要进一步提炼核心观点、可借鉴启发和可执行建议，不要简单重复摘要，也不要虚构文档没有的信息。",
```

- [ ] **Step 4: Normalize the additional field for every provider**

Extend `normalizeResult` so all Anthropic, compatible third-party, and Gemini branches share the same validation:

```ts
const insightNote = typeof parsed.insightNote === "string" && parsed.insightNote.trim()
  ? parsed.insightNote.trim()
  : fallback.insightNote;

return {
  summary,
  terms: terms.length > 0 ? terms : fallback.terms,
  insightNote,
};
```

- [ ] **Step 5: Extend the Gemini response schema**

Add the property and require it:

```ts
properties: {
  summary: { type: Type.STRING },
  terms: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
  },
  insightNote: { type: Type.STRING },
},
required: ["summary", "terms", "insightNote"],
```

- [ ] **Step 6: Run server type validation**

Run:

```bash
npm run lint
```

Expected: TypeScript exits successfully with no diagnostics.

- [ ] **Step 7: Commit the server contract change**

```bash
git add server.ts
git commit -m "feat: generate insights for markdown uploads"
```

### Task 2: Persist the generated insight from the Web upload flow

**Files:**
- Modify: `src/App.tsx:899-949`

- [ ] **Step 1: Add the Web-compatible local fallback**

Create `mdInsightNote` next to the current local summary and tags so an older server or failed request still produces a note:

```ts
let mdInsightNote = mdSummary
  ? `初步分析：这份文档主要围绕“${mdSummary}”展开，可结合实际目标进一步提炼重点和行动项。`
  : "初步分析：文档已保存，可结合实际目标进一步提炼重点和行动项。";
```

- [ ] **Step 2: Consume a valid server insight**

After reading `data.summary`, accept only a non-empty string:

```ts
if (typeof data.insightNote === "string" && data.insightNote.trim()) {
  mdInsightNote = data.insightNote.trim();
}
```

- [ ] **Step 3: Save the insight on the card**

Add the existing `ImageCard` field to `newCard`:

```ts
mdContent: text,
mdSummary: mdSummary || "点击查看完整手稿。",
mdName: filename,
insightNote: mdInsightNote,
```

The existing `saveCard` implementation writes this value to `cards.insight_note`; no schema or endpoint changes are needed.

- [ ] **Step 4: Run focused source assertions**

Run:

```bash
rg -n 'mdInsightNote|insightNote: mdInsightNote' src/App.tsx
```

Expected: matches show fallback initialization, response parsing, and card assignment.

- [ ] **Step 5: Run full static validation and production build**

Run:

```bash
npm run lint
npm run build
```

Expected: TypeScript produces no diagnostics; Vite and esbuild complete successfully and produce `dist/server.cjs`.

- [ ] **Step 6: Review the scoped diff**

Run:

```bash
git diff --check
git diff -- server.ts src/App.tsx
```

Expected: no whitespace errors; the diff only changes the Markdown analysis response and Web Markdown upload persistence.

- [ ] **Step 7: Commit the Web persistence change**

```bash
git add src/App.tsx
git commit -m "feat: save markdown analysis as insight note"
```

### Task 3: Final regression verification

**Files:**
- Verify: `server.ts`
- Verify: `src/App.tsx`

- [ ] **Step 1: Confirm the API contract is complete**

Run:

```bash
sed -n '1601,1765p' server.ts
```

Expected: fallback, prompt, normalizer, and Gemini schema all include `insightNote`; term normalization still ends with `.slice(0, 5)`.

- [ ] **Step 2: Confirm the UI persistence path remains editable**

Run:

```bash
rg -n 'insightNote: mdInsightNote|updateCardInsightNote|感悟 / 备注' src/App.tsx src/lib/dbClient.ts
```

Expected: the upload path initializes the note, and the existing detail editor still saves changes through `updateCardInsightNote`.

- [ ] **Step 3: Run final verification**

Run:

```bash
npm run lint
npm run build
git status --short
```

Expected: lint and build pass. Git status contains only the user's pre-existing unrelated files, plus no uncommitted changes from this feature.

