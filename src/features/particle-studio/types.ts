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
  waveStrength: number;
  waveScale: number;
  waveSpeed: number;
  invasionRange: number;
  edgeSoftness: number;
  irregularity: number;
  noiseScale: number;
  outerDispersion: number;
  colorRetention: number;
  innerCrossStrength: number;
}

export interface ParticleSource {
  width: number;
  height: number;
  background: [number, number, number, number];
  imageRgba: Uint8Array;
  depthMap: Float32Array;
  contentMap: Float32Array;
  boundaryMap: Float32Array;
  colors: Float32Array;
  positions: Float32Array;
  depth: Float32Array;
  edge: Float32Array;
  content: Float32Array;
  boundary: Float32Array;
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
