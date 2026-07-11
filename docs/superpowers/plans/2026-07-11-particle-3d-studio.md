# Particle 3D Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent Web tool that converts uploaded images into configurable, rotatable, glowing 3D particle point clouds with fast and AI depth modes.

**Architecture:** React owns navigation and controls while a focused `ParticleRenderer` class owns Three.js, shaders, interaction, post-processing, export, and disposal. Image preprocessing produces one common `ParticleSource` contract; fast Canvas depth is available immediately and a lazy-loaded Depth Anything V2 Small processor can replace only the depth channel.

**Tech Stack:** React 19, TypeScript, Three.js, GLSL, OrbitControls, EffectComposer, UnrealBloomPass, Transformers.js, WebGPU/WASM, Vite, Node test runner via `tsx`

---

## File Structure

- Modify `package.json` and `package-lock.json`: add Three.js and browser depth-model dependencies plus a focused test command.
- Create `src/features/particle-studio/types.ts`: shared parameter, preset, source, progress, and renderer contracts.
- Create `src/features/particle-studio/presets.ts`: defaults, device profiles, and five immutable presets.
- Create `src/features/particle-studio/fastDepth.ts`: pure RGBA-to-depth algorithm and browser image decoding.
- Create `src/features/particle-studio/aiDepth.ts`: lazy Transformers.js depth inference with progress and fallback errors.
- Create `src/features/particle-studio/shaders.ts`: particle vertex and fragment shaders.
- Create `src/features/particle-studio/ParticleRenderer.ts`: Three.js scene, points, controls, Bloom, export, adaptive quality, and disposal.
- Create `src/features/particle-studio/ParticleViewport.tsx`: React lifecycle wrapper around the renderer.
- Create `src/features/particle-studio/ParticleControls.tsx`: grouped desktop panel and mobile drawer.
- Create `src/features/particle-studio/ParticleStudio.tsx`: upload workflow, modes, presets, progress, errors, and layout.
- Create `src/features/particle-studio/particle-studio.css`: isolated immersive tool styles.
- Modify `src/App.tsx`: add lazy-loaded `particles` main view and navigation entry.
- Create `tests/particle-studio.test.ts`: deterministic tests for presets, fast depth, quality profiles, and parameter normalization.

### Task 1: Install dependencies and define stable contracts

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/features/particle-studio/types.ts`
- Create: `src/features/particle-studio/presets.ts`
- Create: `tests/particle-studio.test.ts`

- [ ] **Step 1: Install runtime and type dependencies**

Run:

```bash
npm install three @huggingface/transformers
npm install --save-dev @types/three
```

Expected: dependencies are recorded in `package.json` and lockfile without peer-resolution errors.

- [ ] **Step 2: Add the focused test command**

Add to `package.json` scripts:

```json
"test:particle": "tsx --test tests/particle-studio.test.ts"
```

- [ ] **Step 3: Write contract and preset tests first**

Create `tests/particle-studio.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PARTICLE_PARAMS, PARTICLE_PRESETS, getQualityProfile, normalizeParams } from "../src/features/particle-studio/presets";

test("ships the five approved presets", () => {
  assert.deepEqual(Object.keys(PARTICLE_PRESETS), ["portrait", "landscape", "neon", "mono", "reference"]);
});

test("caps mobile particles and pixel ratio", () => {
  assert.deepEqual(getQualityProfile(true, 4), { maxParticles: 25_000, pixelRatio: 1, bloomScale: 0.6 });
});

test("normalizes unsafe parameter input", () => {
  const next = normalizeParams({ ...DEFAULT_PARTICLE_PARAMS, density: 9, particleSize: -1, bloomStrength: 99 });
  assert.equal(next.density, 1);
  assert.equal(next.particleSize, 0.4);
  assert.equal(next.bloomStrength, 3);
});
```

- [ ] **Step 4: Run the new test and verify red state**

Run: `npm run test:particle`

Expected: FAIL because `presets.ts` does not exist.

- [ ] **Step 5: Implement contracts**

Create `src/features/particle-studio/types.ts` with these complete public contracts:

```ts
export type DepthMode = "fast" | "ai";
export type PresetId = "portrait" | "landscape" | "neon" | "mono" | "reference";

export interface ParticleParams {
  brightnessThreshold: number; contrast: number; edgeStrength: number; alphaThreshold: number;
  density: number; particleSize: number; scatter: number; driftSpeed: number;
  depthStrength: number; depthSmoothing: number; depthLayers: number;
  autoRotate: boolean; rotationSpeed: number;
  bloomStrength: number; bloomRadius: number; bloomThreshold: number;
  backgroundColor: string; cameraDistance: number; saturation: number;
}

export interface ParticleSource {
  width: number; height: number; colors: Float32Array; positions: Float32Array;
  depth: Float32Array; random: Float32Array; particleCount: number;
}

export interface QualityProfile { maxParticles: number; pixelRatio: number; bloomScale: number; }
export interface DepthProgress { stage: "loading" | "download" | "inference" | "ready"; progress: number; message: string; }
export type DepthProgressHandler = (progress: DepthProgress) => void;
```

- [ ] **Step 6: Implement defaults, profiles, presets, and normalization**

Create `presets.ts` exporting:

```ts
export const DEFAULT_PARTICLE_PARAMS: ParticleParams = {
  brightnessThreshold: 0.04, contrast: 1.1, edgeStrength: 0.35, alphaThreshold: 0.05,
  density: 0.72, particleSize: 1.4, scatter: 0.18, driftSpeed: 0.12,
  depthStrength: 2.4, depthSmoothing: 0.45, depthLayers: 24,
  autoRotate: false, rotationSpeed: 0.25,
  bloomStrength: 1.15, bloomRadius: 0.65, bloomThreshold: 0.08,
  backgroundColor: "#000000", cameraDistance: 5.2, saturation: 1,
};

export const PARTICLE_PRESETS: Record<PresetId, ParticleParams> = {
  portrait: { ...DEFAULT_PARTICLE_PARAMS, edgeStrength: 0.5, depthStrength: 2.1, scatter: 0.12 },
  landscape: { ...DEFAULT_PARTICLE_PARAMS, density: 0.85, particleSize: 1, depthStrength: 3.4 },
  neon: { ...DEFAULT_PARTICLE_PARAMS, contrast: 1.35, scatter: 0.3, bloomStrength: 1.8, saturation: 1.25 },
  mono: { ...DEFAULT_PARTICLE_PARAMS, contrast: 1.3, edgeStrength: 0.7, saturation: 0, bloomStrength: 1.35 },
  reference: { ...DEFAULT_PARTICLE_PARAMS, contrast: 1.22, edgeStrength: 0.58, scatter: 0.24, depthStrength: 2.8, bloomStrength: 1.55 },
};

export const getQualityProfile = (mobile: boolean, devicePixelRatio: number): QualityProfile => mobile
  ? { maxParticles: 25_000, pixelRatio: 1, bloomScale: 0.6 }
  : { maxParticles: devicePixelRatio > 1.5 ? 120_000 : 60_000, pixelRatio: Math.min(devicePixelRatio, 2), bloomScale: 1 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const normalizeParams = (params: ParticleParams): ParticleParams => ({
  ...params,
  density: clamp(params.density, 0.05, 1), particleSize: clamp(params.particleSize, 0.4, 5),
  bloomStrength: clamp(params.bloomStrength, 0, 3), depthStrength: clamp(params.depthStrength, 0, 8),
  scatter: clamp(params.scatter, 0, 2), cameraDistance: clamp(params.cameraDistance, 2.5, 10),
});
```

- [ ] **Step 7: Run tests and commit**

Run: `npm run test:particle && npm run lint`

Expected: all particle tests and TypeScript checks pass.

```bash
git add package.json package-lock.json src/features/particle-studio/types.ts src/features/particle-studio/presets.ts tests/particle-studio.test.ts
git commit -m "feat: define particle studio contracts"
```

### Task 2: Build deterministic fast depth and particle sampling

**Files:**
- Create: `src/features/particle-studio/fastDepth.ts`
- Modify: `tests/particle-studio.test.ts`

- [ ] **Step 1: Add failing depth tests**

Append:

```ts
import { computeFastDepth, sampleParticleSource } from "../src/features/particle-studio/fastDepth";

test("computes normalized depth from RGBA brightness", () => {
  const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
  assert.deepEqual(Array.from(computeFastDepth(rgba, 2, 1, DEFAULT_PARTICLE_PARAMS)), [0, 1]);
});

test("samples no more than the device particle cap", () => {
  const rgba = new Uint8ClampedArray(20 * 20 * 4).fill(255);
  const source = sampleParticleSource(rgba, new Float32Array(400).fill(0.5), 20, 20, DEFAULT_PARTICLE_PARAMS, 50);
  assert.equal(source.particleCount <= 50, true);
});
```

- [ ] **Step 2: Verify red state**

Run: `npm run test:particle`

Expected: FAIL because `fastDepth.ts` does not exist.

- [ ] **Step 3: Implement pure processing and browser decoding**

Create `fastDepth.ts` exporting these functions:

```ts
export function computeFastDepth(rgba: Uint8ClampedArray, width: number, height: number, params: ParticleParams): Float32Array;
export function sampleParticleSource(rgba: Uint8ClampedArray, depth: Float32Array, width: number, height: number, params: ParticleParams, maxParticles: number): ParticleSource;
export async function decodeImageFile(file: File, maxDimension: number): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }>;
```

Implementation requirements: luminance is `(0.2126*r + 0.7152*g + 0.0722*b)/255`; Sobel edge magnitude is blended by `edgeStrength`; depth is box-smoothed according to `depthSmoothing` and quantized to `depthLayers`; sampling uses a deterministic stride derived from `density` and `maxParticles`; positions preserve image aspect ratio; colors remain normalized RGB and apply contrast/saturation only at sampling time.

- [ ] **Step 4: Run tests and commit**

Run: `npm run test:particle && npm run lint`

Expected: depth normalization and particle cap tests pass.

```bash
git add src/features/particle-studio/fastDepth.ts tests/particle-studio.test.ts
git commit -m "feat: generate fast image depth and particles"
```

### Task 3: Implement the Three.js renderer and shaders

**Files:**
- Create: `src/features/particle-studio/shaders.ts`
- Create: `src/features/particle-studio/ParticleRenderer.ts`
- Create: `src/features/particle-studio/ParticleViewport.tsx`

- [ ] **Step 1: Create seek-safe GPU shaders**

Create `shaders.ts` with a vertex shader consuming `position`, `color`, `aDepth`, and `aRandom`, and uniforms `uDepthStrength`, `uScatter`, `uDrift`, `uTime`, `uProgress`, and `uPointSize`. The fragment shader must discard outside a circular sprite, soften edges, and output vertex color with alpha.

- [ ] **Step 2: Implement the renderer lifecycle**

Create `ParticleRenderer` with this public API:

```ts
export class ParticleRenderer {
  constructor(container: HTMLElement, profile: QualityProfile, onPerformanceMode?: (reduced: boolean) => void);
  setSource(source: ParticleSource): void;
  setParams(params: ParticleParams): void;
  resetCamera(): void;
  resize(): void;
  exportPng(scale?: number): Promise<Blob>;
  pause(): void;
  resume(): void;
  dispose(): void;
}
```

Internally create one `WebGLRenderer`, `PerspectiveCamera`, `Scene`, `Points<BufferGeometry, ShaderMaterial>`, `OrbitControls`, `EffectComposer`, `RenderPass`, and `UnrealBloomPass`. Preserve the drawing buffer only during export; use `ResizeObserver`; count rolling FPS and reduce pixel ratio/Bloom after 120 consecutive frames below 30 FPS; cancel animation and dispose every GPU resource in `dispose()`.

- [ ] **Step 3: Add the React lifecycle wrapper**

`ParticleViewport` receives `source`, `params`, `profile`, `paused`, `onRendererReady`, and `onPerformanceMode`. It creates exactly one renderer per mounted container, calls setters from effects, pauses on `document.visibilitychange`, and disposes on unmount.

- [ ] **Step 4: Compile and commit**

Run: `npm run lint && npm run build`

Expected: Three.js addons and shaders bundle without TypeScript errors.

```bash
git add src/features/particle-studio/shaders.ts src/features/particle-studio/ParticleRenderer.ts src/features/particle-studio/ParticleViewport.tsx
git commit -m "feat: render interactive 3d image particles"
```

### Task 4: Add lazy AI depth with reliable fallback

**Files:**
- Create: `src/features/particle-studio/aiDepth.ts`
- Modify: `tests/particle-studio.test.ts`

- [ ] **Step 1: Define an injectable inference boundary and test normalization**

Add a test for `normalizeDepthOutput(values, width, height)` that verifies arbitrary min/max model output becomes a `Float32Array` in `[0, 1]` and inverted output can be requested.

- [ ] **Step 2: Implement lazy browser inference**

Create `aiDepth.ts` exporting:

```ts
export async function generateAiDepth(
  file: File,
  width: number,
  height: number,
  onProgress: DepthProgressHandler,
  signal?: AbortSignal,
): Promise<Float32Array>;
export function normalizeDepthOutput(values: ArrayLike<number>, width: number, height: number, invert?: boolean): Float32Array;
```

Use dynamic `import("@huggingface/transformers")`, configure browser cache, create a singleton `pipeline("depth-estimation", "onnx-community/depth-anything-v2-small", { device: navigator.gpu ? "webgpu" : "wasm" })`, forward download progress, convert output to the requested size, and throw a Chinese `Error` on cancellation, unsupported backend, download failure, or inference failure. The caller owns fallback to fast depth.

- [ ] **Step 3: Verify lazy chunking and commit**

Run: `npm run test:particle && npm run lint && npm run build`

Expected: tests pass and the production build emits the Transformers/model runtime as a lazy chunk rather than the primary app chunk.

```bash
git add src/features/particle-studio/aiDepth.ts tests/particle-studio.test.ts
git commit -m "feat: add optional ai depth for particles"
```

### Task 5: Build controls, presets, workflow, and PNG export

**Files:**
- Create: `src/features/particle-studio/ParticleControls.tsx`
- Create: `src/features/particle-studio/ParticleStudio.tsx`
- Create: `src/features/particle-studio/particle-studio.css`

- [ ] **Step 1: Build the grouped parameter surface**

Create accessible range/color/checkbox controls for every `ParticleParams` field, grouped as 图像、粒子、立体、辉光、场景. Desktop uses a collapsible right rail; screens below 768px use a bottom drawer. Every control has a visible label, current numeric value, and reset action.

- [ ] **Step 2: Build the complete studio state machine**

`ParticleStudio` owns:

```ts
type StudioStatus = "empty" | "decoding" | "fast-ready" | "ai-loading" | "ai-ready" | "error";
```

On file selection: validate MIME type, revoke the prior object URL, decode at the device-safe resolution, compute fast depth, sample particles, show the fast result, then run AI depth only when selected. If AI fails, retain the fast source and show a non-blocking fallback notice. Abort stale inference when the image changes or the component unmounts.

- [ ] **Step 3: Wire presets, interactions, and export**

Add 人像、风景、霓虹、黑白、参考图 buttons; applying one replaces the parameter object but not the image or depth mode. Add upload/replace, 快速/AI toggle, reset camera, auto-rotate, panel collapse, and PNG export. Download the renderer blob as `particle-3d-YYYYMMDD-HHmmss.png`.

- [ ] **Step 4: Implement the approved visual design**

Use a black full-screen canvas, compact translucent top-left toolbar, cyan active accents, right-side dark control panel, progress overlay, error toast, FPS/performance badge, and bottom mobile drawer. Keep all selectors beneath `.particle-studio` to prevent global style leakage.

- [ ] **Step 5: Compile and commit**

Run: `npm run lint && npm run build`

Expected: the complete studio compiles and the main page is unchanged because navigation is not wired yet.

```bash
git add src/features/particle-studio/ParticleControls.tsx src/features/particle-studio/ParticleStudio.tsx src/features/particle-studio/particle-studio.css
git commit -m "feat: build particle 3d studio workflow"
```

### Task 6: Add the independent tool entry to the Web app

**Files:**
- Modify: `src/App.tsx:1-100`
- Modify: `src/App.tsx:1690-2265`

- [ ] **Step 1: Extend the view contract and lazy import**

Add:

```ts
const ParticleStudio = React.lazy(() => import("./features/particle-studio/ParticleStudio"));
type MainView = "board" | "books" | "tags" | "particles";
```

Change `mainView` to `useState<MainView>("board")`.

- [ ] **Step 2: Add the navigation entry**

Add a `Sparkles`/`Wand2`-style “粒子 3D” button beside the existing 灵感册 and 标签库 controls. Clicking toggles between `particles` and `board`; its title and `aria-pressed` must match current state.

- [ ] **Step 3: Render the isolated full-screen view**

When `mainView === "particles"`, render outside the normal notebook max-width surface:

```tsx
<React.Suspense fallback={<div className="grid min-h-[70vh] place-items-center"><Loader2 className="animate-spin" /></div>}>
  <ParticleStudio onBack={() => setMainView("board")} />
</React.Suspense>
```

Hide notebook-only smart-book switches and theme styling while the tool is active, but retain logout and an explicit return action.

- [ ] **Step 4: Verify and commit**

Run: `npm run test:particle && npm run lint && npm run build`

Expected: all checks pass and ParticleStudio remains a lazy chunk.

```bash
git add src/App.tsx
git commit -m "feat: add particle studio web entry"
```

### Task 7: Browser verification and regression audit

**Files:**
- Verify: `src/features/particle-studio/**`
- Verify: `src/App.tsx`

- [ ] **Step 1: Start the existing local app**

Run: `npm run dev`

Expected: the configured local server starts without runtime import errors.

- [ ] **Step 2: Exercise the desktop workflow**

In the browser: sign in, open 粒子 3D, upload JPG/PNG/WebP fixtures, verify fast rendering, drag rotation, wheel zoom, double-click reset, every parameter group, five presets, AI progress/fallback, panel collapse, and PNG export. Confirm exported PNG includes the active camera angle and Bloom.

- [ ] **Step 3: Exercise mobile and failure paths**

Use a mobile viewport and verify the bottom drawer, touch rotation, pinch zoom, 25k cap, hidden-tab pause, image replacement, oversized-image downscale, AI cancellation, and fast-mode retention after forced AI failure.

- [ ] **Step 4: Check resource cleanup**

Navigate into and out of the studio three times. Confirm only one canvas exists on each entry, animation stops after exit, object URLs are revoked, and the browser does not report increasing WebGL contexts.

- [ ] **Step 5: Run final automated verification**

Run:

```bash
npm run test:particle
npm run lint
npm run build
git diff --check
git status --short
```

Expected: tests, types, and production build pass; no whitespace errors; only pre-existing `.superpowers`, prototype, or explicitly excluded untracked files remain.

