import type { ParticleParams, PresetId, QualityProfile } from "./types";

export const DEFAULT_PARTICLE_PARAMS: ParticleParams = {
  brightnessThreshold: 0.04,
  contrast: 1.1,
  edgeStrength: 0.35,
  alphaThreshold: 0.05,
  density: 0.72,
  particleSize: 1.4,
  scatter: 0.045,
  driftSpeed: 0.035,
  depthStrength: 2.4,
  depthSmoothing: 0.45,
  depthLayers: 24,
  autoRotate: false,
  rotationSpeed: 0.25,
  bloomStrength: 0.48,
  bloomRadius: 0.36,
  bloomThreshold: 0.72,
  backgroundColor: "#000000",
  cameraDistance: 5.2,
  saturation: 1,
};

export const PARTICLE_PRESETS: Record<PresetId, ParticleParams> = {
  portrait: { ...DEFAULT_PARTICLE_PARAMS, edgeStrength: 0.5, depthStrength: 2.1, scatter: 0.035 },
  landscape: { ...DEFAULT_PARTICLE_PARAMS, density: 0.85, particleSize: 1, depthStrength: 3.4 },
  neon: { ...DEFAULT_PARTICLE_PARAMS, contrast: 1.35, scatter: 0.09, bloomStrength: 0.85, bloomThreshold: 0.58, saturation: 1.25 },
  mono: { ...DEFAULT_PARTICLE_PARAMS, contrast: 1.3, edgeStrength: 0.7, saturation: 0, bloomStrength: 1.35 },
  reference: { ...DEFAULT_PARTICLE_PARAMS, contrast: 1.22, edgeStrength: 0.58, scatter: 0.055, depthStrength: 2.8, bloomStrength: 0.58, bloomThreshold: 0.68 },
};

export const getQualityProfile = (mobile: boolean, devicePixelRatio: number): QualityProfile => mobile
  ? { maxParticles: 25_000, pixelRatio: 1, bloomScale: 0.6 }
  : {
      maxParticles: devicePixelRatio > 1.5 ? 120_000 : 60_000,
      pixelRatio: Math.min(devicePixelRatio, 2),
      bloomScale: 1,
    };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const normalizeParams = (params: ParticleParams): ParticleParams => ({
  ...params,
  density: clamp(params.density, 0.05, 1),
  particleSize: clamp(params.particleSize, 0.4, 5),
  bloomStrength: clamp(params.bloomStrength, 0, 3),
  depthStrength: clamp(params.depthStrength, 0, 8),
  scatter: clamp(params.scatter, 0, 2),
  cameraDistance: clamp(params.cameraDistance, 2.5, 10),
});
