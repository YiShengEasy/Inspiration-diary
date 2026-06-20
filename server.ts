import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import pg from "pg";
import { createAuthRouter } from "./src/server/auth";
import { storeImageInPhotoPrism } from "./src/server/photoprism";

dotenv.config();

const app = express();
const PORT = 3000;

function getCompletionsUrl(baseUrl: string): string {
  let url = baseUrl.trim();
  if (!url.endsWith("/chat/completions") && !url.endsWith("/chat/completions/")) {
    if (url.endsWith("/")) {
      url = url + "chat/completions";
    } else {
      url = url + "/chat/completions";
    }
  }
  return url;
}

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
} else {
  console.warn("GEMINI_API_KEY environment variable is not defined!");
}

app.post("/api/analyze-image", async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64 in request body." });
    }

    const provider = (req.headers["x-provider"] as string | undefined) || "gemini";
    const customApiKey = req.headers["x-api-key"] as string | undefined;
    const customModelName = req.headers["x-model-name"] as string | undefined;
    const customGeminiBaseUrl = req.headers["x-gemini-base-url"] as string | undefined;
    const thinkingEnabled = req.headers["x-thinking-enabled"] === "true";

    console.log("=== API LOG: Analyze Image Request ===");
    console.log("provider:", provider);
    console.log("has customApiKey:", !!customApiKey, customApiKey ? `(length: ${customApiKey.length})` : "(empty)");
    console.log("customModelName:", customModelName);
    console.log("customGeminiBaseUrl:", customGeminiBaseUrl);
    console.log("=====================================");

    let rawBase64 = imageBase64;
    let actualMimeType = mimeType || "image/png";

    if (imageBase64.includes(";base64,")) {
      const parts = imageBase64.split(";base64,");
      rawBase64 = parts[1];
      const match = parts[0].match(/data:(.*);base64/);
      if (match) {
        actualMimeType = match[1];
      }
    }

    // JSON code blocks cleaning helper to prevent any parsing errors
    const cleanJsonText = (raw: string): string => {
      let cleaned = raw.trim();
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.substring(7);
      } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.substring(3);
      }
      if (cleaned.endsWith("```")) {
        cleaned = cleaned.substring(0, cleaned.length - 3);
      }
      return cleaned.trim();
    };

    if (provider === "anthropic") {
      const anthropicApiKey = customApiKey || process.env.ANTHROPIC_AUTH_TOKEN;
      if (!anthropicApiKey) {
        return res.status(400).json({ error: "Anthropic API Key is not configured. Please supply it in Settings." });
      }

      const customBaseUrl = (req.headers["x-anthropic-base-url"] as string | undefined) || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
      let anthropicUrl = customBaseUrl;
      if (!anthropicUrl.endsWith("/messages") && !anthropicUrl.endsWith("/messages/")) {
        if (anthropicUrl.endsWith("/")) {
          anthropicUrl = anthropicUrl + "v1/messages";
        } else {
          anthropicUrl = anthropicUrl + "/v1/messages";
        }
      }

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
                        "Provide a list of 5 to 10 highly relevant, inspirational, and creative keywords in Chinese (or standard English hybrid terms if highly descriptive) to help the user catalog their visual inspiration. " +
                        "Reply ONLY with a raw JSON object of the format: {\"terms\": [\"term1\", \"term2\", ...]} without any markdown code backticks or other text."
                }
              ]
            }
          ]
        })
      });

      if (!anthropicResponse.ok) {
        const errText = await anthropicResponse.text();
        console.error("Anthropic service error response:", errText);
        return res.status(anthropicResponse.status).json({ error: `Anthropic API: ${errText}` });
      }

      const responseDoc: any = await anthropicResponse.json();
      const rawText = responseDoc.content?.[0]?.text || "{}";
      const cleanedText = cleanJsonText(rawText);
      const parsedData = JSON.parse(cleanedText || '{"terms": []}');
      return res.json(parsedData);

    } else {
      // Check if custom base url is a third-party non-Google gateway
      const isThirdParty = customGeminiBaseUrl && 
        (!customGeminiBaseUrl.toLowerCase().includes("googleapis.com") && !customGeminiBaseUrl.toLowerCase().includes("google.com"));

      if (isThirdParty) {
        const activeApiKey = (customApiKey || apiKey || "").trim();
        if (!activeApiKey) {
          return res.status(400).json({ error: "Third-party API key is not defined. Please configure your API key in Settings." });
        }

        const completionsUrl = getCompletionsUrl(customGeminiBaseUrl);
        const selectedModel = (customModelName || "doubao-seed-2.0-code").trim();

        console.log(`Routing image analysis via OpenAI/Third-party protocol to: ${completionsUrl} using model: ${selectedModel}`);

        const isVolcengineResponsesFormat = completionsUrl.includes("/responses");
        let payload: any;

        if (isVolcengineResponsesFormat) {
          payload = {
            model: selectedModel,
            input: [
              {
                role: "user",
                content: [
                  {
                    type: "input_image",
                    image_url: `data:${actualMimeType};base64,${rawBase64}`
                  },
                  {
                    type: "input_text",
                    text: "You are a creative inspiration research assistant. Analyze this uploaded screenshot or design reference image. " +
                          "Extract evocative artistic inspirations, creative concepts, design styles, mood terms, color palettes, and visual keywords (e.g., '复古工业风', '赛博朋克色调', '温柔莫兰迪色', '温暖松弛感', 'Wabi-Sabi 侘寂', 'Mid-century Modern'). " +
                          "Return a list of 5 to 10 highly relevant and imaginative keywords in Chinese (or standard English descriptors) as a JSON list in the key 'terms' to capture the visual inspiration. " +
                          "Respond ONLY with a raw JSON object of the format: {\"terms\": [\"term1\", \"term2\", ...]} without any markdown code backticks or other text."
                  }
                ]
              }
            ]
          };
        } else {
          payload = {
            model: selectedModel,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "You are a creative inspiration research assistant. Analyze this uploaded screenshot or design reference image. " +
                          "Extract evocative artistic inspirations, creative concepts, design styles, mood terms, color palettes, and visual keywords (e.g., '复古工业风', '赛博朋克色调', '温柔莫兰迪色', '温暖松弛感', 'Wabi-Sabi 侘寂', 'Mid-century Modern'). " +
                          "Return a list of 5 to 10 highly relevant and imaginative keywords in Chinese (or standard English descriptors) as a JSON list in the key 'terms' to capture the visual inspiration. " +
                          "Respond ONLY with a raw JSON object of the format: {\"terms\": [\"term1\", \"term2\", ...]} without any markdown code backticks or other text."
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${actualMimeType};base64,${rawBase64}`
                    }
                  }
                ]
              }
            ]
          };
        }

        // Apply thinking mode based on user preference header
        const isArkOrDoubaoOrDeepseek = /doubao|ark|volces|volcengine|deepseek/i.test(selectedModel) || /volces|ark|volcengine|deepseek/i.test(completionsUrl);
        if (isArkOrDoubaoOrDeepseek && !isVolcengineResponsesFormat) {
          payload.thinking = {
            type: thinkingEnabled ? "enabled" : "disabled"
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

        const responseDoc: any = await thirdPartyResponse.json();
        const rawText = responseDoc.choices?.[0]?.message?.content || responseDoc.choices?.[0]?.text || responseDoc.output || "{}";
        const cleanedText = cleanJsonText(rawText);
        const parsedData = JSON.parse(cleanedText || '{"terms": []}');
        return res.json(parsedData);

      } else {
        // Default: Google Gemini API Flow
        const activeApiKey = customApiKey || apiKey;
        if (!activeApiKey) {
          return res.status(500).json({ error: "Gemini API key is not defined. Please configure your API key in Settings." });
        }

        const activeAiOptions: any = {
          apiKey: activeApiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build-custom',
            }
          }
        };

        if (customGeminiBaseUrl) {
          activeAiOptions.baseURL = customGeminiBaseUrl;
        }

        const activeAi = new GoogleGenAI(activeAiOptions);

        const selectedModel = customModelName || "gemini-3.5-flash";

        const imagePart = {
          inlineData: {
            mimeType: actualMimeType,
            data: rawBase64,
          },
        };

        const textPart = {
          text: "You are a creative inspiration research assistant. Analyze this uploaded screenshot or design reference image. " +
                "Extract evocative artistic inspirations, creative concepts, design styles, mood terms, color palettes, and visual keywords (e.g., '复古工业风', '赛博朋克色调', '温柔莫兰迪色', '温暖松弛感', 'Wabi-Sabi 侘寂', 'Mid-century Modern'). " +
                "Return a list of 5 to 10 highly relevant and imaginative keywords in Chinese (or standard English descriptors) as a JSON list in the key 'terms' to capture the visual inspiration."
        };

        const response = await activeAi.models.generateContent({
          model: selectedModel,
          contents: { parts: [imagePart, textPart] },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                terms: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "A list of 5 to 10 professional design terminology keywords inspired by the image."
                }
              },
              required: ["terms"]
            }
          }
        });

        const cleanedText = cleanJsonText(response.text || '{"terms": []}');
        const parsedData = JSON.parse(cleanedText);
        return res.json(parsedData);
      }
    }
  } catch (error: any) {
    console.error("Error analyzing image:", error);
    return res.status(500).json({ error: error.message || "An error occurred while analyzing the image." });
  }
});

app.post("/api/store-image", async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64 in request body." });
    }

    const stored = await storeImageInPhotoPrism(imageBase64);
    return res.json(stored);
  } catch (error: any) {
    console.error("PhotoPrism image storage error:", error);
    return res.status(500).json({ error: error.message || "PhotoPrism image storage failed." });
  }
});

app.post("/api/test-model", async (req, res) => {
  try {
    const provider = (req.headers["x-provider"] as string | undefined) || "gemini";
    const customApiKey = req.headers["x-api-key"] as string | undefined;
    const customModelName = req.headers["x-model-name"] as string | undefined;
    const customGeminiBaseUrl = req.headers["x-gemini-base-url"] as string | undefined;

    // We will run a text test AND a vision test and return both statuses
    let textStatus = { ok: false, error: "", response: "" };
    let visionStatus = { ok: false, error: "", response: "" };

    const testPrompt = "Reply with exactly 'OK'";
    // 16x16 pixels PNG to satisfy minimum size requirement of at least 14 pixels
    const tinyImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAALElEQVR42mNk+M9QDwOMjIxtbW3E6sGlhoGBgY8bVz0yGBUYoIEBCgYGBgC3DwscLgbvggAAAABJRU5ErkJggg==";

    if (provider === "anthropic") {
      const anthropicApiKey = customApiKey || process.env.ANTHROPIC_AUTH_TOKEN;
      if (!anthropicApiKey) {
        return res.status(400).json({ error: "Anthropic API Key is not configured." });
      }

      const customBaseUrl = (req.headers["x-anthropic-base-url"] as string | undefined) || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
      let anthropicUrl = customBaseUrl;
      if (!anthropicUrl.endsWith("/messages") && !anthropicUrl.endsWith("/messages/")) {
        if (anthropicUrl.endsWith("/")) {
          anthropicUrl = anthropicUrl + "v1/messages";
        } else {
          anthropicUrl = anthropicUrl + "/v1/messages";
        }
      }

      const selectedModel = customModelName || "claude-3-5-sonnet-20241022";

      // 1. Text test
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
            messages: [{ role: "user", content: testPrompt }]
          })
        });

        if (textRes.ok) {
          const doc: any = await textRes.json();
          textStatus.ok = true;
          textStatus.response = doc.content?.[0]?.text?.trim() || "OK";
        } else {
          textStatus.error = await textRes.text();
        }
      } catch (err: any) {
        textStatus.error = err.message || String(err);
      }

      // 2. Vision test
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
                      data: tinyImageBase64
                    }
                  },
                  {
                    type: "text",
                    text: testPrompt
                  }
                ]
              }
            ]
          })
        });

        if (visionRes.ok) {
          const doc: any = await visionRes.json();
          visionStatus.ok = true;
          visionStatus.response = doc.content?.[0]?.text?.trim() || "OK";
        } else {
          visionStatus.error = await visionRes.text();
        }
      } catch (err: any) {
        visionStatus.error = err.message || String(err);
      }

    } else {
      // Gemini or Third-party OpenAI provider
      const activeApiKey = customApiKey || process.env.GEMINI_API_KEY;
      const isThirdParty = customGeminiBaseUrl && 
        (!customGeminiBaseUrl.toLowerCase().includes("googleapis.com") && !customGeminiBaseUrl.toLowerCase().includes("google.com"));

      if (isThirdParty) {
        if (!activeApiKey) {
          return res.status(400).json({ error: "Third-party API key is not configured." });
        }

        const completionsUrl = getCompletionsUrl(customGeminiBaseUrl);
        const selectedModel = (customModelName || "doubao-seed-2.0-code").trim();

        console.log(`Running diagnostic tests via OpenAI/Third-party directly to: ${completionsUrl} using model: ${selectedModel}`);

        const isArkOrDoubaoOrDeepseek = /doubao|ark|volces|volcengine|deepseek/i.test(selectedModel) || /volces|ark|volcengine|deepseek/i.test(completionsUrl);
        const isVolcengineResponsesFormat = completionsUrl.includes("/responses");
        const activeApiKeyTrimmed = (activeApiKey || "").trim();

        // 1. Text test
        try {
          let textPayload: any;
          if (isVolcengineResponsesFormat) {
            textPayload = {
              model: selectedModel,
              input: [
                {
                  role: "user",
                  content: [
                    {
                      type: "input_text",
                      text: testPrompt
                    }
                  ]
                }
              ]
            };
          } else {
            textPayload = {
              model: selectedModel,
              messages: [{ role: "user", content: testPrompt }],
              max_tokens: 50,
            };
            if (isArkOrDoubaoOrDeepseek) {
              textPayload.thinking = { type: "disabled" };
            }
          }

          const textRes = await fetch(completionsUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${activeApiKeyTrimmed}`,
            },
            body: JSON.stringify(textPayload)
          });

          if (textRes.ok) {
            const doc: any = await textRes.json();
            const textResponse = doc.choices?.[0]?.message?.content?.trim() || doc.choices?.[0]?.text?.trim() || doc.output?.trim() || "OK";
            textStatus.ok = true;
            textStatus.response = textResponse;
          } else {
            textStatus.error = await textRes.text();
          }
        } catch (err: any) {
          textStatus.error = err.message || String(err);
        }

        // 2. Vision test
        try {
          let visionPayload: any;
          if (isVolcengineResponsesFormat) {
            visionPayload = {
              model: selectedModel,
              input: [
                {
                  role: "user",
                  content: [
                    {
                      type: "input_image",
                      image_url: `data:image/png;base64,${tinyImageBase64}`
                    },
                    {
                      type: "input_text",
                      text: testPrompt
                    }
                  ]
                }
              ]
            };
          } else {
            visionPayload = {
              model: selectedModel,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: testPrompt
                    },
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:image/png;base64,${tinyImageBase64}`
                      }
                    }
                  ]
                }
              ],
              max_tokens: 50,
            };
            if (isArkOrDoubaoOrDeepseek) {
              visionPayload.thinking = { type: "disabled" };
            }
          }

          const visionRes = await fetch(completionsUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${activeApiKeyTrimmed}`,
            },
            body: JSON.stringify(visionPayload)
          });

          if (visionRes.ok) {
            const doc: any = await visionRes.json();
            const visionResponse = doc.choices?.[0]?.message?.content?.trim() || doc.choices?.[0]?.text?.trim() || doc.output?.trim() || "OK";
            visionStatus.ok = true;
            visionStatus.response = visionResponse;
          } else {
            visionStatus.error = await visionRes.text();
          }
        } catch (err: any) {
          visionStatus.error = err.message || String(err);
        }

      } else {
        // Standard Google Gemini provider
        if (!activeApiKey) {
          return res.status(400).json({ error: "Gemini API key is not configured." });
        }

        const activeAiOptions: any = {
          apiKey: activeApiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        };

        if (customGeminiBaseUrl) {
          activeAiOptions.baseURL = customGeminiBaseUrl;
        }

        const activeAi = new GoogleGenAI(activeAiOptions);
        const selectedModel = customModelName || "gemini-3.5-flash";

        // 1. Text test
        try {
          const response = await activeAi.models.generateContent({
            model: selectedModel,
            contents: testPrompt
          });
          textStatus.ok = true;
          textStatus.response = response.text || "OK";
        } catch (err: any) {
          textStatus.error = err.message || String(err);
        }

        // 2. Vision test
        try {
          const imagePart = {
            inlineData: {
              data: tinyImageBase64,
              mimeType: "image/png"
            }
          };
          const textPart = { text: testPrompt };

          const response = await activeAi.models.generateContent({
            model: selectedModel,
            contents: { parts: [imagePart, textPart] }
          });
          visionStatus.ok = true;
          visionStatus.response = response.text || "OK";
        } catch (err: any) {
          visionStatus.error = err.message || String(err);
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

  } catch (error: any) {
    console.error("Error in diagnostics:", error);
    return res.status(500).json({ error: error.message || "An error occurred during connection self-test." });
  }
});

// ==========================================
// PostgreSQL Database Connection & CRUD routes
// ==========================================
const { Pool } = pg;
const dbType = process.env.DATABASE_TYPE || "firestore";
let pgPool: pg.Pool | null = null;

if (dbType === "postgres" || process.env.DATABASE_URL) {
  console.log("Configuring server database for local/remote PostgreSQL...");
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/notebook",
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
  });

  // Initialize Postgres relational tables asynchronously on boot
  const initDb = async () => {
    try {
      const client = await pgPool!.connect();
      try {
        console.log("Initializing PostgreSQL database schema...");
        await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            display_name TEXT,
            role TEXT NOT NULL DEFAULT 'user',
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL
          );
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at BIGINT NOT NULL,
            expires_at BIGINT NOT NULL,
            last_seen_at BIGINT NOT NULL,
            user_agent TEXT
          );
        `);
        await client.query("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);");
        await client.query(`
          CREATE TABLE IF NOT EXISTS notes (
            week_id VARCHAR(50) PRIMARY KEY,
            note TEXT,
            height INTEGER,
            updated_at BIGINT
          );
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS cards (
            id VARCHAR(50) PRIMARY KEY,
            week_id VARCHAR(50) NOT NULL,
            day_index INTEGER NOT NULL,
            image_url TEXT NOT NULL,
            terms TEXT[] NOT NULL,
            deco_type VARCHAR(50),
            angle NUMERIC,
            created_at BIGINT
          );
        `);
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS photo_uid TEXT;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS terms_text TEXT;");
        await client.query("UPDATE cards SET terms_text = array_to_string(terms, ' ') WHERE terms_text IS NULL OR terms_text = '';");
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_created_at_desc ON cards (created_at DESC);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_week_created_at ON cards (week_id, created_at);");
        try {
          await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
          await client.query("CREATE INDEX IF NOT EXISTS idx_cards_terms_text_trgm ON cards USING gin (terms_text gin_trgm_ops);");
        } catch (indexErr) {
          console.warn("PostgreSQL trigram index setup skipped:", indexErr);
        }
        console.log("PostgreSQL schema successfully verified/created.");
        await client.query(`
          CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(100) PRIMARY KEY,
            value TEXT,
            updated_at BIGINT
          );
        `);
        await client.query("ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;");
        await client.query("ALTER TABLE settings ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;");
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_created_at ON cards(user_id, created_at DESC);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_week_created_at ON cards(user_id, week_id, created_at);");
        await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_user_week ON notes(user_id, week_id);");
        await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_user_key ON settings(user_id, key);");
        const userCount = await client.query("SELECT COUNT(*)::int AS count FROM users");
        if (Number(userCount.rows[0]?.count || 0) === 0) {
          const bootstrapEmail = process.env.AUTH_BOOTSTRAP_EMAIL || "local-admin@example.com";
          const bootstrapPassword = process.env.AUTH_BOOTSTRAP_PASSWORD;
          if (!bootstrapPassword) {
            console.warn("AUTH_BOOTSTRAP_PASSWORD is not set. Existing data will be assigned after first registration.");
          } else {
            const bcrypt = await import("bcryptjs");
            const passwordHash = await bcrypt.default.hash(bootstrapPassword, 12);
            await client.query(
              `INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
               VALUES (gen_random_uuid(), $1, $2, 'Local Admin', 'admin', $3, $3)
               ON CONFLICT (email) DO NOTHING`,
              [bootstrapEmail.trim().toLowerCase(), passwordHash, Date.now()]
            );
          }
        }

        const ownerResult = await client.query("SELECT id FROM users ORDER BY created_at ASC LIMIT 1");
        const ownerId = ownerResult.rows[0]?.id;
        if (ownerId) {
          await client.query("UPDATE notes SET user_id = $1 WHERE user_id IS NULL", [ownerId]);
          await client.query("UPDATE cards SET user_id = $1 WHERE user_id IS NULL", [ownerId]);
          await client.query("UPDATE settings SET user_id = $1 WHERE user_id IS NULL", [ownerId]);
        }
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("PostgreSQL database connection/init error:", err);
    }
  };
  initDb();
}

if (pgPool) {
  app.use("/api/auth", createAuthRouter(pgPool));
}

// 1. Fetch weekly note
app.get("/api/db/notes/:weekId", async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured. Specify DATABASE_TYPE=postgres" });
  }
  try {
    const result = await pgPool.query(
      "SELECT week_id, note, height, updated_at FROM notes WHERE week_id = $1",
      [req.params.weekId]
    );
    if (result.rows.length > 0) {
      const row = result.rows[0];
      return res.json({
        weekId: row.week_id,
        note: row.note,
        height: row.height,
        updatedAt: Number(row.updated_at),
      });
    } else {
      return res.status(404).json({ error: "Note not found" });
    }
  } catch (err: any) {
    console.error("Error executing fetch note query:", err);
    return res.status(500).json({ error: err.message });
  }
});

// 2. Persist/update weekly note
app.post("/api/db/notes", async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const { weekId, note, height } = req.body;
    await pgPool.query(
      `INSERT INTO notes (week_id, note, height, updated_at) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (week_id) 
       DO UPDATE SET note = EXCLUDED.note, height = EXCLUDED.height, updated_at = EXCLUDED.updated_at`,
      [weekId, note, height, Date.now()]
    );
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error executing upsert note query:", err);
    return res.status(500).json({ error: err.message });
  }
});

// 3. Fetch image cards for week ID
app.get("/api/db/cards", async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const weekId = req.query.weekId as string;
    const mapCards = (rows: any[]) => rows.map((row) => ({
      id: row.id,
      weekId: row.week_id,
      dayIndex: row.day_index,
      imageUrl: row.image_url,
      thumbnailUrl: row.thumbnail_url || "",
      photoUid: row.photo_uid || "",
      terms: row.terms || [],
      decoType: row.deco_type,
      angle: Number(row.angle),
      createdAt: Number(row.created_at),
    }));

    if (weekId && weekId !== "all") {
      const result = await pgPool.query(
        "SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, terms, deco_type, angle, created_at FROM cards WHERE week_id = $1 ORDER BY day_index ASC, created_at ASC",
        [weekId]
      );
      return res.json(mapCards(result.rows));
    }

    const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
    const rawPageSize = Number.parseInt(String(req.query.pageSize || "12"), 10) || 12;
    const pageSize = Math.min(60, Math.max(1, rawPageSize));
    const offset = (page - 1) * pageSize;
    const q = String(req.query.q || "").trim();

    const whereClauses: string[] = [];
    const values: Array<string | number> = [];
    if (q) {
      values.push(`%${q}%`);
      whereClauses.push(`terms_text ILIKE $${values.length}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const countResult = await pgPool.query(
      `SELECT COUNT(*)::int AS total FROM cards ${whereSql}`,
      values
    );
    const total = Number(countResult.rows[0]?.total || 0);

    values.push(pageSize);
    const limitParam = values.length;
    values.push(offset);
    const offsetParam = values.length;

    const result = await pgPool.query(
      `SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, terms, deco_type, angle, created_at
       FROM cards
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      values
    );

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return res.json({
      cards: mapCards(result.rows),
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (err: any) {
    console.error("Error executing fetch cards query:", err);
    return res.status(500).json({ error: err.message });
  }
});

// 4. Create or update image card
app.post("/api/db/cards", async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const { id, weekId, dayIndex, imageUrl, thumbnailUrl, photoUid, terms, decoType, angle, createdAt } = req.body;
    await pgPool.query(
      `INSERT INTO cards (id, week_id, day_index, image_url, thumbnail_url, photo_uid, terms, terms_text, deco_type, angle, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, array_to_string($7::text[], ' '), $8, $9, $10) 
       ON CONFLICT (id) 
       DO UPDATE SET week_id = EXCLUDED.week_id, day_index = EXCLUDED.day_index, image_url = EXCLUDED.image_url, 
                     thumbnail_url = EXCLUDED.thumbnail_url, photo_uid = EXCLUDED.photo_uid,
                     terms = EXCLUDED.terms, terms_text = EXCLUDED.terms_text, deco_type = EXCLUDED.deco_type, angle = EXCLUDED.angle, 
                     created_at = EXCLUDED.created_at`,
      [id, weekId, dayIndex, imageUrl, thumbnailUrl || "", photoUid || "", terms, decoType, angle, createdAt || Date.now()]
    );
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error executing upsert card query:", err);
    return res.status(500).json({ error: err.message });
  }
});

// 5. Delete card
app.delete("/api/db/cards/:id", async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    await pgPool.query("DELETE FROM cards WHERE id = $1", [req.params.id]);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error executing delete card query:", err);
    return res.status(500).json({ error: err.message });
  }
});

// 6. Inline card tag edit
app.put("/api/db/cards/:id/terms", async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const { terms } = req.body;
    await pgPool.query("UPDATE cards SET terms = $1, terms_text = array_to_string($1::text[], ' ') WHERE id = $2", [terms, req.params.id]);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error executing update card tag terms query:", err);
    return res.status(500).json({ error: err.message });
  }
});

// 7. Fetch all settings
app.get("/api/db/settings", async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const result = await pgPool.query("SELECT key, value FROM settings");
    const settings: Record<string, string> = {};
    result.rows.forEach((row) => {
      settings[row.key] = row.value;
    });
    return res.json(settings);
  } catch (err: any) {
    console.error("Error fetching settings:", err);
    return res.status(500).json({ error: err.message });
  }
});

// 8. Upsert settings (batch)
app.post("/api/db/settings", async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const entries = Object.entries(req.body as Record<string, string>);
    const now = Date.now();
    for (const [key, value] of entries) {
      await pgPool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [key, value, now]
      );
    }
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error saving settings:", err);
    return res.status(500).json({ error: err.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
