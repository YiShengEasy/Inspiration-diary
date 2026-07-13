import { createHash } from "node:crypto";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

/** Hashes semantic content independently of object-property insertion order. */
export function createContentFingerprint(content: unknown): string {
  return createHash("sha256").update(stableJson(content)).digest("hex");
}

export const fingerprintKnowledgeContent = createContentFingerprint;
