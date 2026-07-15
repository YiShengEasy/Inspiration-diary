import type { KnowledgeNode } from "./repository.ts";

const MAX_EMBEDDING_TEXT = 4_000;
const DEFAULT_TIMEOUT_MS = 20_000;

export interface KnowledgeEmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface OpenAiEmbeddingProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface EmbeddingResponse {
  data?: Array<{ index?: number; embedding?: unknown }>;
}

export function getEmbeddingsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, "");
  return /\/embeddings$/u.test(trimmed) ? trimmed : `${trimmed}/embeddings`;
}

export function buildKnowledgeEmbeddingText(node: KnowledgeNode): string {
  return [
    `标题：${node.title}`,
    `类型：${node.entityType}`,
    node.tags.length ? `标签：${node.tags.join("、")}` : "",
    node.searchText ? `内容：${node.searchText}` : "",
  ].filter(Boolean).join("\n").replace(/\s+/gu, " ").trim().slice(0, MAX_EMBEDDING_TEXT);
}

function parseVector(value: unknown, dimensions: number): number[] {
  if (!Array.isArray(value) || value.length !== dimensions) {
    throw new Error(`Embedding response dimension mismatch; expected ${dimensions}.`);
  }
  const vector = value.map(Number);
  if (vector.some((item) => !Number.isFinite(item))) {
    throw new Error("Embedding response contains a non-finite value.");
  }
  return vector;
}

export function createOpenAiEmbeddingProvider(options: OpenAiEmbeddingProviderOptions): KnowledgeEmbeddingProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    model: options.model,
    dimensions: options.dimensions,
    async embed(texts) {
      if (texts.length === 0) return [];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(getEmbeddingsUrl(options.baseUrl), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            input: texts,
            dimensions: options.dimensions,
            encoding_format: "float",
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Embedding API returned HTTP ${response.status}.`);
        const document = await response.json() as EmbeddingResponse;
        const rows = document.data ?? [];
        if (rows.length !== texts.length) throw new Error("Embedding response count mismatch.");
        return [...rows]
          .sort((left, right) => Number(left.index ?? 0) - Number(right.index ?? 0))
          .map((row) => parseVector(row.embedding, options.dimensions));
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function serializePgVector(vector: number[]): string {
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Cannot serialize an empty or invalid embedding vector.");
  }
  return `[${vector.join(",")}]`;
}
