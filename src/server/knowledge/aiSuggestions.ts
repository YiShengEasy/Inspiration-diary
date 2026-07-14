import { GoogleGenAI, Type } from "@google/genai";
import type { IncomingHttpHeaders } from "node:http";

import {
  cleanJsonText,
  getCompletionsUrl,
  type AiProviderDefaults,
} from "../analysis/shared.ts";
import type { KnowledgeNode } from "./repository.ts";
import type { KnowledgeRelationType } from "./types.ts";
import type { KnowledgeAiSuggestionTarget } from "./service.ts";

const RELATION_TYPES: KnowledgeRelationType[] = [
  "mentions",
  "related",
  "references",
  "derived_from",
  "belongs_to",
  "contrasts",
  "supports",
];

export class KnowledgeAiSuggestionError extends Error {
  readonly httpStatus: number;

  constructor(message: string, httpStatus = 400) {
    super(message);
    this.name = "KnowledgeAiSuggestionError";
    this.httpStatus = httpStatus;
  }
}

export interface KnowledgeAiSuggestion {
  targetNodeId: string;
  relationType: KnowledgeRelationType;
  confidence: number;
  reason: string;
}

export interface KnowledgeAiSuggestionInput {
  source: KnowledgeNode;
  sourceMarkdown: string;
  targets: KnowledgeAiSuggestionTarget[];
  headers: IncomingHttpHeaders;
  defaults: AiProviderDefaults;
  limit: number;
}

interface AnthropicResponseDoc {
  content?: Array<{ text?: string }>;
}

interface ThirdPartyResponseDoc {
  choices?: Array<{
    message?: { content?: string };
    text?: string;
  }>;
  output?: string;
}

function headerString(headers: IncomingHttpHeaders, key: string): string | undefined {
  const value = headers[key];
  return Array.isArray(value) ? value[0] : value;
}

function buildAnthropicUrl(baseUrl: string): string {
  let anthropicUrl = baseUrl;
  if (!anthropicUrl.endsWith("/messages") && !anthropicUrl.endsWith("/messages/")) {
    anthropicUrl = anthropicUrl.endsWith("/") ? `${anthropicUrl}v1/messages` : `${anthropicUrl}/v1/messages`;
  }
  return anthropicUrl;
}

function compactNode(node: KnowledgeNode) {
  return {
    id: node.id,
    title: node.title,
    entityType: node.entityType,
    tags: node.tags.slice(0, 12),
    snippet: node.searchText.replace(/\s+/gu, " ").trim().slice(0, 500),
  };
}

function compactTarget(target: KnowledgeAiSuggestionTarget) {
  return {
    ...compactNode(target.node),
    localScore: Number(target.score.toFixed(3)),
    evidence: {
      source: target.evidence.source,
      sharedTags: target.evidence.sharedTags.slice(0, 8),
      sameBook: target.evidence.sameBook,
      sharedPropertyRatio: Number(target.evidence.sharedPropertyRatio.toFixed(3)),
      creationProximity: Number(target.evidence.creationProximity.toFixed(3)),
      feedbackBoost: Number((target.evidence.feedbackBoost ?? 0).toFixed(3)),
      feedbackPenalty: Number((target.evidence.feedbackPenalty ?? 0).toFixed(3)),
    },
  };
}

function buildPrompt(input: KnowledgeAiSuggestionInput): string {
  return [
    "你是一个知识库关系建议助手。只能从候选节点列表中选择 targetNodeId，不要创造新节点。",
    "候选节点已经由本地相关性和用户反馈预筛。请优先考虑 localScore 高、evidence 充分的候选；exploration 只在语义明显相关时建议。",
    `relationType 只能从这些值中选择：${RELATION_TYPES.join(", ")}。`,
    "输出必须是严格 JSON：{\"suggestions\":[{\"targetNodeId\":\"...\",\"relationType\":\"related\",\"confidence\":0.82,\"reason\":\"中文理由，40字以内\"}]}。",
    `最多返回 ${input.limit} 条；没有高质量建议时返回空数组。不要写入数据库，不要声称已经建立关系。`,
    "",
    "当前节点：",
    JSON.stringify({
      ...compactNode(input.source),
      markdown: input.sourceMarkdown.replace(/\s+/gu, " ").trim().slice(0, 1200),
    }),
    "",
    "候选节点：",
    JSON.stringify(input.targets.map(compactTarget)),
  ].join("\n");
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeSuggestions(rawText: string, allowedTargetIds: Set<string>, limit: number): KnowledgeAiSuggestion[] {
  const parsed = readRecord(JSON.parse(cleanJsonText(rawText) || "{}") as unknown);
  const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  const seen = new Set<string>();
  return suggestions.flatMap((item): KnowledgeAiSuggestion[] => {
    const record = readRecord(item);
    const targetNodeId = typeof record.targetNodeId === "string" ? record.targetNodeId.trim() : "";
    const relationType = typeof record.relationType === "string" && RELATION_TYPES.includes(record.relationType as KnowledgeRelationType)
      ? record.relationType as KnowledgeRelationType
      : null;
    if (!targetNodeId || !relationType || !allowedTargetIds.has(targetNodeId) || seen.has(targetNodeId)) return [];
    seen.add(targetNodeId);
    const rawConfidence = Number(record.confidence);
    const confidence = Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(1, rawConfidence))
      : 0.5;
    const reason = typeof record.reason === "string" && record.reason.trim()
      ? record.reason.trim().slice(0, 160)
      : "AI 建议人工确认该关系。";
    return [{ targetNodeId, relationType, confidence, reason }];
  }).slice(0, limit);
}

export async function generateKnowledgeAiSuggestions(input: KnowledgeAiSuggestionInput): Promise<KnowledgeAiSuggestion[]> {
  const provider = headerString(input.headers, "x-provider") || "gemini";
  const customApiKey = headerString(input.headers, "x-api-key");
  const customModelName = headerString(input.headers, "x-model-name");
  const customGeminiBaseUrl = headerString(input.headers, "x-gemini-base-url");
  const thinkingEnabled = headerString(input.headers, "x-thinking-enabled") === "true";
  const prompt = buildPrompt(input);
  const allowedTargetIds = new Set(input.targets.map((target) => target.node.id));

  if (input.targets.length === 0) return [];

  if (provider === "anthropic") {
    const anthropicApiKey = customApiKey || process.env.ANTHROPIC_AUTH_TOKEN;
    if (!anthropicApiKey) throw new KnowledgeAiSuggestionError("Anthropic API Key is not configured.");
    const customBaseUrl = headerString(input.headers, "x-anthropic-base-url") || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
    const response = await fetch(buildAnthropicUrl(customBaseUrl), {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: customModelName || "claude-3-5-sonnet-20241022",
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) throw new KnowledgeAiSuggestionError(`Anthropic API: ${await response.text()}`, response.status);
    const doc = await response.json() as AnthropicResponseDoc;
    return normalizeSuggestions(doc.content?.[0]?.text || "{}", allowedTargetIds, input.limit);
  }

  const thirdPartyBaseUrl = (customGeminiBaseUrl || input.defaults.thirdPartyBaseUrl).trim();
  const isThirdParty = thirdPartyBaseUrl &&
    (!thirdPartyBaseUrl.toLowerCase().includes("googleapis.com") && !thirdPartyBaseUrl.toLowerCase().includes("google.com"));

  if (isThirdParty) {
    const activeApiKey = (customApiKey || input.defaults.thirdPartyApiKey || input.defaults.geminiApiKey || "").trim();
    if (!activeApiKey) throw new KnowledgeAiSuggestionError("Third-party API key is not configured.");
    const completionsUrl = getCompletionsUrl(thirdPartyBaseUrl);
    const selectedModel = (customModelName || input.defaults.thirdPartyModel).trim();
    const payload: Record<string, unknown> = {
      model: selectedModel,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1200,
    };
    const isArkOrDoubaoOrDeepseek = /doubao|ark|volces|volcengine|deepseek/i.test(selectedModel) || /volces|ark|volcengine|deepseek/i.test(completionsUrl);
    const effectiveThinkingEnabled = input.headers["x-thinking-enabled"] === undefined ? input.defaults.thirdPartyThinking : thinkingEnabled;
    if (isArkOrDoubaoOrDeepseek) {
      payload.thinking = { type: effectiveThinkingEnabled ? "enabled" : "disabled" };
    }
    const response = await fetch(completionsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${activeApiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new KnowledgeAiSuggestionError(`Third-party API: ${await response.text()}`, response.status);
    const doc = await response.json() as ThirdPartyResponseDoc;
    return normalizeSuggestions(doc.choices?.[0]?.message?.content || doc.choices?.[0]?.text || doc.output || "{}", allowedTargetIds, input.limit);
  }

  const activeApiKey = customApiKey || input.defaults.geminiApiKey;
  if (!activeApiKey) throw new KnowledgeAiSuggestionError("Gemini API key is not configured.");
  const activeAi = new GoogleGenAI({
    apiKey: activeApiKey,
    ...(customGeminiBaseUrl ? { baseURL: customGeminiBaseUrl } : {}),
    httpOptions: { headers: { "User-Agent": "aistudio-build-custom" } },
  });
  const response = await activeAi.models.generateContent({
    model: customModelName || "gemini-3.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          suggestions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                targetNodeId: { type: Type.STRING },
                relationType: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
                reason: { type: Type.STRING },
              },
              required: ["targetNodeId", "relationType", "confidence", "reason"],
            },
          },
        },
        required: ["suggestions"],
      },
    },
  });
  return normalizeSuggestions(response.text || "{}", allowedTargetIds, input.limit);
}
