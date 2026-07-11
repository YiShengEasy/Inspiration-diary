export type DepthMode = "fast" | "ai";
export type PresetId = "portrait" | "landscape" | "neon" | "mono" | "reference";

export interface ParticleParams {
  brightnessThreshold: number;
  contrast: number;
  edgeStrength: number;
  alphaThreshold: number;
  density: number;
  particleSize: number;
  scatter: number;
  driftSpeed: number;
  depthStrength: number;
  depthSmoothing: number;
  depthLayers: number;
  autoRotate: boolean;
  rotationSpeed: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  backgroundColor: string;
  cameraDistance: number;
  saturation: number;
}

export interface ParticleSource {
  width: number;
  height: number;
  colors: Float32Array;
  positions: Float32Array;
  depth: Float32Array;
  random: Float32Array;
  particleCount: number;
}

export interface QualityProfile {
  maxParticles: number;
  pixelRatio: number;
  bloomScale: number;
}

export interface DepthProgress {
  stage: "loading" | "download" | "inference" | "ready";
  progress: number;
  message: string;
}

export type DepthProgressHandler = (progress: DepthProgress) => void;
