import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PARTICLE_PARAMS,
  PARTICLE_PRESETS,
  getQualityProfile,
  normalizeParams,
  requiresParticleRebuild,
} from "../src/features/particle-studio/presets";
import { computeContentMask, computeFastDepth, sampleParticleSource } from "../src/features/particle-studio/fastDepth";
import { normalizeDepthOutput } from "../src/features/particle-studio/aiDepth";
import { dispersionForCoherence, loopPhase, retainParticleColor } from "../src/features/particle-studio/motionField";
import { isLatestParticleRequest } from "../src/features/particle-studio/particleWorkerClient";

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

test("ships live water, invasion, dispersion, and source-color controls", () => {
  assert.deepEqual(
    [
      "waveStrength", "waveScale", "waveSpeed", "invasionRange", "edgeSoftness",
      "irregularity", "noiseScale", "outerDispersion", "colorRetention",
    ].every((key) => key in DEFAULT_PARTICLE_PARAMS),
    true,
  );
});

test("only structural parameters require particle preprocessing", () => {
  assert.equal(requiresParticleRebuild(DEFAULT_PARTICLE_PARAMS, { ...DEFAULT_PARTICLE_PARAMS, waveStrength: 0.08 }), false);
  assert.equal(requiresParticleRebuild(DEFAULT_PARTICLE_PARAMS, { ...DEFAULT_PARTICLE_PARAMS, invasionRange: 0.7 }), false);
  assert.equal(requiresParticleRebuild(DEFAULT_PARTICLE_PARAMS, { ...DEFAULT_PARTICLE_PARAMS, density: 0.4 }), true);
  assert.equal(requiresParticleRebuild(DEFAULT_PARTICLE_PARAMS, { ...DEFAULT_PARTICLE_PARAMS, depthLayers: 12 }), true);
});

test("loops the live motion field exactly every five seconds", () => {
  assert.equal(loopPhase(0), loopPhase(5));
  assert.equal(loopPhase(1.25), 0.25);
});

test("increases dispersion as coherence falls", () => {
  assert.ok(dispersionForCoherence(0.1, 1) > dispersionForCoherence(0.5, 1));
  assert.ok(dispersionForCoherence(0.5, 1) > dispersionForCoherence(0.9, 1));
});

test("preserves source RGB when color retention is full", () => {
  assert.deepEqual(retainParticleColor([0.15, 0.4, 0.85], 1, 1), [0.15, 0.4, 0.85]);
});

test("accepts only the latest particle worker result", () => {
  assert.equal(isLatestParticleRequest(8, 8), true);
  assert.equal(isLatestParticleRequest(8, 7), false);
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

test("builds a content-shaped mask instead of a rectangular frame", () => {
  const width = 9;
  const height = 9;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) rgba[index * 4 + 3] = 255;
  for (let y = 3; y <= 5; y += 1) {
    for (let x = 3; x <= 5; x += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = 255;
      rgba[offset + 1] = 255;
      rgba[offset + 2] = 255;
    }
  }
  const mask = computeContentMask(rgba, width, height, [0, 0, 0, 1], DEFAULT_PARTICLE_PARAMS);
  assert.ok(mask[4 * width + 4] > 0.9);
  assert.ok(mask[0] < 0.1);
  assert.ok(mask[4 * width + 4] - mask[0] > 0.8);
});

test("samples low edge values from a solid-color image", () => {
  const width = 5;
  const height = 5;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  const source = sampleParticleSource(
    rgba,
    new Float32Array(width * height),
    width,
    height,
    { ...DEFAULT_PARTICLE_PARAMS, density: 1 },
    width * height,
  );
  assert.equal(source.edge.length, source.particleCount);
  assert.equal(source.content.length, source.particleCount);
  assert.equal(source.contentMap.length, width * height);
  assert.equal(source.boundary.length, source.particleCount);
  assert.equal(source.boundaryMap.length, width * height);
  assert.equal(Math.max(...source.edge), 0);
  assert.deepEqual(source.background, [1, 1, 1, 1]);
});

test("samples high edge values at a black-white boundary", () => {
  const width = 6;
  const height = 5;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = x < width / 2 ? 0 : 255;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
  }
  const source = sampleParticleSource(
    rgba,
    new Float32Array(width * height),
    width,
    height,
    { ...DEFAULT_PARTICLE_PARAMS, brightnessThreshold: 0, density: 1 },
    width * height,
  );
  const sampledEdges = Array.from(source.edge);
  assert.equal(sampledEdges.filter((edge) => edge > 0.9).length, height * 2);
  assert.ok(sampledEdges.some((edge) => edge === 0));
  assert.ok(source.background[3] < 0.1);
});

test("jitters sampled positions instead of aligning particles on repeated rows", () => {
  const width = 32;
  const height = 24;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  const source = sampleParticleSource(
    rgba,
    new Float32Array(width * height).fill(0.5),
    width,
    height,
    { ...DEFAULT_PARTICLE_PARAMS, density: 0.5 },
    200,
  );
  let repeatedAdjacentY = 0;
  for (let particle = 1; particle < source.particleCount; particle += 1) {
    if (source.positions[particle * 3 + 1] === source.positions[(particle - 1) * 3 + 1]) {
      repeatedAdjacentY += 1;
    }
  }
  assert.ok(repeatedAdjacentY < source.particleCount * 0.1);
});

test("produces identical particle samples for identical input", () => {
  const width = 16;
  const height = 12;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  const depth = Float32Array.from({ length: width * height }, (_, index) => index / (width * height));
  const first = sampleParticleSource(rgba, depth, width, height, DEFAULT_PARTICLE_PARAMS, 80);
  const second = sampleParticleSource(rgba, depth, width, height, DEFAULT_PARTICLE_PARAMS, 80);
  assert.deepEqual(first, second);
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
