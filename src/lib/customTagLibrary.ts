import type { CustomTagGroup } from "../types";

export const CUSTOM_TAG_LIBRARY_SETTINGS_KEY = "custom_tag_library";
export const CUSTOM_TAG_LIBRARY_ENABLED_SETTINGS_KEY = "custom_tag_library_enabled";

export function createCustomTagGroup(name = "新标签组"): CustomTagGroup {
  const now = Date.now();
  return {
    id: `tag_group_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    enabled: true,
    terms: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeTagTerm(term: string): string {
  return term.trim().replace(/\s+/g, " ");
}

export function parseTagInput(input: string): string[] {
  return input
    .split(/[\n,，;；、]+/)
    .map(normalizeTagTerm)
    .filter(Boolean);
}

export function normalizeCustomTagGroups(value: unknown): CustomTagGroup[] {
  let rawValue = value;
  if (typeof value === "string") {
    try {
      rawValue = JSON.parse(value);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(rawValue)) return [];

  return rawValue
    .map((item): CustomTagGroup | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Partial<CustomTagGroup>;
      const name = typeof record.name === "string" ? normalizeTagTerm(record.name) : "";
      if (!name) return null;

      const seen = new Set<string>();
      const terms = Array.isArray(record.terms)
        ? record.terms
            .filter((term): term is string => typeof term === "string")
            .map(normalizeTagTerm)
            .filter((term) => {
              const key = term.toLowerCase();
              if (!term || seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .slice(0, 80)
        : [];

      const now = Date.now();
      return {
        id: typeof record.id === "string" && record.id.trim()
          ? record.id
          : `tag_group_${now}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        enabled: record.enabled !== false,
        terms,
        createdAt: Number(record.createdAt) || now,
        updatedAt: Number(record.updatedAt) || now,
      };
    })
    .filter((group): group is CustomTagGroup => Boolean(group))
    .slice(0, 30);
}

export function flattenCustomTagGroups(groups: CustomTagGroup[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  groups.forEach((group) => {
    group.terms.forEach((term) => {
      const normalized = normalizeTagTerm(term);
      const key = normalized.toLowerCase();
      if (!normalized || seen.has(key)) return;
      seen.add(key);
      terms.push(normalized);
    });
  });

  return terms.slice(0, 200);
}

export function flattenEnabledCustomTagGroups(groups: CustomTagGroup[]): string[] {
  return flattenCustomTagGroups(groups.filter((group) => group.enabled !== false));
}
