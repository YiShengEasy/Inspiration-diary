import assert from "node:assert/strict";
import { test } from "node:test";

import { getRuntimeCapabilities } from "../src/server/runtimeCapabilities.ts";
import { getRuntimeConfig, validateRuntimeConfig } from "../src/server/runtimeConfig.ts";

const KNOWLEDGE_ENV = [
  "KNOWLEDGE_BASE_ENABLED",
  "KNOWLEDGE_AI_RELATIONS_ENABLED",
  "KNOWLEDGE_VECTOR_ENABLED",
  "KNOWLEDGE_EMBEDDING_BASE_URL",
  "KNOWLEDGE_EMBEDDING_API_KEY",
  "KNOWLEDGE_EMBEDDING_MODEL",
  "KNOWLEDGE_EMBEDDING_DIMENSIONS",
] as const;

function withKnowledgeEnv(
  values: Partial<Record<(typeof KNOWLEDGE_ENV)[number], string>>,
  run: () => void,
): void {
  const previous = new Map<string, string | undefined>();
  for (const name of KNOWLEDGE_ENV) {
    previous.set(name, process.env[name]);
    delete process.env[name];
  }
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value !== undefined) process.env[name] = value;
    }
    run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("keeps the no-AI knowledge core disabled by default", () => {
  withKnowledgeEnv({}, () => {
    const config = getRuntimeConfig();
    assert.equal(config.knowledgeBaseEnabled, false);
    assert.equal(config.knowledgeAiRelationsEnabled, false);
    assert.equal(config.knowledgeVector.enabled, false);
  });
});

test("requires an explicit embedding model when vector recall is enabled", () => {
  withKnowledgeEnv({ KNOWLEDGE_VECTOR_ENABLED: "true" }, () => {
    const config = getRuntimeConfig();
    const errors = validateRuntimeConfig(config).filter((error) => error.startsWith("KNOWLEDGE_"));
    assert.equal(errors.includes("KNOWLEDGE_EMBEDDING_MODEL is required when KNOWLEDGE_VECTOR_ENABLED=true."), true);
  });

  withKnowledgeEnv({
    KNOWLEDGE_VECTOR_ENABLED: "true",
    KNOWLEDGE_EMBEDDING_BASE_URL: "https://example.test/v1",
    KNOWLEDGE_EMBEDDING_API_KEY: "secret",
    KNOWLEDGE_EMBEDDING_MODEL: "embedding-model",
    KNOWLEDGE_EMBEDDING_DIMENSIONS: "768",
  }, () => {
    const config = getRuntimeConfig();
    assert.deepEqual(config.knowledgeVector, {
      enabled: true,
      baseUrl: "https://example.test/v1",
      apiKey: "secret",
      model: "embedding-model",
      dimensions: 768,
    });
    assert.deepEqual(validateRuntimeConfig(config).filter((error) => error.startsWith("KNOWLEDGE_")), []);
  });
});

test("parses only explicit boolean knowledge flags", () => {
  withKnowledgeEnv(
    { KNOWLEDGE_BASE_ENABLED: "true", KNOWLEDGE_AI_RELATIONS_ENABLED: "false" },
    () => {
      const config = getRuntimeConfig();
      assert.equal(config.knowledgeBaseEnabled, true);
      assert.equal(config.knowledgeAiRelationsEnabled, false);
      assert.deepEqual(
        validateRuntimeConfig(config).filter((error) => error.startsWith("KNOWLEDGE_")),
        [],
      );
    },
  );

  withKnowledgeEnv({ KNOWLEDGE_BASE_ENABLED: "enabled" }, () => {
    const config = getRuntimeConfig();
    assert.equal(config.knowledgeBaseEnabled, false);
    assert.deepEqual(
      validateRuntimeConfig(config).filter((error) => error.startsWith("KNOWLEDGE_")),
      ["KNOWLEDGE_BASE_ENABLED must be true or false."],
    );
  });
});

test("exposes a boolean-only browser capability payload", () => {
  withKnowledgeEnv(
    { KNOWLEDGE_BASE_ENABLED: "true", KNOWLEDGE_AI_RELATIONS_ENABLED: "false" },
    () => {
      const config = getRuntimeConfig();
      const capabilities = getRuntimeCapabilities({
        ...config,
        databaseUrl: "postgresql://secret-database",
        oss: { ...config.oss, accessKeyId: "secret-access-key" },
      });
      assert.deepEqual(capabilities, {
        knowledgeBase: true,
        knowledgeAiRelations: false,
        directUpload: false,
      });
      assert.deepEqual(Object.keys(capabilities).sort(), [
        "directUpload",
        "knowledgeAiRelations",
        "knowledgeBase",
      ]);
      assert.equal(JSON.stringify(capabilities).includes("secret-database"), false);
      assert.equal(JSON.stringify(capabilities).includes("secret-access-key"), false);
    },
  );
});
