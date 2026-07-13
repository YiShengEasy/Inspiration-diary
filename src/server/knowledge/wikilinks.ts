export interface ParsedWikilink {
  target: string;
  alias?: string;
}

const WIKILINK_PATTERN = /\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+?))?\]\]/gu;

/** Parses Wikilinks once per target, preserving the first spelling and alias. */
export function parseWikilinks(markdown: string): ParsedWikilink[] {
  const links: ParsedWikilink[] = [];
  const seen = new Set<string>();

  for (const match of markdown.matchAll(WIKILINK_PATTERN)) {
    const target = match[1]?.trim();
    const alias = match[2]?.trim();
    if (!target) continue;
    const dedupeKey = target.normalize("NFKC").toLocaleLowerCase("en-US");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    links.push(alias ? { target, alias } : { target });
  }
  return links;
}

export function normalizeKnowledgeTitle(title: string): string {
  return title.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}
