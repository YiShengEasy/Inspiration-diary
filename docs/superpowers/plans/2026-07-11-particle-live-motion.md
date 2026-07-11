# Particle Live Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified water-ripple/image-erosion/colored-particle renderer with smooth controls and deterministic 5-second H.264 MP4 export.

**Architecture:** Preprocess image masks and particle buffers in a module Worker, then keep visual controls as GPU uniforms so dragging never rebuilds geometry. The Three.js renderer owns a periodic five-second animation clock and exposes deterministic frame rendering; Mediabunny reads those rendered canvas frames, encodes AVC through WebCodecs, and muxes a 1080p MP4 in the browser.

**Tech Stack:** React 19, TypeScript, Three.js/WebGL shaders, Web Worker, WebCodecs, Mediabunny, Node test runner, Vite.

---

### Task 1: Define live-motion parameters and update classes

**Files:**
- Modify: `src/features/particle-studio/types.ts`
- Modify: `src/features/particle-studio/presets.ts`
- Modify: `tests/particle-studio.test.ts`

- [ ] **Step 1: Write failing tests for parameter defaults and classification**

Add assertions for `waveStrength`, `waveScale`, `waveSpeed`, `invasionRange`, `edgeSoftness`, `irregularity`, `noiseScale`, `outerDispersion`, and `colorRetention`. Assert that all nine are live parameters while `density`, `depthSmoothing`, and `depthLayers` are structural.

- [ ] **Step 2: Run the particle tests and verify missing fields fail**

Run: `npm run test:particle`

Expected: FAIL because the motion defaults and update classifier do not exist.

- [ ] **Step 3: Add typed defaults and classifier**

Extend `ParticleParams`, add conservative scheme-A values to every preset, clamp each value in `normalizeParams`, and export:

```ts
export const STRUCTURAL_PARAM_KEYS = new Set<keyof ParticleParams>([
  "density", "depthSmoothing", "depthLayers",
]);

export const requiresParticleRebuild = (before: ParticleParams, after: ParticleParams) =>
  [...STRUCTURAL_PARAM_KEYS].some((key) => before[key] !== after[key]);
```

- [ ] **Step 4: Run tests and commit**

Run: `npm run test:particle && npm run lint`

Commit: `feat: define live particle motion parameters`

### Task 2: Move particle preprocessing to a cancellable Worker

**Files:**
- Create: `src/features/particle-studio/particleWorker.ts`
- Create: `src/features/particle-studio/particleWorkerClient.ts`
- Modify: `src/features/particle-studio/ParticleStudio.tsx`
- Modify: `src/features/particle-studio/ParticleViewport.tsx`
- Test: `tests/particle-studio.test.ts`

- [ ] **Step 1: Add tests for latest-request-wins and transferable source buffers**

Extract request bookkeeping into a pure helper so Node tests can verify that an older task result is ignored after a newer task starts.

- [ ] **Step 2: Implement the module Worker**

The Worker receives RGBA, dimensions, params, particle cap, and optional AI depth. It runs `computeFastDepth` when no depth override exists, then `sampleParticleSource`, and posts the full `ParticleSource` with all typed-array buffers in the transfer list.

- [ ] **Step 3: Implement the client**

`ParticleWorkerClient.buildSource()` clones input buffers before transfer, increments a request ID, resolves only the latest task, exposes `cancelPending()`, and terminates on dispose.

- [ ] **Step 4: Replace synchronous React memos**

`ParticleStudio` stores `source` state instead of computing it in `useMemo`. Upload and depth-mode changes request immediate builds; structural changes use a 150ms timer. Live changes flow directly to `ParticleViewport` without rebuilding.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:particle && npm run lint`

Commit: `perf: preprocess particle sources in a worker`

### Task 3: Build one periodic water-and-erosion field

**Files:**
- Modify: `src/features/particle-studio/ParticleRenderer.ts`
- Modify: `src/features/particle-studio/shaders.ts`
- Modify: `src/features/particle-studio/fastDepth.ts`
- Test: `tests/particle-studio.test.ts`

- [ ] **Step 1: Add pure periodic-field tests**

Export a TypeScript reference helper for the loop phase and assert `phase(0) === phase(5)`, outward dispersion grows monotonically as coherence falls, and `colorRetention=1` preserves sampled RGB.

- [ ] **Step 2: Keep a broad reusable particle pool**

Stop deleting all non-boundary samples in `createDissolveParticleGeometry`. Attach content, boundary, edge, original color, depth, and random attributes so invasion range can change entirely on the GPU.

- [ ] **Step 3: Add periodic shared wave uniforms**

Add the nine motion uniforms plus `uLoopPhase`. Both surface and particle vertex shaders use the same low-frequency periodic displacement function. Core content is attenuated; outer particles receive larger displacement.

- [ ] **Step 4: Add automatic irregular invasion**

Surface alpha/darkening and particle visibility use the same content field plus coarse/fine periodic noise. `invasionRange` shifts the field threshold, `edgeSoftness` changes the transition width, and `irregularity`/`noiseScale` deform its shape without imposing a circle.

- [ ] **Step 5: Preserve source color**

Mix original particle RGB toward white only for highlight energy, scaled by `1 - colorRetention`. Increase scatter while reducing active particle density as coherence falls.

- [ ] **Step 6: Verify and commit**

Run: `npm run test:particle && npm run lint`

Commit: `feat: unify water ripple and colored particle erosion`

### Task 4: Make sliders frame-coalesced and visibly responsive

**Files:**
- Modify: `src/features/particle-studio/ParticleControls.tsx`
- Modify: `src/features/particle-studio/ParticleStudio.tsx`
- Modify: `src/features/particle-studio/particle-studio.css`

- [ ] **Step 1: Add the two control groups**

Add Water controls for strength, scale, and speed. Add Erosion controls for range, softness, irregularity, noise scale, outer dispersion, and color retention.

- [ ] **Step 2: Coalesce live updates**

Keep the newest slider value in a ref and schedule at most one `onChange` call per animation frame. Structural controls also update labels immediately but schedule only one 150ms Worker rebuild.

- [ ] **Step 3: Show rebuild state**

Display `正在重建粒子…` without hiding the current canvas. Disable export only during a pending source swap.

- [ ] **Step 4: Browser-check dragging and commit**

Drag every new range across its full span and confirm the thumb, output value, and canvas update without long tasks.

Commit: `perf: keep particle controls responsive`

### Task 5: Add deterministic H.264 MP4 export

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/features/particle-studio/particleVideoExporter.ts`
- Modify: `src/features/particle-studio/ParticleRenderer.ts`
- Modify: `src/features/particle-studio/ParticleStudio.tsx`
- Modify: `src/features/particle-studio/particle-studio.css`
- Test: `tests/particle-studio.test.ts`

- [ ] **Step 1: Install the maintained browser muxer**

Run: `npm install mediabunny@^1.50.8`

- [ ] **Step 2: Add renderer time and camera snapshots**

Expose `renderAt(loopTimeSeconds)` and `exportVideo(options)`. Export snapshots the current camera and controls target, pauses preview animation, renders the same WebGL canvas at 1920×1080, then restores size, camera, time, and playback state in `finally`.

- [ ] **Step 3: Implement MP4 encoding**

Create a `Mp4OutputFormat`, `BufferTarget`, and AVC `CanvasSource`. Check codec support for 1920×1080, start the output, render frames `0..149`, and call:

```ts
await source.add(frame / 30, 1 / 30);
```

Finalize and return `new Blob([target.buffer], { type: "video/mp4" })`. Yield after short frame batches, report progress, and honor an `AbortSignal`.

- [ ] **Step 4: Add export UI**

Keep PNG and add MP4. During export, lock parameters, show `已渲染 n / 150`, provide Cancel, and download as `particle-live-YYYYMMDD.mp4`.

- [ ] **Step 5: Add deterministic export tests**

Test frame timestamps, duration, filename, abort behavior, and that the final encoded sample ends at five seconds without duplicating the first frame.

- [ ] **Step 6: Verify and commit**

Run: `npm run test:particle && npm run lint && npm run build`

Commit: `feat: export live particle motion as mp4`

### Task 6: Visual and performance regression

**Files:**
- Modify if needed: `src/features/particle-studio/presets.ts`
- Modify if needed: `src/features/particle-studio/shaders.ts`

- [ ] **Step 1: Test the three approved images**

Use `mmexport1783757433339.jpg`, `mmexport1783757416026.jpg`, and `Screenshot_2026-06-28-14-03-17-702_com.ss.android.ugc.aweme.jpg`. Confirm central detail is stable, top/side/bottom content becomes colored particles, and outside dispersion is stronger without a circular boundary.

- [ ] **Step 2: Measure interaction**

Drag live parameters continuously for five seconds and confirm no source rebuild. Drag density continuously and confirm exactly one delayed Worker rebuild after release.

- [ ] **Step 3: Export and inspect MP4**

Export one reference image, then verify with `ffprobe` that the file is H.264, 1920×1080, 30 FPS, and approximately five seconds.

- [ ] **Step 4: Run final checks**

Run: `npm run test:particle && npm run lint && npm run build && git diff --check`

- [ ] **Step 5: Final commit**

Commit only any visual tuning needed after regression as `fix: tune live particle reference preset`.
