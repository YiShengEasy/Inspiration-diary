import type { KnowledgeProperties, PropertyValue } from "./types.ts";

export const KNOWLEDGE_PROPERTY_LIMITS = {
  maxKeys: 50,
  maxKeyLength: 80,
  maxSerializedValueLength: 2_000,
} as const;

export class KnowledgePropertyValidationError extends Error {
  constructor(
    public readonly code:
      | "properties_not_object"
      | "too_many_properties"
      | "invalid_property_key"
      | "invalid_property_value"
      | "property_value_too_long"
      | "markdown_not_allowed",
    message: string,
  ) {
    super(message);
    this.name = "KnowledgePropertyValidationError";
  }
}

// Deliberately conservative: properties are metadata, not a second Markdown body.
const MARKDOWN_PATTERN =
  /(^|\n)\s{0,3}(?:#{1,6}\s|[-*+]\s|>\s|```)|(?:\*\*|__|~~|`)[^\n]+(?:\*\*|__|~~|`)|!?\[[^\]]+\]\([^\)]+\)|\[\[[^\]]+\]\]/u;

function containsMarkdown(value: string): boolean {
  return MARKDOWN_PATTERN.test(value);
}

function isNodeReference(value: object): value is { nodeId: string } {
  const entries = Object.entries(value);
  return (
    entries.length === 1 &&
    entries[0]?.[0] === "nodeId" &&
    typeof entries[0][1] === "string" &&
    entries[0][1].trim().length > 0
  );
}

function validateValue(key: string, value: unknown): asserts value is PropertyValue {
  const validScalar =
    typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value));
  const validStrings =
    Array.isArray(value) && value.every((item) => typeof item === "string");
  const validReference =
    value !== null && !Array.isArray(value) && typeof value === "object" && isNodeReference(value);

  if (!validScalar && !validStrings && !validReference) {
    throw new KnowledgePropertyValidationError(
      "invalid_property_value",
      `属性“${key}”只允许文本、文本数组、有限数字、布尔值或 nodeId 引用`,
    );
  }

  const strings = typeof value === "string" ? [value] : validStrings ? value : [];
  if (strings.some(containsMarkdown)) {
    throw new KnowledgePropertyValidationError(
      "markdown_not_allowed",
      `属性“${key}”不能包含 Markdown 语法`,
    );
  }

  if (JSON.stringify(value).length > KNOWLEDGE_PROPERTY_LIMITS.maxSerializedValueLength) {
    throw new KnowledgePropertyValidationError(
      "property_value_too_long",
      `属性“${key}”超过 ${KNOWLEDGE_PROPERTY_LIMITS.maxSerializedValueLength} 个序列化字符`,
    );
  }
}

/** Validates and returns a shallow copy safe to persist as JSONB. */
export function validateKnowledgeProperties(input: unknown): KnowledgeProperties {
  if (input === null || Array.isArray(input) || typeof input !== "object") {
    throw new KnowledgePropertyValidationError("properties_not_object", "属性必须是对象");
  }

  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > KNOWLEDGE_PROPERTY_LIMITS.maxKeys) {
    throw new KnowledgePropertyValidationError(
      "too_many_properties",
      `属性不能超过 ${KNOWLEDGE_PROPERTY_LIMITS.maxKeys} 项`,
    );
  }

  const result: KnowledgeProperties = {};
  for (const [rawKey, value] of entries) {
    const key = rawKey.trim();
    if (!key || key.length > KNOWLEDGE_PROPERTY_LIMITS.maxKeyLength || key !== rawKey) {
      throw new KnowledgePropertyValidationError(
        "invalid_property_key",
        `属性名必须为 1-${KNOWLEDGE_PROPERTY_LIMITS.maxKeyLength} 个字符且首尾不能有空格`,
      );
    }
    validateValue(key, value);
    result[key] = value;
  }
  return result;
}
