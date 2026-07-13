import type { UploadStatus } from "./types.ts";

const ALLOWED_TRANSITIONS: Readonly<
  Record<UploadStatus, ReadonlySet<UploadStatus>>
> = {
  authorized: new Set(["uploaded", "failed", "expired"]),
  uploaded: new Set(["finalized", "failed", "expired"]),
  finalized: new Set(["claimed", "failed", "expired"]),
  claimed: new Set(),
  failed: new Set(),
  expired: new Set(),
};

export function isIdempotentTransition(
  from: UploadStatus,
  to: UploadStatus,
): boolean {
  return from === to && (to === "finalized" || to === "claimed");
}

export function canTransition(
  from: UploadStatus,
  to: UploadStatus,
): boolean {
  return isIdempotentTransition(from, to) || ALLOWED_TRANSITIONS[from].has(to);
}
