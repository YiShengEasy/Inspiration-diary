import { GoogleGenAI, Type } from "@google/genai";
import { Router, type Request, type RequestHandler } from "express";

import type { ImageUploadInput } from "../storage/photoprismStorage.ts";
import {
  buildBookHintPrompt,
  buildCustomTagHintPrompt,
  cleanJsonText,
  getCompletionsUrl,
  limitTermsResponse,
  normalizeBookHints,
  normalizeCustomTagHints,
  type AiProviderDefaults,
} from "./shared.ts";

interface ImageAnalysisRouterDependencies {
  uploadMiddleware: RequestHandler;
  normalizeImageUpload: (req: Request) => ImageUploadInput;
  defaults: AiProviderDefaults;
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

type JsonPayload = Record<string, unknown>;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function toRawBase64(image: ImageUploadInput): { rawBase64: string; actualMimeType: string } {
  let rawBase64 = image.dataUrl;
  let actualMimeType = image.mimeType;

  if (rawBase64.includes(";base64,")) {
    const parts = rawBase64.split(";base64,");
    rawBase64 = parts[1] || "";
    const match = parts[0]?.match(/data:(.*);base64/);
    if (match) {
      actualMimeType = match[1];
    }
  }

  return { rawBase64, actualMimeType };
}

function buildAnthropicUrl(baseUrl: string): string {
  let anthropicUrl = baseUrl;
  if (!anthropicUrl.endsWith("/messages") && !anthropicUrl.endsWith("/messages/")) {
    anthropicUrl = anthropicUrl.endsWith("/")
      ? anthropicUrl + "v1/messages"
      : anthropicUrl + "/v1/messages";
  }
  return anthropicUrl;
}

function buildImageAnalysisPrompt(bookHintPrompt: string, customTagHintPrompt: string): string {
  return "You are a creative inspiration research assistant. Analyze this uploaded screenshot or design reference image. " +
    "Extract evocative artistic inspirations, creative concepts, design styles, mood terms, color palettes, and visual keywords (e.g., '复古工业风', '赛博朋克色调', '温柔莫兰迪色', '温暖松弛感', 'Wabi-Sabi 侘寂', 'Mid-century Modern'). " +
    bookHintPrompt +
    customTagHintPrompt +
    "Return exactly 5 highly relevant and imaginative keywords in Chinese (or standard English descriptors) as a JSON list in the key 'terms' to capture the visual inspiration.";
}

function buildThirdPartyPayload(params: {
  completionsUrl: string;
  selectedModel: string;
  actualMimeType: string;
  rawBase64: string;
  prompt: string;
}): JsonPayload {
  const { completionsUrl, selectedModel, actualMimeType, rawBase64, prompt } = params;
  const jsonOnlyInstruction = " Respond ONLY with a raw JSON object of the format: {\"terms\": [\"term1\", \"term2\", ...]} without any markdown code backticks or other text.";

  if (completionsUrl.includes("/responses")) {
    return {
      model: selectedModel,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_image",
              image_url: `data:${actualMimeType};base64,${rawBase64}`,
            },
            {
              type: "input_text",
              text: prompt + jsonOnlyInstruction,
            },
          ],
        },
      ],
    };
  }

  return {
    model: selectedModel,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt + jsonOnlyInstruction,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${actualMimeType};base64,${rawBase64}`,
            },
          },
        ],
      },
    ],
  };
}

export function createImageAnalysisRouter(dependencies: ImageAnalysisRouterDependencies): Router {
  const { uploadMiddleware, normalizeImageUpload, defaults } = dependencies;
  const router = Router();

  router.post("/analyze-image", uploadMiddleware, async (req, res) => {
    try {
      const provider = (req.headers["x-provider"] as string | undefined) || "gemini";
      const customApiKey = req.headers["x-api-key"] as string | undefined;
      const customModelName = req.headers["x-model-name"] as string | undefined;
      const customGeminiBaseUrl = req.headers["x-gemini-base-url"] as string | undefined;
      const thinkingEnabled = req.headers["x-thinking-enabled"] === "true";
      const bookHintPrompt = buildBookHintPrompt(normalizeBookHints(req.body?.bookHints));
      const customTagHintPrompt = buildCustomTagHintPrompt(normalizeCustomTagHints(req.body?.customTagHints));

      console.log("=== API LOG: Analyze Image Request ===");
      console.log("provider:", provider);
      console.log("has customApiKey:", !!customApiKey, customApiKey ? `(length: ${customApiKey.length})` : "(empty)");
      console.log("customModelName:", customModelName);
      console.log("customGeminiBaseUrl:", customGeminiBaseUrl);
      console.log("=====================================");

      const { rawBase64, actualMimeType } = toRawBase64(normalizeImageUpload(req));

      if (provider === "anthropic") {
        const anthropicApiKey = customApiKey || process.env.ANTHROPIC_AUTH_TOKEN;
        if (!anthropicApiKey) {
          return res.status(400).json({ error: "Anthropic API Key is not configured. Please supply it in Settings." });
        }

        const customBaseUrl = (req.headers["x-anthropic-base-url"] as string | undefined) || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
        const anthropicUrl = buildAnthropicUrl(customBaseUrl);
        const selectedModel = customModelName || "claude-3-5-sonnet-20241022";

        console.log(`Routing image analysis to Anthropic endpoint: ${anthropicUrl} using model: ${selectedModel}`);

        const anthropicResponse = await fetch(anthropicUrl, {
          method: "POST",
          headers: {
            "x-api-key": anthropicApiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: selectedModel,
            max_tokens: 1024,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: actualMimeType,
                      data: rawBase64,
                    },
                  },
                  {
                    type: "text",
                    text: "You are a creative inspiration research assistant. Analyze this uploaded image to extract evocative artistic inspirations, creative concepts, design styles, mood terms, color palettes, and visual keywords (e.g. '复古工业风', '赛博朋克色调', '温柔莫兰迪色', '温暖松弛感', 'Wabi-Sabi 侘寂', 'Mid-century Modern', etc.). " +
                      bookHintPrompt +
                      customTagHintPrompt +
                      "Provide exactly 5 highly relevant, inspirational, and creative keywords in Chinese (or standard English hybrid terms if highly descriptive) to help the user catalog their visual inspiration. " +
                      "Reply ONLY with a raw JSON object of the format: {\"terms\": [\"term1\", \"term2\", ...]} without any markdown code backticks or other text.",
                  },
                ],
              },
            ],
          }),
        });

        if (!anthropicResponse.ok) {
          const errText = await anthropicResponse.text();
          console.error("Anthropic service error response:", errText);
          return res.status(anthropicResponse.status).json({ error: `Anthropic API: ${errText}` });
        }

        const responseDoc = await anthropicResponse.json() as AnthropicResponseDoc;
        const rawText = responseDoc.content?.[0]?.text || "{}";
        const cleanedText = cleanJsonText(rawText);
        const parsedData = JSON.parse(cleanedText || '{"terms": []}') as unknown;
        return res.json(limitTermsResponse(parsedData));
      }

      const thirdPartyBaseUrl = (customGeminiBaseUrl || defaults.thirdPartyBaseUrl).trim();
      const isThirdParty = thirdPartyBaseUrl &&
        (!thirdPartyBaseUrl.toLowerCase().includes("googleapis.com") && !thirdPartyBaseUrl.toLowerCase().includes("google.com"));

      if (isThirdParty) {
        const activeApiKey = (customApiKey || defaults.thirdPartyApiKey || defaults.geminiApiKey || "").trim();
        if (!activeApiKey) {
          return res.status(400).json({ error: "Third-party API key is not defined. Please configure your API key in Settings." });
        }

        const completionsUrl = getCompletionsUrl(thirdPartyBaseUrl);
        const selectedModel = (customModelName || defaults.thirdPartyModel).trim();

        console.log(`Routing image analysis via OpenAI/Third-party protocol to: ${completionsUrl} using model: ${selectedModel}`);

        const prompt = buildImageAnalysisPrompt(bookHintPrompt, customTagHintPrompt);
        const payload = buildThirdPartyPayload({
          completionsUrl,
          selectedModel,
          actualMimeType,
          rawBase64,
          prompt,
        });

        const isVolcengineResponsesFormat = completionsUrl.includes("/responses");
        const isArkOrDoubaoOrDeepseek = /doubao|ark|volces|volcengine|deepseek/i.test(selectedModel) || /volces|ark|volcengine|deepseek/i.test(completionsUrl);
        const effectiveThinkingEnabled = req.headers["x-thinking-enabled"] === undefined ? defaults.thirdPartyThinking : thinkingEnabled;
        if (isArkOrDoubaoOrDeepseek && !isVolcengineResponsesFormat) {
          payload.thinking = {
            type: effectiveThinkingEnabled ? "enabled" : "disabled",
          };
        }

        const thirdPartyResponse = await fetch(completionsUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${activeApiKey}`,
          },
          body: JSON.stringify(payload),
        });

        if (!thirdPartyResponse.ok) {
          const errText = await thirdPartyResponse.text();
          console.error("Third-party completions service error response:", errText);
          return res.status(thirdPartyResponse.status).json({ error: `Third-party API Error: ${errText}` });
        }

        const responseDoc = await thirdPartyResponse.json() as ThirdPartyResponseDoc;
        const rawText = responseDoc.choices?.[0]?.message?.content || responseDoc.choices?.[0]?.text || responseDoc.output || "{}";
        const cleanedText = cleanJsonText(rawText);
        const parsedData = JSON.parse(cleanedText || '{"terms": []}') as unknown;
        return res.json(limitTermsResponse(parsedData));
      }

      const activeApiKey = customApiKey || defaults.geminiApiKey;
      if (!activeApiKey) {
        return res.status(500).json({ error: "Gemini API key is not defined. Please configure your API key in Settings." });
      }

      const activeAi = new GoogleGenAI({
        apiKey: activeApiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build-custom",
          },
        },
        ...(customGeminiBaseUrl ? { baseURL: customGeminiBaseUrl } : {}),
      });

      const selectedModel = customModelName || "gemini-3.5-flash";
      const response = await activeAi.models.generateContent({
        model: selectedModel,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: actualMimeType,
                data: rawBase64,
              },
            },
            {
              text: buildImageAnalysisPrompt(bookHintPrompt, customTagHintPrompt),
            },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              terms: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Exactly 5 professional design terminology keywords inspired by the image.",
              },
            },
            required: ["terms"],
          },
        },
      });

      const cleanedText = cleanJsonText(response.text || '{"terms": []}');
      const parsedData = JSON.parse(cleanedText) as unknown;
      return res.json(limitTermsResponse(parsedData));
    } catch (error: unknown) {
      console.error("Error analyzing image:", error);
      return res.status(500).json({ error: errorMessage(error, "An error occurred while analyzing the image.") });
    }
  });

  return router;
}
