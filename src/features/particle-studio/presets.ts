import type { ParticleParams, PresetId, QualityProfile } from "./types";

export const DEFAULT_PARTICLE_PARAMS: ParticleParams = {
  brightnessThreshold: 0.03,
  contrast: 1.1,
  edgeStrength: 0.5,
  alphaThreshold: 0.05,
  density: 0.84,
  particleSize: 1.25,
  scatter: 0.09,
  driftSpeed: 0.035,
  depthStrength: 1.6,
  depthSmoothing: 0.45,
  depthLayers: 48,
  autoRotate: false,
  rotationSpeed: 0.25,
  bloomStrength: 0.64,
  bloomRadius: 0.42,
  bloomThreshold: 0.72,
  backgroundColor: "#000000",
  cameraDistance: 4.3,
  saturation: 1,
};

export const PARTICLE_PRESETS: Record<PresetId, ParticleParams> = {
  portrait: { ...DEFAULT_PARTICLE_PARAMS, density: 0.88, edgeStrength: 0.58, depthStrength: 1.4, scatter: 0.075 },
  landscape: { ...DEFAULT_PARTICLE_PARAMS, density: 0.85, particleSize: 1, depthStrength: 2 },
  neon: { ...DEFAULT_PARTICLE_PARAMS, contrast: 1.35, scatter: 0.09, bloomStrength: 0.85, bloomThreshold: 0.58, saturation: 1.25 },
  mono: { ...DEFAULT_PARTICLE_PARAMS, contrast: 1.3, edgeStrength: 0.7, saturation: 0, bloomStrength: 1.35 },
  reference: { ...DEFAULT_PARTICLE_PARAMS, density: 0.94, particleSize: 1.15, contrast: 1.22, edgeStrength: 0.68, scatter: 0.11, depthStrength: 1.7, bloomStrength: 0.88, bloomThreshold: 0.62 },
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
