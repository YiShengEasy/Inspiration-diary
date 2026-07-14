export type DissolutionPresetId = "dust" | "nebula" | "linear" | "fog" | "fire";
export type DissolutionMode = 0 | 1 | 2 | 3;
export type DissolutionEffect = 0 | 1;

export interface DissolutionParams {
  mode: DissolutionMode;
  effect: DissolutionEffect;
  invasion: number;
  bandwidth: number;
  scatter: number;
  pointSize: number;
  sampleStep: number;
  noise: number;
  waveStrength: number;
  waveFrequency: number;
}

export interface DissolutionPreset extends DissolutionParams {
  id: DissolutionPresetId;
  name: string;
}
