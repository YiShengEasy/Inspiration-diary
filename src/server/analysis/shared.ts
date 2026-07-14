export interface AiProviderDefaults {
  geminiApiKey?: string;
  thirdPartyBaseUrl: string;
  thirdPartyApiKey: string;
  thirdPartyModel: string;
  thirdPartyThinking: boolean;
}

export function getCompletionsUrl(baseUrl: string): string {
  let url = baseUrl.trim();
  if (!url.endsWith("/chat/completions") && !url.endsWith("/chat/completions/")) {
    url = url.endsWith("/") ? `${url}chat/completions` : `${url}/chat/completions`;
  }
  return url;
}

export function cleanJsonText(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.substring(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.substring(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.substring(0, cleaned.length - 3);
  return cleaned.trim();
}

export function limitTermsResponse(parsedData: unknown): { terms: string[] } {
  const record = parsedData && typeof parsedData === "object" ? parsedData as { terms?: unknown } : {};
  const terms = Array.isArray(record.terms)
    ? record.terms
      .filter((term: unknown): term is string => typeof term === "string")
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 5)
    : [];
  return { terms };
}

export function normalizeBookHints(value: unknown): string[] {
  let rawValue = value;
  if (typeof value === "string") {
    try {
      rawValue = JSON.parse(value);
    } catch {
      rawValue = value.split(/\r?\n|；|;/);
    }
  }
  if (!Array.isArray(rawValue)) return [];
  return rawValue
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const record = item as { title?: unknown; description?: unknown };
        return [record.title, record.description]
          .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
          .join("：");
      }
      return "";
    })
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, 20);
}

export function buildBookHintPrompt(hints: string[]): string {
  if (hints.length === 0) return "";
  return ` When choosing terms, compare the content with these inspiration book names/descriptions and prefer their matching nouns when genuinely relevant: ${hints.join("；")}. Do not force a match if the content is unrelated.`;
}

export function normalizeCustomTagHints(value: unknown): string[] {
  let rawValue = value;
  if (typeof value === "string") {
    try {
      rawValue = JSON.parse(value);
    } catch {
      rawValue = value.split(/\r?\n|,|，|；|;|、/);
    }
  }
  if (!Array.isArray(rawValue)) return [];
  const seen = new Set<string>();
  return rawValue
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 200);
}

export function buildCustomTagHintPrompt(hints: string[]): string {
  if (hints.length === 0) return "";
  return ` The user maintains this custom tag library: ${hints.join("；")}. If the content is genuinely related, prefer exact terms from this library or generate very close variants. Do not force unrelated custom tags.`;
}
