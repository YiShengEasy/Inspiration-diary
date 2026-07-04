const { request } = require("./api");

const CUSTOM_TAG_LIBRARY_SETTINGS_KEY = "custom_tag_library";
const CUSTOM_TAG_LIBRARY_ENABLED_SETTINGS_KEY = "custom_tag_library_enabled";

function createCustomTagGroup(name = "新标签组") {
  const now = Date.now();
  return {
    id: `tag_group_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    enabled: true,
    terms: [],
    createdAt: now,
    updatedAt: now
  };
}

function normalizeTagTerm(term) {
  return String(term || "").trim().replace(/\s+/g, " ");
}

function parseTagInput(input) {
  return String(input || "")
    .split(/[\n,，;；、]+/)
    .map(normalizeTagTerm)
    .filter(Boolean);
}

function normalizeCustomTagGroups(value) {
  let rawValue = value;
  if (typeof rawValue === "string") {
    try {
      rawValue = JSON.parse(rawValue);
    } catch (err) {
      return [];
    }
  }

  if (!Array.isArray(rawValue)) return [];

  return rawValue
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const name = normalizeTagTerm(item.name);
      if (!name) return null;

      const seen = {};
      const terms = Array.isArray(item.terms)
        ? item.terms
            .map(normalizeTagTerm)
            .filter((term) => {
              const key = term.toLowerCase();
              if (!term || seen[key]) return false;
              seen[key] = true;
              return true;
            })
            .slice(0, 80)
        : [];
      const now = Date.now();

      return {
        id: typeof item.id === "string" && item.id.trim()
          ? item.id
          : `tag_group_${now}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        enabled: item.enabled !== false,
        terms,
        createdAt: Number(item.createdAt) || now,
        updatedAt: Number(item.updatedAt) || now
      };
    })
    .filter(Boolean)
    .slice(0, 30);
}

function flattenCustomTagGroups(groups) {
  const seen = {};
  const terms = [];
  (groups || []).forEach((group) => {
    (group.terms || []).forEach((term) => {
      const normalized = normalizeTagTerm(term);
      const key = normalized.toLowerCase();
      if (!normalized || seen[key]) return;
      seen[key] = true;
      terms.push(normalized);
    });
  });
  return terms.slice(0, 200);
}

function flattenEnabledCustomTagGroups(groups) {
  return flattenCustomTagGroups((groups || []).filter((group) => group.enabled !== false));
}

async function loadCustomTagLibrary() {
  const settings = await request({ url: "/api/db/settings" });
  return {
    enabled: settings[CUSTOM_TAG_LIBRARY_ENABLED_SETTINGS_KEY] !== "false",
    groups: normalizeCustomTagGroups(settings[CUSTOM_TAG_LIBRARY_SETTINGS_KEY])
  };
}

async function saveCustomTagLibrary({ enabled, groups }) {
  await request({
    url: "/api/db/settings",
    method: "POST",
    data: {
      [CUSTOM_TAG_LIBRARY_ENABLED_SETTINGS_KEY]: String(Boolean(enabled)),
      [CUSTOM_TAG_LIBRARY_SETTINGS_KEY]: JSON.stringify(normalizeCustomTagGroups(groups))
    }
  });
}

async function loadEnabledCustomTagHints() {
  try {
    const library = await loadCustomTagLibrary();
    if (!library.enabled) return [];
    return flattenEnabledCustomTagGroups(library.groups);
  } catch (err) {
    return [];
  }
}

module.exports = {
  CUSTOM_TAG_LIBRARY_SETTINGS_KEY,
  CUSTOM_TAG_LIBRARY_ENABLED_SETTINGS_KEY,
  createCustomTagGroup,
  normalizeTagTerm,
  parseTagInput,
  normalizeCustomTagGroups,
  flattenCustomTagGroups,
  flattenEnabledCustomTagGroups,
  loadCustomTagLibrary,
  saveCustomTagLibrary,
  loadEnabledCustomTagHints
};
