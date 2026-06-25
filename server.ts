import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import pg from "pg";
import multer from "multer";
import { createAuthRouter, requireAuth, type AuthenticatedRequest } from "./src/server/auth";
import { fetchPhotoPrismImage, storeImageUploadInPhotoPrism } from "./src/server/photoprism";
import { normalizeImageUpload } from "./src/server/upload";
import { getMiniToken, loadMiniSessionUser } from "./src/server/miniprogramAuth";

dotenv.config();

const app = express();
const PORT = 3000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 1,
  },
});

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

function cleanJsonText(raw: string): string {
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
}

function limitTermsResponse(parsedData: any): { terms: string[] } {
  const terms = Array.isArray(parsedData?.terms)
    ? parsedData.terms
        .filter((term: unknown): term is string => typeof term === "string")
        .map((term: string) => term.trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];

  return { terms };
}

function mapCardRows(rows: any[]) {
  return rows.map((row) => ({
    id: row.id,
    weekId: row.week_id,
    dayIndex: row.day_index,
    imageUrl: row.image_url,
    thumbnailUrl: row.thumbnail_url || "",
    photoUid: row.photo_uid || "",
    photoHash: row.photo_hash || "",
    terms: row.terms || [],
    decoType: row.deco_type,
    angle: Number(row.angle),
    createdAt: Number(row.created_at),
    type: row.type || "image",
    mdContent: row.md_content || "",
    mdSummary: row.md_summary || "",
    mdName: row.md_name || "",
  }));
}

function mapBookRow(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    cardCount: Number(row.card_count || 0),
    coverCard: row.cover_card ? mapCardRows([row.cover_card])[0] : null,
  };
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
        await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(40);");
        await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;");
        await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users(phone) WHERE phone IS NOT NULL AND phone <> '';");
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
          CREATE TABLE IF NOT EXISTS wechat_identities (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            mini_openid TEXT NOT NULL UNIQUE,
            unionid TEXT,
            phone TEXT,
            nickname TEXT,
            avatar_url TEXT,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL
          );
        `);
        await client.query("CREATE INDEX IF NOT EXISTS idx_wechat_identities_user_id ON wechat_identities(user_id);");
        await client.query(`
          CREATE TABLE IF NOT EXISTS mini_program_sessions (
            id TEXT PRIMARY KEY,
            identity_id UUID NOT NULL REFERENCES wechat_identities(id) ON DELETE CASCADE,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            created_at BIGINT NOT NULL,
            expires_at BIGINT NOT NULL,
            last_seen_at BIGINT NOT NULL
          );
        `);
        await client.query("CREATE INDEX IF NOT EXISTS idx_mini_program_sessions_user_id ON mini_program_sessions(user_id);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_mini_program_sessions_expires_at ON mini_program_sessions(expires_at);");
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
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS photo_hash TEXT;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS terms_text TEXT;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'image';");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS md_content TEXT;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS md_summary TEXT;");
        await client.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS md_name VARCHAR(255);");
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
        await client.query(`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1
              FROM pg_constraint
              WHERE conrelid = 'notes'::regclass
                AND conname = 'notes_pkey'
            ) THEN
              ALTER TABLE notes DROP CONSTRAINT notes_pkey;
            END IF;
          END $$;
        `);
        await client.query(`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1
              FROM pg_constraint
              WHERE conrelid = 'settings'::regclass
                AND conname = 'settings_pkey'
            ) THEN
              ALTER TABLE settings DROP CONSTRAINT settings_pkey;
            END IF;
          END $$;
        `);
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_created_at ON cards(user_id, created_at DESC);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_week_created_at ON cards(user_id, week_id, created_at);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_cards_user_photo_uid ON cards(user_id, photo_uid);");
        await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_user_week ON notes(user_id, week_id);");
        await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_user_key ON settings(user_id, key);");
        await client.query(`
          CREATE TABLE IF NOT EXISTS inspiration_books (
            id TEXT PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            description TEXT,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL
          );
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS inspiration_book_cards (
            book_id TEXT NOT NULL REFERENCES inspiration_books(id) ON DELETE CASCADE,
            card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            added_at BIGINT NOT NULL
          );
        `);
        await client.query("CREATE INDEX IF NOT EXISTS idx_inspiration_books_user_updated_at ON inspiration_books(user_id, updated_at DESC);");
        await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_inspiration_book_cards_unique ON inspiration_book_cards(user_id, book_id, card_id);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_inspiration_book_cards_user_book_added_at ON inspiration_book_cards(user_id, book_id, added_at DESC);");
        await client.query("CREATE INDEX IF NOT EXISTS idx_inspiration_book_cards_user_card ON inspiration_book_cards(user_id, card_id);");
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

function getCurrentWeekId(): string {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const days = Math.floor(
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start.getTime()) / 86400000
  );
  const week = Math.ceil((days + start.getUTCDay() + 1) / 7);
  return `${now.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const requirePostgresAuth = async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  if (!pgPool) return res.status(503).json({ error: "PostgreSQL is not configured." });
  const miniToken = getMiniToken(req);
  if (miniToken) {
    const miniUser = await loadMiniSessionUser(pgPool, miniToken);
    if (!miniUser) return res.status(401).json({ error: "登录已过期" });
    req.user = miniUser;
    req.sessionId = miniToken;
    return next();
  }
  return requireAuth(pgPool)(req, res, next);
};

app.get("/api/miniprogram/me", requirePostgresAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const [inspirationCount, weekCount] = await Promise.all([
      pgPool!.query("SELECT COUNT(*)::int AS count FROM cards WHERE user_id = $1", [userId]),
      pgPool!.query("SELECT COUNT(*)::int AS count FROM cards WHERE user_id = $1 AND week_id = $2", [userId, getCurrentWeekId()]),
    ]);
    return res.json({
      user: req.user,
      stats: {
        inspirationCount: inspirationCount.rows[0]?.count || 0,
        weekRecordCount: weekCount.rows[0]?.count || 0,
        toolUsageCount: 0,
      },
      sync: { status: "ready" },
    });
  } catch (err: unknown) {
    console.error("Mini program me error:", err);
    return res.status(500).json({ error: "加载我的信息失败" });
  }
});

app.post("/api/miniprogram/tool-usage", requirePostgresAuth, async (_req, res) => {
  return res.json({ success: true });
});

app.post("/api/analyze-image", requirePostgresAuth, upload.single("image"), async (req, res) => {
  try {
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

    const image = normalizeImageUpload(req);
    let rawBase64 = image.dataUrl;
    let actualMimeType = image.mimeType;

    if (rawBase64.includes(";base64,")) {
      const parts = rawBase64.split(";base64,");
      rawBase64 = parts[1];
      const match = parts[0].match(/data:(.*);base64/);
      if (match) {
        actualMimeType = match[1];
      }
    }

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
                        "Provide exactly 5 highly relevant, inspirational, and creative keywords in Chinese (or standard English hybrid terms if highly descriptive) to help the user catalog their visual inspiration. " +
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
      return res.json(limitTermsResponse(parsedData));

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
                          "Return exactly 5 highly relevant and imaginative keywords in Chinese (or standard English descriptors) as a JSON list in the key 'terms' to capture the visual inspiration. " +
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
                          "Return exactly 5 highly relevant and imaginative keywords in Chinese (or standard English descriptors) as a JSON list in the key 'terms' to capture the visual inspiration. " +
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
        return res.json(limitTermsResponse(parsedData));

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
                "Return exactly 5 highly relevant and imaginative keywords in Chinese (or standard English descriptors) as a JSON list in the key 'terms' to capture the visual inspiration."
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
                  description: "Exactly 5 professional design terminology keywords inspired by the image."
                }
              },
              required: ["terms"]
            }
          }
        });

        const cleanedText = cleanJsonText(response.text || '{"terms": []}');
        const parsedData = JSON.parse(cleanedText);
        return res.json(limitTermsResponse(parsedData));
      }
    }
  } catch (error: any) {
    console.error("Error analyzing image:", error);
    return res.status(500).json({ error: error.message || "An error occurred while analyzing the image." });
  }
});

app.post("/api/store-image", requirePostgresAuth, upload.single("image"), async (req, res) => {
  try {
    const image = normalizeImageUpload(req);
    const stored = await storeImageUploadInPhotoPrism(image);
    const encodedHash = encodeURIComponent(stored.photoHash);
    return res.json({
      photoUid: stored.photoUid,
      photoHash: stored.photoHash,
      imageUrl: `/api/photos/hash/${encodedHash}/full`,
      thumbnailUrl: `/api/photos/hash/${encodedHash}/thumb`,
    });
  } catch (error: any) {
    console.error("PhotoPrism image storage error:", error);
    return res.status(400).json({ error: error.message || "PhotoPrism image storage failed." });
  }
});

app.post("/api/summarize-md", requirePostgresAuth, async (req, res) => {
  try {
    const { markdown } = req.body;
    if (typeof markdown !== "string" || !markdown.trim()) {
      return res.status(400).json({ error: "Missing markdown content." });
    }

    const fallbackSummary = markdown
      .split(/\r?\n/)
      .map((line: string) => line.replace(/^#{1,6}\s*/, "").replace(/^[-*+]\s+/, "").trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(" ")
      .replace(/\s+/g, " ")
      .slice(0, 220);

    const fallback = {
      summary: fallbackSummary || "已保存 Markdown 手稿，点击卡片查看完整内容。",
      terms: ["文档手稿", "Markdown"],
    };

    const provider = (req.headers["x-provider"] as string | undefined) || "gemini";
    const customApiKey = req.headers["x-api-key"] as string | undefined;
    const customModelName = req.headers["x-model-name"] as string | undefined;
    const customGeminiBaseUrl = req.headers["x-gemini-base-url"] as string | undefined;
    const thinkingEnabled = req.headers["x-thinking-enabled"] === "true";

    const prompt = [
      "你是一个文档整理与知识标签助手，不要按图片视觉风格分析。",
      "请阅读下面的 Markdown 文档，提炼文档的核心主题、结论、行动方向、项目线索和知识领域。",
      "输出必须是严格 JSON：{\"summary\":\"中文摘要，2到3句话\",\"terms\":[\"标签1\",\"标签2\",...]}。",
      "terms 必须正好 5 个，优先使用中文短标签；标签应描述文档内容，不要使用“光影、色彩、构图、视觉风格”等图片分析词，除非文档本身明确讨论这些主题。",
      "",
      "Markdown 内容：",
      markdown.slice(0, 12000),
    ].join("\n");

    const normalizeResult = (rawText: string) => {
      const parsed = JSON.parse(cleanJsonText(rawText) || "{}");
      const summary = typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : fallback.summary;
      const terms = Array.isArray(parsed.terms)
        ? parsed.terms
            .filter((term: unknown): term is string => typeof term === "string" && term.trim().length > 0)
            .map((term: string) => term.trim())
            .slice(0, 5)
        : fallback.terms;
      return { summary, terms: terms.length > 0 ? terms : fallback.terms };
    };

    try {
      if (provider === "anthropic") {
        const anthropicApiKey = customApiKey || process.env.ANTHROPIC_AUTH_TOKEN;
        if (!anthropicApiKey) return res.json(fallback);

        const customBaseUrl = (req.headers["x-anthropic-base-url"] as string | undefined) || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
        let anthropicUrl = customBaseUrl;
        if (!anthropicUrl.endsWith("/messages") && !anthropicUrl.endsWith("/messages/")) {
          anthropicUrl = anthropicUrl.endsWith("/") ? anthropicUrl + "v1/messages" : anthropicUrl + "/v1/messages";
        }

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
        const doc: any = await anthropicResponse.json();
        return res.json(normalizeResult(doc.content?.[0]?.text || "{}"));
      }

      const isThirdParty = customGeminiBaseUrl &&
        (!customGeminiBaseUrl.toLowerCase().includes("googleapis.com") && !customGeminiBaseUrl.toLowerCase().includes("google.com"));

      if (isThirdParty) {
        const activeApiKey = (customApiKey || apiKey || "").trim();
        if (!activeApiKey) return res.json(fallback);

        const completionsUrl = getCompletionsUrl(customGeminiBaseUrl);
        const selectedModel = (customModelName || "doubao-seed-2.0-code").trim();
        const payload: any = {
          model: selectedModel,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1200,
        };
        const isArkOrDoubaoOrDeepseek = /doubao|ark|volces|volcengine|deepseek/i.test(selectedModel) || /volces|ark|volcengine|deepseek/i.test(completionsUrl);
        if (isArkOrDoubaoOrDeepseek) {
          payload.thinking = { type: thinkingEnabled ? "enabled" : "disabled" };
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
        const doc: any = await thirdPartyResponse.json();
        return res.json(normalizeResult(doc.choices?.[0]?.message?.content || doc.choices?.[0]?.text || "{}"));
      }

      const activeApiKey = customApiKey || apiKey;
      if (!activeApiKey) return res.json(fallback);

      const activeAi = new GoogleGenAI({
        apiKey: activeApiKey,
        ...(customGeminiBaseUrl ? { baseURL: customGeminiBaseUrl } : {}),
        httpOptions: { headers: { "User-Agent": "aistudio-build-custom" } },
      } as any);

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
            },
            required: ["summary", "terms"],
          },
        },
      });

      return res.json(normalizeResult(response.text || "{}"));
    } catch (aiError) {
      console.warn("Markdown AI summary skipped:", aiError);
      return res.json(fallback);
    }
  } catch (error: any) {
    console.error("Markdown summary error:", error);
    return res.status(500).json({ error: error.message || "Markdown summary failed." });
  }
});

app.post("/api/test-model", requirePostgresAuth, async (req, res) => {
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

// 1. Fetch weekly note
app.get("/api/db/notes/:weekId", requirePostgresAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured. Specify DATABASE_TYPE=postgres" });
  }
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await pgPool.query(
      "SELECT week_id, note, height, updated_at FROM notes WHERE user_id = $1 AND week_id = $2",
      [authReq.user!.id, req.params.weekId]
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
app.post("/api/db/notes", requirePostgresAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const authReq = req as AuthenticatedRequest;
    const { weekId, note, height } = req.body;
    await pgPool.query(
      `INSERT INTO notes (user_id, week_id, note, height, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, week_id)
       DO UPDATE SET note = EXCLUDED.note, height = EXCLUDED.height, updated_at = EXCLUDED.updated_at`,
      [authReq.user!.id, weekId, note, height, Date.now()]
    );
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error executing upsert note query:", err);
    return res.status(500).json({ error: err.message });
  }
});

// 3. Fetch image cards for week ID
app.get("/api/db/books", requirePostgresAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await pgPool.query(
      `SELECT
         b.id,
         b.title,
         b.description,
         b.created_at,
         b.updated_at,
         COUNT(bc.card_id)::int AS card_count,
         (
           SELECT row_to_json(c)
           FROM (
             SELECT c2.id, c2.week_id, c2.day_index, c2.image_url, c2.thumbnail_url, c2.photo_uid, c2.photo_hash,
                    c2.terms, c2.deco_type, c2.angle, c2.created_at, c2.type, c2.md_content, c2.md_summary, c2.md_name
             FROM inspiration_book_cards bc2
             INNER JOIN cards c2 ON c2.id = bc2.card_id AND c2.user_id = $1
             WHERE bc2.user_id = $1 AND bc2.book_id = b.id
             ORDER BY bc2.added_at DESC
             LIMIT 1
           ) c
         ) AS cover_card
       FROM inspiration_books b
       LEFT JOIN inspiration_book_cards bc ON bc.book_id = b.id AND bc.user_id = $1
       WHERE b.user_id = $1
       GROUP BY b.id
       ORDER BY b.updated_at DESC`,
      [authReq.user!.id]
    );
    return res.json(result.rows.map(mapBookRow));
  } catch (err: any) {
    console.error("Error fetching inspiration books:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/db/books", requirePostgresAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const authReq = req as AuthenticatedRequest;
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    if (!title) {
      return res.status(400).json({ error: "Book title is required." });
    }

    const now = Date.now();
    const id = `book_${Math.random().toString(36).slice(2, 12)}_${now.toString(36)}`;
    const result = await pgPool.query(
      `INSERT INTO inspiration_books (id, user_id, title, description, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING id, title, description, created_at, updated_at, 0::int AS card_count, NULL::json AS cover_card`,
      [id, authReq.user!.id, title, description, now]
    );
    return res.json(mapBookRow(result.rows[0]));
  } catch (err: any) {
    console.error("Error creating inspiration book:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.put("/api/db/books/:bookId", requirePostgresAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const authReq = req as AuthenticatedRequest;
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    if (!title) {
      return res.status(400).json({ error: "Book title is required." });
    }

    const result = await pgPool.query(
      `UPDATE inspiration_books
       SET title = $1, description = $2, updated_at = $3
       WHERE id = $4 AND user_id = $5
       RETURNING id`,
      [title, description, Date.now(), req.params.bookId, authReq.user!.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Book not found" });
    }
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error updating inspiration book:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/db/books/:bookId", requirePostgresAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await pgPool.query(
      "DELETE FROM inspiration_books WHERE id = $1 AND user_id = $2",
      [req.params.bookId, authReq.user!.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Book not found" });
    }
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error deleting inspiration book:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/db/books/:bookId/cards", requirePostgresAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.id;
    const bookId = req.params.bookId;
    const book = await pgPool.query("SELECT id FROM inspiration_books WHERE id = $1 AND user_id = $2", [bookId, userId]);
    if (book.rowCount === 0) {
      return res.status(404).json({ error: "Book not found" });
    }

    const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
    const rawPageSize = Number.parseInt(String(req.query.pageSize || "12"), 10) || 12;
    const pageSize = Math.min(60, Math.max(1, rawPageSize));
    const offset = (page - 1) * pageSize;
    const q = String(req.query.q || "").trim();
    const values: Array<string | number> = [userId, bookId];
    const searchSql = q ? `AND c.terms_text ILIKE $3` : "";
    if (q) {
      values.push(`%${q}%`);
    }

    const countResult = await pgPool.query(
      `SELECT COUNT(*)::int AS total
       FROM inspiration_book_cards bc
       INNER JOIN cards c ON c.id = bc.card_id AND c.user_id = $1
       WHERE bc.user_id = $1 AND bc.book_id = $2 ${searchSql}`,
      values
    );
    const total = Number(countResult.rows[0]?.total || 0);

    values.push(pageSize);
    const limitParam = values.length;
    values.push(offset);
    const offsetParam = values.length;
    const cardsResult = await pgPool.query(
      `SELECT c.id, c.week_id, c.day_index, c.image_url, c.thumbnail_url, c.photo_uid, c.photo_hash,
              c.terms, c.deco_type, c.angle, c.created_at, c.type, c.md_content, c.md_summary, c.md_name
       FROM inspiration_book_cards bc
       INNER JOIN cards c ON c.id = bc.card_id AND c.user_id = $1
       WHERE bc.user_id = $1 AND bc.book_id = $2 ${searchSql}
       ORDER BY bc.added_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      values
    );

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return res.json({ cards: mapCardRows(cardsResult.rows), total, page, pageSize, totalPages });
  } catch (err: any) {
    console.error("Error fetching inspiration book cards:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/db/books/:bookId/cards", requirePostgresAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.id;
    const cardId = String(req.body.cardId || "").trim();
    if (!cardId) {
      return res.status(400).json({ error: "cardId is required." });
    }

    const owned = await pgPool.query(
      `SELECT b.id AS book_id, c.id AS card_id
       FROM inspiration_books b
       INNER JOIN cards c ON c.id = $2 AND c.user_id = $1
       WHERE b.id = $3 AND b.user_id = $1`,
      [userId, cardId, req.params.bookId]
    );
    if (owned.rowCount === 0) {
      return res.status(404).json({ error: "Book or card not found" });
    }

    const now = Date.now();
    await pgPool.query(
      `INSERT INTO inspiration_book_cards (user_id, book_id, card_id, added_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, book_id, card_id) DO NOTHING`,
      [userId, req.params.bookId, cardId, now]
    );
    await pgPool.query("UPDATE inspiration_books SET updated_at = $1 WHERE id = $2 AND user_id = $3", [now, req.params.bookId, userId]);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error adding card to inspiration book:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/db/books/:bookId/cards/:cardId", requirePostgresAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.id;
    const book = await pgPool.query("SELECT id FROM inspiration_books WHERE id = $1 AND user_id = $2", [req.params.bookId, userId]);
    if (book.rowCount === 0) {
      return res.status(404).json({ error: "Book not found" });
    }

    await pgPool.query(
      "DELETE FROM inspiration_book_cards WHERE user_id = $1 AND book_id = $2 AND card_id = $3",
      [userId, req.params.bookId, req.params.cardId]
    );
    await pgPool.query("UPDATE inspiration_books SET updated_at = $1 WHERE id = $2 AND user_id = $3", [Date.now(), req.params.bookId, userId]);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error removing card from inspiration book:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/db/cards", requirePostgresAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.id;
    const weekId = req.query.weekId as string;

    if (weekId && weekId !== "all") {
      const result = await pgPool.query(
        `SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash, terms, deco_type, angle, created_at, type, md_content, md_summary, md_name
         FROM cards
         WHERE user_id = $1 AND week_id = $2
         ORDER BY day_index ASC, created_at DESC`,
        [userId, weekId]
      );
      return res.json(mapCardRows(result.rows));
    }

    const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
    const rawPageSize = Number.parseInt(String(req.query.pageSize || "12"), 10) || 12;
    const pageSize = Math.min(60, Math.max(1, rawPageSize));
    const offset = (page - 1) * pageSize;
    const q = String(req.query.q || "").trim();

    const whereClauses: string[] = ["user_id = $1"];
    const values: Array<string | number> = [userId];
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
      `SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash, terms, deco_type, angle, created_at, type, md_content, md_summary, md_name
       FROM cards
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      values
    );

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return res.json({
      cards: mapCardRows(result.rows),
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
app.post("/api/db/cards", requirePostgresAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const authReq = req as AuthenticatedRequest;
    const { id, weekId, dayIndex, imageUrl, thumbnailUrl, photoUid, photoHash, terms, decoType, angle, createdAt, type, mdContent, mdSummary, mdName } = req.body;
    const safeTerms = Array.isArray(terms) ? terms : [];
    const termsText = [...safeTerms, mdName, mdSummary]
      .filter((value) => typeof value === "string" && value.trim())
      .join(" ");
    await pgPool.query(
      `INSERT INTO cards (id, user_id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash, terms, terms_text, deco_type, angle, created_at, type, md_content, md_summary, md_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (id)
       DO UPDATE SET week_id = EXCLUDED.week_id, day_index = EXCLUDED.day_index, image_url = EXCLUDED.image_url, 
                     thumbnail_url = EXCLUDED.thumbnail_url, photo_uid = EXCLUDED.photo_uid, photo_hash = EXCLUDED.photo_hash,
                     terms = EXCLUDED.terms, terms_text = EXCLUDED.terms_text, deco_type = EXCLUDED.deco_type, angle = EXCLUDED.angle, 
                     created_at = EXCLUDED.created_at, type = EXCLUDED.type, md_content = EXCLUDED.md_content,
                     md_summary = EXCLUDED.md_summary, md_name = EXCLUDED.md_name
       WHERE cards.user_id = EXCLUDED.user_id`,
      [
        id,
        authReq.user!.id,
        weekId,
        dayIndex,
        imageUrl || "",
        thumbnailUrl || "",
        photoUid || "",
        photoHash || "",
        safeTerms,
        termsText,
        decoType,
        angle,
        createdAt || Date.now(),
        type || "image",
        mdContent || null,
        mdSummary || null,
        mdName || null,
      ]
    );
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error executing upsert card query:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/db/cards/:id", requirePostgresAuth, async (req: AuthenticatedRequest, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const result = await pgPool.query(
      `SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash,
              terms, deco_type, angle, created_at, type, md_content, md_summary, md_name
       FROM cards
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user!.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: "Card not found" });
    }
    return res.json(mapCardRows(result.rows)[0]);
  } catch (err: any) {
    console.error("Error fetching card detail:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch card detail" });
  }
});

app.get("/api/photos/:photoUid/:variant(thumb|full)", requirePostgresAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }

  try {
    const authReq = req as AuthenticatedRequest;
    const { photoUid, variant } = req.params;
    const result = await pgPool.query(
      `SELECT photo_hash
       FROM cards
       WHERE user_id = $1 AND photo_uid = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [authReq.user!.id, photoUid]
    );
    const photoHash = result.rows[0]?.photo_hash;

    if (!photoHash) {
      return res.status(404).json({ error: "Photo not found" });
    }

    const image = await fetchPhotoPrismImage(photoHash, variant as "thumb" | "full");
    res.setHeader("Content-Type", image.contentType);
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.send(image.bytes);
  } catch (err: any) {
    console.error("Photo proxy error:", err);
    return res.status(502).json({ error: err.message || "Photo proxy failed." });
  }
});

app.get("/api/photos/hash/:photoHash/:variant(thumb|full)", requirePostgresAuth, async (req, res) => {
  try {
    const { photoHash, variant } = req.params;
    if (!/^[a-f0-9]{40}$/i.test(photoHash)) {
      return res.status(400).json({ error: "Invalid photo hash." });
    }

    const image = await fetchPhotoPrismImage(photoHash, variant as "thumb" | "full");
    res.setHeader("Content-Type", image.contentType);
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.send(image.bytes);
  } catch (err: any) {
    console.error("Photo proxy error:", err);
    return res.status(502).json({ error: err.message || "Photo proxy failed." });
  }
});

app.get("/api/db/cards/:cardId/books", requirePostgresAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.id;
    const card = await pgPool.query("SELECT id FROM cards WHERE id = $1 AND user_id = $2", [req.params.cardId, userId]);
    if (card.rowCount === 0) {
      return res.status(404).json({ error: "Card not found" });
    }

    const result = await pgPool.query(
      `SELECT b.id, b.title, b.description, COUNT(all_bc.card_id)::int AS card_count,
              CASE WHEN own_bc.card_id IS NULL THEN false ELSE true END AS contains_card
       FROM inspiration_books b
       LEFT JOIN inspiration_book_cards all_bc ON all_bc.book_id = b.id AND all_bc.user_id = $1
       LEFT JOIN inspiration_book_cards own_bc ON own_bc.book_id = b.id AND own_bc.user_id = $1 AND own_bc.card_id = $2
       WHERE b.user_id = $1
       GROUP BY b.id, own_bc.card_id
       ORDER BY b.updated_at DESC`,
      [userId, req.params.cardId]
    );
    return res.json(result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description || "",
      cardCount: Number(row.card_count || 0),
      containsCard: Boolean(row.contains_card),
    })));
  } catch (err: any) {
    console.error("Error fetching card inspiration book membership:", err);
    return res.status(500).json({ error: err.message });
  }
});

// 5. Delete card
app.delete("/api/db/cards/:id", requirePostgresAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await pgPool.query("DELETE FROM cards WHERE id = $1 AND user_id = $2", [req.params.id, authReq.user!.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Card not found" });
    }
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error executing delete card query:", err);
    return res.status(500).json({ error: err.message });
  }
});

// 6. Inline card tag edit
app.put("/api/db/cards/:id/terms", requirePostgresAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const authReq = req as AuthenticatedRequest;
    const { terms } = req.body;
    const result = await pgPool.query(
      "UPDATE cards SET terms = $1, terms_text = array_to_string($1::text[], ' ') WHERE id = $2 AND user_id = $3",
      [terms, req.params.id, authReq.user!.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Card not found" });
    }
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error executing update card tag terms query:", err);
    return res.status(500).json({ error: err.message });
  }
});

// 7. Fetch all settings
app.get("/api/db/settings", requirePostgresAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await pgPool.query("SELECT key, value FROM settings WHERE user_id = $1", [authReq.user!.id]);
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
app.post("/api/db/settings", requirePostgresAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "PostgreSQL is not configured." });
  }
  try {
    const authReq = req as AuthenticatedRequest;
    const entries = Object.entries(req.body as Record<string, string>);
    const now = Date.now();
    for (const [key, value] of entries) {
      await pgPool.query(
        `INSERT INTO settings (user_id, key, value, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [authReq.user!.id, key, value, now]
      );
    }
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Error saving settings:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    return res.status(413).json({
      error: err.code === "LIMIT_FILE_SIZE" ? "图片过大，请压缩后重试" : err.message,
    });
  }
  return next(err);
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
