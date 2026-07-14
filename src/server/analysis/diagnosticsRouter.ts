import { GoogleGenAI } from "@google/genai";
import { Router } from "express";

import { getCompletionsUrl, type AiProviderDefaults } from "./shared.ts";

interface DiagnosticsRouterDependencies {
  defaults: AiProviderDefaults;
}

interface DiagnosticStatus {
  ok: boolean;
  error: string;
  response: string;
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

type DiagnosticPayload = Record<string, unknown>;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
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

function thirdPartyText(doc: ThirdPartyResponseDoc): string {
  return doc.choices?.[0]?.message?.content?.trim() ||
    doc.choices?.[0]?.text?.trim() ||
    doc.output?.trim() ||
    "OK";
}

function buildThirdPartyTextPayload(params: {
  isVolcengineResponsesFormat: boolean;
  selectedModel: string;
  testPrompt: string;
  isArkOrDoubaoOrDeepseek: boolean;
  effectiveThinkingEnabled: boolean;
}): DiagnosticPayload {
  const {
    isVolcengineResponsesFormat,
    selectedModel,
    testPrompt,
    isArkOrDoubaoOrDeepseek,
    effectiveThinkingEnabled,
  } = params;

  if (isVolcengineResponsesFormat) {
    return {
      model: selectedModel,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: testPrompt,
            },
          ],
        },
      ],
    };
  }

  const payload: DiagnosticPayload = {
    model: selectedModel,
    messages: [{ role: "user", content: testPrompt }],
    max_tokens: 50,
  };
  if (isArkOrDoubaoOrDeepseek) {
    payload.thinking = { type: effectiveThinkingEnabled ? "enabled" : "disabled" };
  }
  return payload;
}

function buildThirdPartyVisionPayload(params: {
  isVolcengineResponsesFormat: boolean;
  selectedModel: string;
  testPrompt: string;
  tinyImageBase64: string;
  isArkOrDoubaoOrDeepseek: boolean;
  effectiveThinkingEnabled: boolean;
}): DiagnosticPayload {
  const {
    isVolcengineResponsesFormat,
    selectedModel,
    testPrompt,
    tinyImageBase64,
    isArkOrDoubaoOrDeepseek,
    effectiveThinkingEnabled,
  } = params;

  if (isVolcengineResponsesFormat) {
    return {
      model: selectedModel,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_image",
              image_url: `data:image/png;base64,${tinyImageBase64}`,
            },
            {
              type: "input_text",
              text: testPrompt,
            },
          ],
        },
      ],
    };
  }

  const payload: DiagnosticPayload = {
    model: selectedModel,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: testPrompt,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${tinyImageBase64}`,
            },
          },
        ],
      },
    ],
    max_tokens: 50,
  };
  if (isArkOrDoubaoOrDeepseek) {
    payload.thinking = { type: effectiveThinkingEnabled ? "enabled" : "disabled" };
  }
  return payload;
}

export function createDiagnosticsRouter(dependencies: DiagnosticsRouterDependencies): Router {
  const { defaults } = dependencies;
  const router = Router();

  router.post("/test-model", async (req, res) => {
    try {
      const provider = (req.headers["x-provider"] as string | undefined) || "gemini";
      const customApiKey = req.headers["x-api-key"] as string | undefined;
      const customModelName = req.headers["x-model-name"] as string | undefined;
      const customGeminiBaseUrl = req.headers["x-gemini-base-url"] as string | undefined;
      const thinkingEnabled = req.headers["x-thinking-enabled"] === "true";

      const textStatus: DiagnosticStatus = { ok: false, error: "", response: "" };
      const visionStatus: DiagnosticStatus = { ok: false, error: "", response: "" };

      const testPrompt = "Reply with exactly 'OK'";
      const tinyImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAALElEQVR42mNk+M9QDwOMjIxtbW3E6sGlhoGBgY8bVz0yGBUYoIEBCgYGBgC3DwscLgbvggAAAABJRU5ErkJggg==";

      if (provider === "anthropic") {
        const anthropicApiKey = customApiKey || process.env.ANTHROPIC_AUTH_TOKEN;
        if (!anthropicApiKey) {
          return res.status(400).json({ error: "Anthropic API Key is not configured." });
        }

        const customBaseUrl = (req.headers["x-anthropic-base-url"] as string | undefined) || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
        const anthropicUrl = buildAnthropicUrl(customBaseUrl);
        const selectedModel = customModelName || "claude-3-5-sonnet-20241022";

        try {
          const textRes = await fetch(anthropicUrl, {
            method: "POST",
            headers: {
              "x-api-key": anthropicApiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: selectedModel,
              max_tokens: 50,
              messages: [{ role: "user", content: testPrompt }],
            }),
          });

          if (textRes.ok) {
            const doc = await textRes.json() as AnthropicResponseDoc;
            textStatus.ok = true;
            textStatus.response = doc.content?.[0]?.text?.trim() || "OK";
          } else {
            textStatus.error = await textRes.text();
          }
        } catch (err: unknown) {
          textStatus.error = errorMessage(err);
        }

        try {
          const visionRes = await fetch(anthropicUrl, {
            method: "POST",
            headers: {
              "x-api-key": anthropicApiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: selectedModel,
              max_tokens: 50,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: "image/png",
                        data: tinyImageBase64,
                      },
                    },
                    {
                      type: "text",
                      text: testPrompt,
                    },
                  ],
                },
              ],
            }),
          });

          if (visionRes.ok) {
            const doc = await visionRes.json() as AnthropicResponseDoc;
            visionStatus.ok = true;
            visionStatus.response = doc.content?.[0]?.text?.trim() || "OK";
          } else {
            visionStatus.error = await visionRes.text();
          }
        } catch (err: unknown) {
          visionStatus.error = errorMessage(err);
        }
      } else {
        const thirdPartyBaseUrl = (customGeminiBaseUrl || defaults.thirdPartyBaseUrl).trim();
        const activeApiKey = customApiKey || defaults.thirdPartyApiKey || defaults.geminiApiKey;
        const isThirdParty = thirdPartyBaseUrl &&
          (!thirdPartyBaseUrl.toLowerCase().includes("googleapis.com") && !thirdPartyBaseUrl.toLowerCase().includes("google.com"));

        if (isThirdParty) {
          if (!activeApiKey) {
            return res.status(400).json({ error: "Third-party API key is not configured." });
          }

          const completionsUrl = getCompletionsUrl(thirdPartyBaseUrl);
          const selectedModel = (customModelName || defaults.thirdPartyModel).trim();

          console.log(`Running diagnostic tests via OpenAI/Third-party directly to: ${completionsUrl} using model: ${selectedModel}`);

          const isArkOrDoubaoOrDeepseek = /doubao|ark|volces|volcengine|deepseek/i.test(selectedModel) || /volces|ark|volcengine|deepseek/i.test(completionsUrl);
          const isVolcengineResponsesFormat = completionsUrl.includes("/responses");
          const activeApiKeyTrimmed = activeApiKey.trim();
          const effectiveThinkingEnabled = req.headers["x-thinking-enabled"] === undefined ? defaults.thirdPartyThinking : thinkingEnabled;

          try {
            const textPayload = buildThirdPartyTextPayload({
              isVolcengineResponsesFormat,
              selectedModel,
              testPrompt,
              isArkOrDoubaoOrDeepseek,
              effectiveThinkingEnabled,
            });

            const textRes = await fetch(completionsUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${activeApiKeyTrimmed}`,
              },
              body: JSON.stringify(textPayload),
            });

            if (textRes.ok) {
              const doc = await textRes.json() as ThirdPartyResponseDoc;
              textStatus.ok = true;
              textStatus.response = thirdPartyText(doc);
            } else {
              textStatus.error = await textRes.text();
            }
          } catch (err: unknown) {
            textStatus.error = errorMessage(err);
          }

          try {
            const visionPayload = buildThirdPartyVisionPayload({
              isVolcengineResponsesFormat,
              selectedModel,
              testPrompt,
              tinyImageBase64,
              isArkOrDoubaoOrDeepseek,
              effectiveThinkingEnabled,
            });

            const visionRes = await fetch(completionsUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${activeApiKeyTrimmed}`,
              },
              body: JSON.stringify(visionPayload),
            });

            if (visionRes.ok) {
              const doc = await visionRes.json() as ThirdPartyResponseDoc;
              visionStatus.ok = true;
              visionStatus.response = thirdPartyText(doc);
            } else {
              visionStatus.error = await visionRes.text();
            }
          } catch (err: unknown) {
            visionStatus.error = errorMessage(err);
          }
        } else {
          if (!activeApiKey) {
            return res.status(400).json({ error: "Gemini API key is not configured." });
          }

          const activeAi = new GoogleGenAI({
            apiKey: activeApiKey,
            httpOptions: {
              headers: {
                "User-Agent": "aistudio-build",
              },
            },
            ...(customGeminiBaseUrl ? { baseURL: customGeminiBaseUrl } : {}),
          });
          const selectedModel = customModelName || "gemini-3.5-flash";

          try {
            const response = await activeAi.models.generateContent({
              model: selectedModel,
              contents: testPrompt,
            });
            textStatus.ok = true;
            textStatus.response = response.text || "OK";
          } catch (err: unknown) {
            textStatus.error = errorMessage(err);
          }

          try {
            const response = await activeAi.models.generateContent({
              model: selectedModel,
              contents: {
                parts: [
                  {
                    inlineData: {
                      data: tinyImageBase64,
                      mimeType: "image/png",
                    },
                  },
                  { text: testPrompt },
                ],
              },
            });
            visionStatus.ok = true;
            visionStatus.response = response.text || "OK";
          } catch (err: unknown) {
            visionStatus.error = errorMessage(err);
          }
        }
      }

      return res.json({
        provider,
        model: customModelName || (provider === "anthropic" ? "claude-3-5-sonnet-20241022" : "gemini-3.5-flash"),
        textStatus,
        visionStatus,
        sentPrompt: testPrompt,
        sentImage: `data:image/png;base64,${tinyImageBase64}`,
      });
    } catch (error: unknown) {
      console.error("Error in diagnostics:", error);
      return res.status(500).json({ error: errorMessage(error) || "An error occurred during connection self-test." });
    }
  });

  return router;
}
