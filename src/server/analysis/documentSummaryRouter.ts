import { GoogleGenAI, Type } from "@google/genai";
import { Router } from "express";

import {
  cleanJsonText,
  getCompletionsUrl,
  normalizeBookHints,
  normalizeCustomTagHints,
  type AiProviderDefaults,
} from "./shared.ts";

interface DocumentSummaryRouterDependencies {
  defaults: AiProviderDefaults;
}

interface SummaryResult {
  summary: string;
  terms: string[];
  insightNote: string;
}

interface AnthropicResponseDoc {
  content?: Array<{ text?: string }>;
}

interface ThirdPartyResponseDoc {
  choices?: Array<{
    message?: { content?: string };
    text?: string;
  }>;
}

type SummaryPayload = Record<string, unknown>;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function buildFallback(markdown: string): SummaryResult {
  const fallbackSummary = markdown
    .split(/\r?\n/)
    .map((line: string) => line.replace(/^#{1,6}\s*/, "").replace(/^[-*+]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 220);

  const fallbackInsightSource = fallbackSummary || markdown
    .replace(/[#>*_`~\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

  return {
    summary: fallbackSummary || "已保存 Markdown 手稿，点击卡片查看完整内容。",
    terms: ["文档手稿", "资料整理"],
    insightNote: fallbackInsightSource
      ? `初步分析：这份文档主要围绕“${fallbackInsightSource}”展开，可结合实际目标进一步提炼重点和行动项。`
      : "初步分析：文档已保存，可结合实际目标进一步提炼重点和行动项。",
  };
}

function buildAnthropicUrl(baseUrl: string): string {
  let anthropicUrl = baseUrl;
  if (!anthropicUrl.endsWith("/messages") && !anthropicUrl.endsWith("/messages/")) {
    anthropicUrl = anthropicUrl.endsWith("/") ? anthropicUrl + "v1/messages" : anthropicUrl + "/v1/messages";
  }
  return anthropicUrl;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function normalizeResult(rawText: string, fallback: SummaryResult): SummaryResult {
  const parsed = readRecord(JSON.parse(cleanJsonText(rawText) || "{}") as unknown);
  const summary = typeof parsed.summary === "string" && parsed.summary.trim()
    ? parsed.summary.trim()
    : fallback.summary;
  const terms = Array.isArray(parsed.terms)
    ? parsed.terms
        .filter((term: unknown): term is string => typeof term === "string" && term.trim().length > 0)
        .map((term: string) => term.trim())
        .slice(0, 5)
    : fallback.terms;
  const insightNote = typeof parsed.insightNote === "string" && parsed.insightNote.trim()
    ? parsed.insightNote.trim()
    : fallback.insightNote;

  return {
    summary,
    terms: terms.length > 0 ? terms : fallback.terms,
    insightNote,
  };
}

function buildPrompt(markdown: string, bookHints: string[], customTagHints: string[]): string {
  return [
    "你是一个文档整理与知识标签助手，不要按图片视觉风格分析。",
    "请阅读下面的文档内容，提炼文档的核心主题、结论、行动方向、项目线索和知识领域。",
    "输出必须是严格 JSON：{\"summary\":\"中文摘要，2到3句话\",\"terms\":[\"标签1\",\"标签2\",...],\"insightNote\":\"核心观点、启发和行动建议\"}。",
    "summary 要客观概括内容；insightNote 要进一步提炼核心观点、可借鉴启发和可执行建议，不要简单重复摘要，也不要虚构文档没有的信息。",
    "terms 必须正好 5 个，优先使用中文短标签；标签应描述文档内容，不要使用“光影、色彩、构图、视觉风格”等图片分析词，除非文档本身明确讨论这些主题。",
    customTagHints.length > 0
      ? `用户维护了自定义标签库：${customTagHints.join("；")}。如果内容确实相关，请优先使用这些标签库中的原词或非常接近的变体。不要强行使用无关标签。`
      : "",
    bookHints.length > 0
      ? `如果内容确实相关，请优先参考这些灵感册名称/描述中的名词来生成标签：${bookHints.join("；")}。不要强行匹配无关灵感册。`
      : "",
    "",
    "文档内容：",
    markdown.slice(0, 12000),
  ].join("\n");
}

export function createDocumentSummaryRouter(dependencies: DocumentSummaryRouterDependencies): Router {
  const { defaults } = dependencies;
  const router = Router();

  router.post("/summarize-md", async (req, res) => {
    try {
      const { markdown } = req.body;
      if (typeof markdown !== "string" || !markdown.trim()) {
        return res.status(400).json({ error: "Missing markdown content." });
      }

      const fallback = buildFallback(markdown);
      const provider = (req.headers["x-provider"] as string | undefined) || "gemini";
      const customApiKey = req.headers["x-api-key"] as string | undefined;
      const customModelName = req.headers["x-model-name"] as string | undefined;
      const customGeminiBaseUrl = req.headers["x-gemini-base-url"] as string | undefined;
      const thinkingEnabled = req.headers["x-thinking-enabled"] === "true";
      const bookHints = normalizeBookHints(req.body?.bookHints);
      const customTagHints = normalizeCustomTagHints(req.body?.customTagHints);
      const prompt = buildPrompt(markdown, bookHints, customTagHints);

      try {
        if (provider === "anthropic") {
          const anthropicApiKey = customApiKey || process.env.ANTHROPIC_AUTH_TOKEN;
          if (!anthropicApiKey) return res.json(fallback);

          const customBaseUrl = (req.headers["x-anthropic-base-url"] as string | undefined) || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
          const anthropicUrl = buildAnthropicUrl(customBaseUrl);

          const anthropicResponse = await fetch(anthropicUrl, {
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

          if (!anthropicResponse.ok) return res.json(fallback);
          const doc = await anthropicResponse.json() as AnthropicResponseDoc;
          return res.json(normalizeResult(doc.content?.[0]?.text || "{}", fallback));
        }

        const thirdPartyBaseUrl = (customGeminiBaseUrl || defaults.thirdPartyBaseUrl).trim();
        const isThirdParty = thirdPartyBaseUrl &&
          (!thirdPartyBaseUrl.toLowerCase().includes("googleapis.com") && !thirdPartyBaseUrl.toLowerCase().includes("google.com"));

        if (isThirdParty) {
          const activeApiKey = (customApiKey || defaults.thirdPartyApiKey || defaults.geminiApiKey || "").trim();
          if (!activeApiKey) return res.json(fallback);

          const completionsUrl = getCompletionsUrl(thirdPartyBaseUrl);
          const selectedModel = (customModelName || defaults.thirdPartyModel).trim();
          const payload: SummaryPayload = {
            model: selectedModel,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 1200,
          };
          const isArkOrDoubaoOrDeepseek = /doubao|ark|volces|volcengine|deepseek/i.test(selectedModel) || /volces|ark|volcengine|deepseek/i.test(completionsUrl);
          const effectiveThinkingEnabled = req.headers["x-thinking-enabled"] === undefined ? defaults.thirdPartyThinking : thinkingEnabled;
          if (isArkOrDoubaoOrDeepseek) {
            payload.thinking = { type: effectiveThinkingEnabled ? "enabled" : "disabled" };
          }

          const thirdPartyResponse = await fetch(completionsUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${activeApiKey}`,
            },
            body: JSON.stringify(payload),
          });

          if (!thirdPartyResponse.ok) return res.json(fallback);
          const doc = await thirdPartyResponse.json() as ThirdPartyResponseDoc;
          return res.json(normalizeResult(doc.choices?.[0]?.message?.content || doc.choices?.[0]?.text || "{}", fallback));
        }

        const activeApiKey = customApiKey || defaults.geminiApiKey;
        if (!activeApiKey) return res.json(fallback);

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
                summary: { type: Type.STRING },
                terms: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                insightNote: { type: Type.STRING },
              },
              required: ["summary", "terms", "insightNote"],
            },
          },
        });

        return res.json(normalizeResult(response.text || "{}", fallback));
      } catch (aiError) {
        console.warn("Markdown AI summary skipped:", aiError);
        return res.json(fallback);
      }
    } catch (error: unknown) {
      console.error("Markdown summary error:", error);
      return res.status(500).json({ error: errorMessage(error, "Markdown summary failed.") });
    }
  });

  return router;
}
