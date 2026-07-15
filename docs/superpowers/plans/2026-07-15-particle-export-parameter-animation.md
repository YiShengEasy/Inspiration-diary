# Particle Export Parameter Animation Implementation Plan

> **For Codex:** Execute this plan inline and keep verification limited to focused utility tests, lint, and build.

**Goal:** Let both particle engines export MP4 videos in which any selected live parameters animate from their current values to user-specified end values.

**Architecture:** Add one shared track/interpolation module and one shared configuration dialog. Each studio supplies a safe field list and passes the resulting tracks to its Renderer; each Renderer evaluates tracks per frame and restores its original state in `finally`.

**Tech Stack:** React, TypeScript, Three.js/WebGL, existing MP4 exporter, Vitest.

---

### Task 1: Add shared animation model and focused tests

**Files:**
- Create: `src/features/particle-studio/exportAnimation.ts`
- Modify: `tests/particle-studio.test.ts`

Implement clamping, `smoothstep`, multi-track interpolation, and field metadata types. Add only endpoint, midpoint, and unselected-value assertions.

### Task 2: Add the shared export animation dialog

**Files:**
- Create: `src/features/particle-studio/ParticleExportAnimationDialog.tsx`
- Create: `src/features/particle-studio/particle-export-animation.css`
- Create: `src/features/particle-studio/exportAnimationFields.ts`

Render safe numeric fields for the active engine. Support multi-select, read-only current values, validated end values, cancel, and confirm-with-no-tracks.

### Task 3: Integrate tracks into both studios and Renderers

**Files:**
- Modify: `src/features/particle-studio/DepthParticleStudio.tsx`
- Modify: `src/features/particle-studio/ParticleRenderer.ts`
- Modify: `src/features/particle-studio/dissolution/DissolutionStudio.tsx`
- Modify: `src/features/particle-studio/dissolution/DissolutionRenderer.ts`

Open the dialog from MP4 buttons, pass tracks into `exportMp4`, interpolate them for every exported frame, keep natural time animation, make selected tracks override automatic values, and restore all preview parameters after success, failure, or cancellation.

### Task 4: Verify and deliver

Run the focused particle test, lint, and production build. Update the local port 3005 preview, perform a simple HTTP availability check, and commit only the implementation files.
