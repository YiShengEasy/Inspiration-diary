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

export interface SavedExportAnimationValue<K extends string = string> {
  key: K;
  to: number;
}

export type PreviewPlaybackState = "idle" | "playing" | "paused" | "ended";

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

export function sanitizeExportAnimationValues<K extends string>(
  fields: readonly ExportAnimationField<K>[],
  input: unknown,
): SavedExportAnimationValue<K>[] {
  if (!Array.isArray(input)) return [];
  const values = new Map(input.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as { key?: unknown; to?: unknown };
    return typeof candidate.key === "string" && Number.isFinite(Number(candidate.to))
      ? [[candidate.key, Number(candidate.to)] as const]
      : [];
  }));
  return fields.flatMap((field) => {
    const value = values.get(field.key);
    return value === undefined ? [] : [{
      key: field.key,
      to: clampExportValue(value, field.min, field.max),
    }];
  });
}

export function buildExportAnimationTracks<K extends string>(
  values: Record<K, number>,
  config: readonly SavedExportAnimationValue<K>[],
): ExportAnimationTrack<K>[] {
  return config.map((item) => ({ key: item.key, from: values[item.key], to: item.to }));
}

export function loadExportAnimationValues<K extends string>(
  storageKey: string,
  fields: readonly ExportAnimationField<K>[],
): SavedExportAnimationValue<K>[] {
  try {
    return sanitizeExportAnimationValues(fields, JSON.parse(localStorage.getItem(storageKey) ?? "[]"));
  } catch {
    return [];
  }
}

export function saveExportAnimationValues<K extends string>(
  storageKey: string,
  config: readonly SavedExportAnimationValue<K>[],
): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(config));
  } catch {
    // Storage can be disabled; the studio still keeps its in-memory configuration.
  }
}
