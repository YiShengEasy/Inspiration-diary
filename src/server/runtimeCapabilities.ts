import type { RuntimeConfig } from "./runtimeConfig.ts";

export interface RuntimeCapabilities {
  knowledgeBase: boolean;
  knowledgeAiRelations: boolean;
  directUpload: boolean;
}

/**
 * Builds the complete browser-safe capability payload. Keep this return type
 * boolean-only so storage, provider, path, and credential configuration cannot
 * be exposed accidentally when the authenticated route is mounted.
 */
export function getRuntimeCapabilities(config: RuntimeConfig): RuntimeCapabilities {
  return {
    knowledgeBase: config.knowledgeBaseEnabled,
    knowledgeAiRelations: config.knowledgeAiRelationsEnabled,
    directUpload: config.directUpload.mode !== "off",
  };
}
