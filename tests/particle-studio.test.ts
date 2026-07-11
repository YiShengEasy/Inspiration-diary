import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PARTICLE_PARAMS,
  PARTICLE_PRESETS,
  getQualityProfile,
  normalizeParams,
} from "../src/features/particle-studio/presets";
import { computeFastDepth, sampleParticleSource } from "../src/features/particle-studio/fastDepth";
import { normalizeDepthOutput } from "../src/features/particle-studio/aiDepth";

test("ships the five approved presets", () => {
  assert.deepEqual(Object.keys(PARTICLE_PRESETS), ["portrait", "landscape", "neon", "mono", "reference"]);
});

test("caps mobile particles and pixel ratio", () => {
  assert.deepEqual(getQualityProfile(true, 4), { maxParticles: 25_000, pixelRatio: 1, bloomScale: 0.6 });
});

test("normalizes unsafe parameter input", () => {
  const next = normalizeParams({
    ...DEFAULT_PARTICLE_PARAMS,
    density: 9,
    particleSize: -1,
    bloomStrength: 99,
  });
  assert.equal(next.density, 1);
  assert.equal(next.particleSize, 0.4);
  assert.equal(next.bloomStrength, 3);
});

test("computes normalized depth from RGBA brightness", () => {
  const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
  assert.deepEqual(Array.from(computeFastDepth(rgba, 2, 1, DEFAULT_PARTICLE_PARAMS)), [0, 1]);
});

test("samples no more than the device particle cap", () => {
  const rgba = new Uint8ClampedArray(20 * 20 * 4).fill(255);
  const source = sampleParticleSource(
    rgba,
    new Float32Array(400).fill(0.5),
    20,
    20,
    DEFAULT_PARTICLE_PARAMS,
    50,
  );
  assert.equal(source.particleCount <= 50, true);
});

test("normalizes arbitrary AI depth output and supports inversion", () => {
  const normal = normalizeDepthOutput([10, 20, 30, 40], 2, 2);
  const inverted = normalizeDepthOutput([10, 20, 30, 40], 2, 2, true);
  [0, 1 / 3, 2 / 3, 1].forEach((expected, index) => assert.ok(Math.abs(normal[index] - expected) < 1e-6));
  [1, 2 / 3, 1 / 3, 0].forEach((expected, index) => assert.ok(Math.abs(inverted[index] - expected) < 1e-6));
});

test("normalizes flat AI depth output without NaN", () => {
  assert.deepEqual(Array.from(normalizeDepthOutput([7, 7], 2, 1)), [0, 0]);
});
