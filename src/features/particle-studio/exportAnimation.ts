import { MP4_EXPORT_FRAME_COUNT, mp4FrameTimestamp } from "./particleVideoExporter";

export interface ExportAnimationField<K extends string = string> {
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
}

export interface ExportAnimationTrack<K extends string = string> {
  key: K;
  from: number;
  to: number;
}

export const clampExportValue = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const smoothExportProgress = (progress: number): number => {
  const value = clampExportValue(progress, 0, 1);
  return value * value * (3 - 2 * value);
};

export const exportAnimationProgress = (timeSeconds: number): number => {
  const lastFrameTime = mp4FrameTimestamp(MP4_EXPORT_FRAME_COUNT - 1);
  return clampExportValue(timeSeconds / lastFrameTime, 0, 1);
};

export function interpolateExportParams<T extends object, K extends string>(
  base: T,
  tracks: readonly ExportAnimationTrack<K>[],
  progress: number,
): T {
  if (tracks.length === 0) return { ...base };
  const next = { ...base } as Record<string, unknown>;
  const eased = smoothExportProgress(progress);
  tracks.forEach((track) => {
    next[track.key] = track.from + (track.to - track.from) * eased;
  });
  return next as T;
}
