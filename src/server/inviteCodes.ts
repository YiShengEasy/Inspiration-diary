import crypto from "crypto";

export function normalizeInviteCode(value: string): string {
  return value.trim().replace(/[\s-]+/g, "").toUpperCase();
}

export function hashInviteCode(value: string): string {
  return crypto.createHash("sha256").update(normalizeInviteCode(value)).digest("hex");
}

export function createInviteCode(): string {
  return crypto.randomBytes(6).toString("hex").toUpperCase().match(/.{1,4}/g)!.join("-");
}
