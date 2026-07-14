# Dual Particle Engines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在同一粒子工作台中保留现有深度 3D 引擎，并新增与独立 Demo 同底层的像素粒子溶解引擎。

**Architecture:** `ParticleStudio` 变为共享图片和引擎选择的外壳；原组件改为 `DepthParticleStudio`。新的 `dissolution` 子目录拥有独立 Renderer、Shader、参数、预设和 UI，两套 WebGL 实例通过 React 卸载完成资源隔离。

**Tech Stack:** React 19, TypeScript, Three.js, GLSL, WebCodecs/MP4 exporter, node:test, Vitest, Vite.

---

### Task 1: Add the dual-engine shell

**Files:**
- Move: `src/features/particle-studio/ParticleStudio.tsx` → `src/features/particle-studio/DepthParticleStudio.tsx`
- Create: `src/features/particle-studio/ParticleStudio.tsx`
- Modify: `src/features/particle-studio/particle-studio.css`
- Test: `src/features/particle-studio/ParticleStudio.test.tsx`

- [ ] Add a shell test that renders the two buttons `深度 3D` and `粒子溶解`, selects a file through one engine, then verifies the same `File` is passed after switching.
- [ ] Change the depth component contract to:

```ts
interface DepthParticleStudioProps {
  file: File | null;
  onFileChange: (file: File) => void;
}
```

- [ ] Implement `ParticleStudio` with `engine: "depth" | "dissolution"`, shared `file`, and a disabled engine switch while either child reports export activity.
- [ ] Run `npm run test:ui -- ParticleStudio.test.tsx`; expect the focused shell test to pass.

### Task 2: Define the independent dissolution contract

**Files:**
- Create: `src/features/particle-studio/dissolution/types.ts`
- Create: `src/features/particle-studio/dissolution/presets.ts`
- Create: `src/features/particle-studio/dissolution/shaders.ts`
- Modify: `tests/particle-studio.test.ts`

- [ ] Add one contract test asserting exactly these preset ids:

```ts
["dust", "nebula", "linear", "fog", "fire"]
```

- [ ] Define `DissolutionParams` with `invasion`, `bandwidth`, `scatter`, `pointSize`, `sampleStep`, `noise`, `waveStrength`, `waveFrequency`, `mode`, and `effect`.
- [ ] Port the first five Demo preset values without importing current `ParticleParams` or `PARTICLE_PRESETS`.
- [ ] Port only Demo effect branches `0` (standard dissolve) and `1` (fire) into standalone particle and plane shaders; omit effects 2–6.
- [ ] Run `npm run test:particle`; expect all tests to pass.

### Task 3: Build the dissolution renderer

**Files:**
- Create: `src/features/particle-studio/dissolution/DissolutionRenderer.ts`

- [ ] Create a perspective camera and rotatable scene group matching the Demo framing.
- [ ] Decode the shared file to a maximum 600px canvas, build a `CanvasTexture`, and sample non-transparent/non-black pixels at `sampleStep`.
- [ ] Build image-plane and particle materials from the new shaders with one shared uniform object.
- [ ] Expose `setFile`, `setParams`, `setAutoPlay`, `resetProgress`, `resetRotation`, `exportPng`, `exportMp4`, and `dispose`.
- [ ] Rebuild only particle Geometry when `sampleStep` changes; update all other parameters as uniforms.
- [ ] Remove animation frames, resize observers, pointer listeners, textures, geometries, materials, renderer, and canvas in `dispose`.

### Task 4: Add the dissolution studio UI and export flow

**Files:**
- Create: `src/features/particle-studio/dissolution/DissolutionStudio.tsx`
- Create: `src/features/particle-studio/dissolution/dissolution-studio.css`
- Modify: `src/features/particle-studio/ParticleStudio.tsx`

- [ ] Render the five preset buttons and Demo-specific slider labels, hiding particle controls for fire where the Demo does so.
- [ ] Keep upload/replace, auto play, reset, rotation reset, PNG, and MP4 actions in the dissolution toolbar.
- [ ] Use the existing five-second `exportCanvasToMp4` helper with the current group rotation fixed during export.
- [ ] Report exporting state to the shell so engine switching and file replacement are locked during export.
- [ ] Show decode/export errors as dismissible local notices.

### Task 5: Verify, run locally, and commit

**Files:**
- Verify: `src/features/particle-studio/**`
- Verify: `tests/particle-studio.test.ts`

- [ ] Run `npm run test:particle`; expect zero failures.
- [ ] Run the single shell component test only; expect zero failures.
- [ ] Run `npm run lint`; expect TypeScript to pass.
- [ ] Run `npm run build`; expect the Vite and server bundles to complete.
- [ ] Update the local `3005` container with the built `dist` and verify HTTP 200.
- [ ] Stage only the dual-particle-engine plan, particle-studio files, and focused tests; preserve all unrelated dirty files.
- [ ] Commit with `feat: add independent particle dissolution engine`.
