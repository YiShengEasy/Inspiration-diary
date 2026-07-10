import type { ObjectStorageProvider } from "./storage/types";
import type { MediaDeliveryMode } from "./runtimeConfig";

export type ImageVariant = "thumb-240" | "thumb-480" | "detail-1280" | "original";

export interface MediaProcesses {
  "thumb-240": string;
  "thumb-480": string;
  "detail-1280": string;
}

export function imageProcessFor(variant: ImageVariant, processes: MediaProcesses): string | undefined {
  if (variant === "original") return undefined;
  return processes[variant];
}

interface RedirectResponse {
  redirect(status: number, url: string): unknown;
}

interface DeliverOssObjectInput {
  mode: MediaDeliveryMode;
  storage: Pick<ObjectStorageProvider, "getSignedReadUrl">;
  storageKey: string;
  process?: string;
  response: RedirectResponse;
  proxy(signedUrl: string): unknown;
}

export async function deliverOssObject(input: DeliverOssObjectInput): Promise<unknown> {
  const signedUrl = await input.storage.getSignedReadUrl(
    input.storageKey,
    input.process ? { process: input.process } : undefined
  );
  if (input.mode === "oss") {
    return input.response.redirect(302, signedUrl);
  }
  return input.proxy(signedUrl);
}
