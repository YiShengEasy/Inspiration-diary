import type {
  KnowledgeEntityType,
  KnowledgeProperties,
} from "./types.ts";

export interface KnowledgeProjection {
  entityType: KnowledgeEntityType;
  entityId: string;
  title: string;
  tags: string[];
  searchText: string;
  properties: KnowledgeProperties;
  markdown?: string;
}

export interface CardProjectionRow {
  id: unknown;
  type?: unknown;
  week_id?: unknown;
  day_index?: unknown;
  created_at?: unknown;
  md_name?: unknown;
  md_content?: unknown;
  md_summary?: unknown;
  insight_note?: unknown;
  terms?: unknown;
  original_filenames?: unknown;
  attachment_original_names?: unknown;
  video_original_names?: unknown;
  image_original_names?: unknown;
  document_original_names?: unknown;
  combo_image_original_names?: unknown;
  combo_generation_original_names?: unknown;
  combo_text?: unknown;
  combo_search_text?: unknown;
  combo_roles?: unknown;
  combo_prompt_notes?: unknown;
}

export interface BookProjectionRow {
  id: unknown;
  title: unknown;
  description?: unknown;
  cover_card_id?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  card_count?: unknown;
  tags?: unknown;
  member_titles?: unknown;
  member_tags?: unknown;
  member_types?: unknown;
}

export interface WeeklyNoteProjectionRow {
  week_id: unknown;
  note?: unknown;
  height?: unknown;
  updated_at?: unknown;
  tags?: unknown;
}

const CARD_TYPE_TITLES: Record<string, string> = {
  image: "图片灵感",
  md: "Markdown 笔记",
  video: "视频灵感",
  combo: "组合灵感",
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requiredText(value: unknown, field: string): string {
  const result = text(value);
  if (!result) throw new TypeError(`${field} is required for knowledge projection`);
  return result;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * PostgreSQL aggregate values may arrive as arrays, JSON objects, or scalar
 * strings. Only known textual metadata is extracted; buffers and binary media
 * values are deliberately ignored.
 */
function textList(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }
  if (Array.isArray(value)) return value.flatMap(textList);
  if (!value || typeof value !== "object" || value instanceof Uint8Array) return [];

  const row = value as Record<string, unknown>;
  return [
    row.original_name,
    row.filename,
    row.name,
    row.title,
    row.prompt_note,
    row.role,
  ].flatMap(textList);
}

function uniqueText(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.flatMap(textList)) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function addTextProperty(
  properties: KnowledgeProperties,
  key: string,
  value: unknown,
): void {
  const normalized = text(value);
  if (normalized) properties[key] = normalized;
}

function addNumberProperty(
  properties: KnowledgeProperties,
  key: string,
  value: unknown,
): void {
  const normalized = finiteNumber(value);
  if (normalized !== undefined) properties[key] = normalized;
}

export function projectCardRow(row: CardProjectionRow): KnowledgeProjection {
  const entityId = requiredText(row.id, "card.id");
  const type = text(row.type) || "image";
  const terms = uniqueText([row.terms]);
  const originalFilenames = uniqueText([
    row.original_filenames,
    row.attachment_original_names,
    row.video_original_names,
    row.image_original_names,
    row.document_original_names,
    row.combo_image_original_names,
    row.combo_generation_original_names,
  ]);
  const comboText = uniqueText([
    row.combo_text,
    row.combo_search_text,
    row.combo_roles,
    row.combo_prompt_notes,
  ]);
  const markdown = text(row.md_content);
  const title = text(row.md_name)
    || terms[0]
    || originalFilenames[0]
    || CARD_TYPE_TITLES[type]
    || "灵感卡片";

  const properties: KnowledgeProperties = { contentType: type };
  addTextProperty(properties, "weekId", row.week_id);
  addNumberProperty(properties, "dayIndex", row.day_index);
  addNumberProperty(properties, "createdAt", row.created_at);

  return {
    entityType: "card",
    entityId,
    title,
    tags: terms,
    searchText: uniqueText([
      type,
      row.md_name,
      row.md_content,
      row.md_summary,
      row.insight_note,
      terms,
      originalFilenames,
      comboText,
    ]).join(" "),
    properties,
    ...(markdown ? { markdown } : {}),
  };
}

export function projectBookRow(row: BookProjectionRow): KnowledgeProjection {
  const entityId = requiredText(row.id, "book.id");
  const title = requiredText(row.title, "book.title");
  const tags = uniqueText([row.tags, row.member_tags]);
  const properties: KnowledgeProperties = {};
  addTextProperty(properties, "coverCardId", row.cover_card_id);
  addNumberProperty(properties, "cardCount", row.card_count);
  addNumberProperty(properties, "createdAt", row.created_at);
  addNumberProperty(properties, "updatedAt", row.updated_at);

  return {
    entityType: "book",
    entityId,
    title,
    tags,
    searchText: uniqueText([
      title,
      row.description,
      row.member_titles,
      row.member_tags,
      row.member_types,
    ]).join(" "),
    properties,
  };
}

export function projectWeeklyNoteRow(row: WeeklyNoteProjectionRow): KnowledgeProjection {
  const entityId = requiredText(row.week_id, "weekly_note.week_id");
  const markdown = text(row.note);
  const tags = uniqueText([row.tags]);
  const properties: KnowledgeProperties = { weekId: entityId };
  addNumberProperty(properties, "height", row.height);
  addNumberProperty(properties, "updatedAt", row.updated_at);

  return {
    entityType: "weekly_note",
    entityId,
    title: `${entityId} 周记`,
    tags,
    searchText: uniqueText([entityId, markdown, tags]).join(" "),
    properties,
    ...(markdown ? { markdown } : {}),
  };
}
