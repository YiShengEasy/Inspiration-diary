import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildKnowledgeEmbeddingText,
  createOpenAiEmbeddingProvider,
  getEmbeddingsUrl,
  serializePgVector,
} from "../src/server/knowledge/embeddings.ts";
import type { KnowledgeNode } from "../src/server/knowledge/repository.ts";

const NODE: KnowledgeNode = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  entityType: "card",
  entityId: "card-1",
  slug: "blue-particles",
  title: "蓝色粒子",
  tags: ["粒子", "蓝色"],
  properties: {},
  searchText: "流动的蓝色粒子视觉",
  isActive: true,
  autoAdded: false,
  contentFingerprint: "fingerprint",
  revision: 1,
  deletedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

test("builds compact knowledge embedding text and normalizes embedding URLs", () => {
  assert.equal(getEmbeddingsUrl("https://example.test/v1/"), "https://example.test/v1/embeddings");
  assert.equal(getEmbeddingsUrl("https://example.test/v1/embeddings"), "https://example.test/v1/embeddings");
  assert.match(buildKnowledgeEmbeddingText(NODE), /标题：蓝色粒子 类型：card 标签：粒子、蓝色 内容：流动的蓝色粒子视觉/u);
  assert.equal(serializePgVector([0.1, -0.2]), "[0.1,-0.2]");
});

test("validates and restores embedding response order", async () => {
  let requestBody: Record<string, unknown> | null = null;
  const provider = createOpenAiEmbeddingProvider({
    baseUrl: "https://example.test/v1",
    apiKey: "secret",
    model: "embedding-model",
    dimensions: 2,
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        data: [
          { index: 1, embedding: [0.3, 0.4] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
      }), { status: 200 });
    },
  });

  assert.deepEqual(await provider.embed(["first", "second"]), [[0.1, 0.2], [0.3, 0.4]]);
  assert.deepEqual(requestBody, {
    model: "embedding-model",
    input: ["first", "second"],
    dimensions: 2,
    encoding_format: "float",
  });
});

test("rejects malformed embedding dimensions", async () => {
  const provider = createOpenAiEmbeddingProvider({
    baseUrl: "https://example.test/v1",
    apiKey: "secret",
    model: "embedding-model",
    dimensions: 2,
    fetchImpl: async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.1] }] }), { status: 200 }),
  });
  await assert.rejects(provider.embed(["first"]), /dimension mismatch/u);
});
