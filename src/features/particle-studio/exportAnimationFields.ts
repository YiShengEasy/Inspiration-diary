import type { DissolutionParams } from "./dissolution/types";
import type { ExportAnimationField } from "./exportAnimation";
import type { ParticleParams } from "./types";

export type DepthExportAnimationKey = Exclude<keyof ParticleParams,
  "effectMode" | "dissolveDirection" | "backgroundColor" | "autoRotate"
  | "brightnessThreshold" | "contrast" | "edgeStrength" | "alphaThreshold"
  | "saturation" | "depthSmoothing" | "depthLayers"> & string;

export type DissolutionExportAnimationKey = Exclude<keyof DissolutionParams,
  "mode" | "effect" | "sampleStep"> & string;

export const DEPTH_EXPORT_ANIMATION_FIELDS: ExportAnimationField<DepthExportAnimationKey>[] = [
  { key: "dissolveProgress", label: "侵蚀进度", min: 0, max: 1, step: 0.01 },
  { key: "dissolveBandwidth", label: "过渡带宽度", min: 0.06, max: 0.6, step: 0.01 },
  { key: "density", label: "粒子密度", min: 0.05, max: 1, step: 0.01 },
  { key: "particleSize", label: "粒子大小", min: 0.6, max: 4.2, step: 0.1 },
  { key: "scatter", label: "粒子散开量", min: 0, max: 1.4, step: 0.01 },
  { key: "driftSpeed", label: "漂移速度", min: 0, max: 1, step: 0.01 },
  { key: "depthStrength", label: "深度强度", min: 0, max: 8, step: 0.1 },
  { key: "waveStrength", label: "水波强度", min: 0, max: 0.12, step: 0.002 },
  { key: "waveScale", label: "水波尺度", min: 0.8, max: 8, step: 0.1 },
  { key: "waveSpeed", label: "水波速度", min: 0, max: 1.4, step: 0.01 },
  { key: "invasionRange", label: "侵入范围", min: 0.1, max: 0.9, step: 0.01 },
  { key: "edgeSoftness", label: "边界柔化", min: 0.04, max: 0.45, step: 0.01 },
  { key: "irregularity", label: "不规则度", min: 0, max: 1, step: 0.01 },
  { key: "noiseScale", label: "噪声尺度", min: 1, max: 10, step: 0.1 },
  { key: "outerDispersion", label: "外部离散", min: 0, max: 1.6, step: 0.01 },
  { key: "colorRetention", label: "颜色保留", min: 0, max: 1, step: 0.01 },
  { key: "innerCrossStrength", label: "内部交错", min: 0, max: 1, step: 0.01 },
  { key: "bloomStrength", label: "Bloom 强度", min: 0, max: 3, step: 0.05 },
  { key: "bloomRadius", label: "Bloom 半径", min: 0, max: 1, step: 0.01 },
  { key: "bloomThreshold", label: "Bloom 阈值", min: 0, max: 1, step: 0.01 },
  { key: "cameraDistance", label: "镜头距离", min: 2.5, max: 10, step: 0.1 },
];

export const DISSOLUTION_EXPORT_ANIMATION_FIELDS: ExportAnimationField<DissolutionExportAnimationKey>[] = [
  { key: "invasion", label: "侵蚀进度", min: 0, max: 1, step: 0.01 },
  { key: "bandwidth", label: "过渡带宽度", min: 0.02, max: 0.7, step: 0.01 },
  { key: "scatter", label: "粒子散开量", min: 0, max: 0.12, step: 0.001 },
  { key: "pointSize", label: "粒子大小", min: 0.5, max: 8, step: 0.5 },
  { key: "noise", label: "边界噪波", min: 0, max: 0.8, step: 0.01 },
  { key: "waveStrength", label: "水波强度", min: 0, max: 0.03, step: 0.001 },
  { key: "waveFrequency", label: "水波频率", min: 1, max: 40, step: 1 },
];
