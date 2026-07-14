import type { DissolutionParams, DissolutionPreset, DissolutionPresetId } from "./types";

export const DISSOLUTION_PRESETS: Record<DissolutionPresetId, DissolutionPreset> = {
  dust: {
    id: "dust", name: "灰尘消散", mode: 0, effect: 0,
    invasion: 0.7, bandwidth: 0.3, scatter: 0.057, pointSize: 4,
    sampleStep: 1, noise: 0.14, waveStrength: 0.006, waveFrequency: 8,
  },
  nebula: {
    id: "nebula", name: "星云扩张", mode: 1, effect: 0,
    invasion: 0.52, bandwidth: 0.4, scatter: 0.065, pointSize: 3.5,
    sampleStep: 2, noise: 0.2, waveStrength: 0.006, waveFrequency: 8,
  },
  linear: {
    id: "linear", name: "线性扫除", mode: 2, effect: 0,
    invasion: 0.5, bandwidth: 0.16, scatter: 0.028, pointSize: 3,
    sampleStep: 2, noise: 0.05, waveStrength: 0, waveFrequency: 8,
  },
  fog: {
    id: "fog", name: "雾化飘落", mode: 3, effect: 0,
    invasion: 0.55, bandwidth: 0.48, scatter: 0.015, pointSize: 2.5,
    sampleStep: 2, noise: 0.28, waveStrength: 0.004, waveFrequency: 6,
  },
  fire: {
    id: "fire", name: "火焰涅槃", mode: 0, effect: 1,
    invasion: 0.58, bandwidth: 0.38, scatter: 0.025, pointSize: 3,
    sampleStep: 1, noise: 0.22, waveStrength: 0.018, waveFrequency: 22,
  },
};

export const DEFAULT_DISSOLUTION_PARAMS: DissolutionParams = { ...DISSOLUTION_PRESETS.dust };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const normalizeDissolutionParams = (params: DissolutionParams): DissolutionParams => ({
  ...params,
  invasion: clamp(params.invasion, 0, 1),
  bandwidth: clamp(params.bandwidth, 0.02, 0.7),
  scatter: clamp(params.scatter, 0, 0.12),
  pointSize: clamp(params.pointSize, 0.5, 8),
  sampleStep: Math.round(clamp(params.sampleStep, 1, 8)),
  noise: clamp(params.noise, 0, 0.8),
  waveStrength: clamp(params.waveStrength, 0, 0.03),
  waveFrequency: clamp(params.waveFrequency, 1, 40),
});
