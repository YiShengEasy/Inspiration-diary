export type AppEnv = "local" | "production" | "test";
export type DeploymentProfile = "local-docker" | "production";
export type DatabaseType = "firestore" | "postgres";
export type PrimaryImageStorageProvider = "photoprism" | "oss";
export type AssetStorageProvider = "local" | "oss";
export type MediaDeliveryMode = "proxy" | "oss";

export interface RuntimeConfig {
  appEnv: AppEnv;
  deploymentProfile: DeploymentProfile;
  port: number;
  databaseType: DatabaseType;
  databaseUrl: string;
  databaseSsl: boolean;
  authCookieSecure: boolean;
  primaryImageStorageProvider: PrimaryImageStorageProvider;
  videoStorageProvider: AssetStorageProvider;
  imageAssetStorageProvider: AssetStorageProvider;
  mediaDeliveryMode: MediaDeliveryMode;
  photoPrism: {
    internalUrl: string;
    publicUrl: string;
    username: string;
    password: string;
  };
  localStorage: {
    videoUploadRoot: string;
    imageAssetUploadRoot: string;
  };
  oss: {
    region: string;
    bucket: string;
    endpoint: string;
    accessKeyId: string;
    accessKeySecret: string;
    publicBaseUrl: string;
    signedUrlTtlSeconds: number;
  };
  thirdPartyAi: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
}

function readEnv(name: string): string {
  return process.env[name]?.trim() || "";
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = readEnv(name).toLowerCase();
  if (!value) return fallback;
  return value === "true" || value === "1" || value === "yes";
}

function readNumber(name: string, fallback: number): number {
  const parsed = Number.parseInt(readEnv(name), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAppEnv(value: string): AppEnv {
  if (value === "production" || value === "test") return value;
  return "local";
}

function parseDeploymentProfile(value: string, appEnv: AppEnv): DeploymentProfile {
  if (value === "production") return "production";
  if (value === "local-docker") return "local-docker";
  return appEnv === "production" ? "production" : "local-docker";
}

function parseDatabaseType(value: string): DatabaseType {
  return value === "postgres" ? "postgres" : "firestore";
}

function parsePrimaryImageStorageProvider(value: string): PrimaryImageStorageProvider {
  return value === "oss" ? "oss" : "photoprism";
}

function parseAssetStorageProvider(value: string): AssetStorageProvider {
  return value === "oss" ? "oss" : "local";
}

function parseMediaDeliveryMode(value: string): MediaDeliveryMode {
  return value === "oss" ? "oss" : "proxy";
}

export function getRuntimeConfig(): RuntimeConfig {
  const appEnv = parseAppEnv(readEnv("APP_ENV"));
  const deploymentProfile = parseDeploymentProfile(readEnv("DEPLOYMENT_PROFILE"), appEnv);
  const primaryImageStorageProvider = parsePrimaryImageStorageProvider(readEnv("IMAGE_STORAGE_PROVIDER"));
  const videoStorageProvider = parseAssetStorageProvider(readEnv("VIDEO_STORAGE_PROVIDER"));
  const imageAssetStorageProvider = parseAssetStorageProvider(readEnv("IMAGE_ASSET_STORAGE_PROVIDER"));

  return {
    appEnv,
    deploymentProfile,
    port: readNumber("PORT", 3000),
    databaseType: parseDatabaseType(readEnv("DATABASE_TYPE")),
    databaseUrl: readEnv("DATABASE_URL") || "postgresql://postgres:postgres@localhost:5432/notebook",
    databaseSsl: readBoolean("DATABASE_SSL", false),
    authCookieSecure: readBoolean("AUTH_COOKIE_SECURE", appEnv === "production"),
    primaryImageStorageProvider,
    videoStorageProvider,
    imageAssetStorageProvider,
    mediaDeliveryMode: parseMediaDeliveryMode(readEnv("MEDIA_DELIVERY_MODE")),
    photoPrism: {
      internalUrl: readEnv("PHOTOPRISM_INTERNAL_URL"),
      publicUrl: readEnv("PHOTOPRISM_PUBLIC_URL") || readEnv("PHOTOPRISM_INTERNAL_URL"),
      username: readEnv("PHOTOPRISM_USERNAME"),
      password: readEnv("PHOTOPRISM_PASSWORD"),
    },
    localStorage: {
      videoUploadRoot: readEnv("VIDEO_UPLOAD_ROOT") || "uploads/videos",
      imageAssetUploadRoot: readEnv("IMAGE_ASSET_UPLOAD_ROOT") || "uploads/images",
    },
    oss: {
      region: readEnv("OSS_REGION"),
      bucket: readEnv("OSS_BUCKET"),
      endpoint: readEnv("OSS_ENDPOINT"),
      accessKeyId: readEnv("OSS_ACCESS_KEY_ID"),
      accessKeySecret: readEnv("OSS_ACCESS_KEY_SECRET"),
      publicBaseUrl: readEnv("OSS_PUBLIC_BASE_URL"),
      signedUrlTtlSeconds: readNumber("OSS_SIGNED_URL_TTL_SECONDS", 900),
    },
    thirdPartyAi: {
      baseUrl: readEnv("THIRD_PARTY_BASE_URL") || readEnv("OPENAI_COMPATIBLE_BASE_URL"),
      apiKey: readEnv("THIRD_PARTY_API_KEY") || readEnv("OPENAI_API_KEY"),
      model: readEnv("THIRD_PARTY_MODEL") || "doubao-seed-2.0-code",
    },
  };
}

export function validateRuntimeConfig(config = getRuntimeConfig()): string[] {
  const errors: string[] = [];
  const mediaDeliveryMode = readEnv("MEDIA_DELIVERY_MODE");

  if (mediaDeliveryMode && mediaDeliveryMode !== "proxy" && mediaDeliveryMode !== "oss") {
    errors.push("MEDIA_DELIVERY_MODE must be proxy or oss.");
  }

  if (config.databaseType === "postgres" && !config.databaseUrl) {
    errors.push("DATABASE_URL is required when DATABASE_TYPE=postgres.");
  }

  if (config.primaryImageStorageProvider === "photoprism") {
    if (!config.photoPrism.internalUrl) errors.push("PHOTOPRISM_INTERNAL_URL is required when IMAGE_STORAGE_PROVIDER=photoprism.");
    if (!config.photoPrism.publicUrl) errors.push("PHOTOPRISM_PUBLIC_URL is required when IMAGE_STORAGE_PROVIDER=photoprism.");
    if (!config.photoPrism.username) errors.push("PHOTOPRISM_USERNAME is required when IMAGE_STORAGE_PROVIDER=photoprism.");
    if (!config.photoPrism.password) errors.push("PHOTOPRISM_PASSWORD is required when IMAGE_STORAGE_PROVIDER=photoprism.");
  }

  const requiresOss =
    config.primaryImageStorageProvider === "oss" ||
    config.videoStorageProvider === "oss" ||
    config.imageAssetStorageProvider === "oss";

  if (requiresOss) {
    if (!config.oss.region) errors.push("OSS_REGION is required when any storage provider is oss.");
    if (!config.oss.bucket) errors.push("OSS_BUCKET is required when any storage provider is oss.");
    if (!config.oss.endpoint) errors.push("OSS_ENDPOINT is required when any storage provider is oss.");
    if (!config.oss.accessKeyId) errors.push("OSS_ACCESS_KEY_ID is required when any storage provider is oss.");
    if (!config.oss.accessKeySecret) errors.push("OSS_ACCESS_KEY_SECRET is required when any storage provider is oss.");
    if (!config.oss.publicBaseUrl) errors.push("OSS_PUBLIC_BASE_URL is required when any storage provider is oss.");
  }

  if (config.appEnv === "production") {
    if (config.authCookieSecure !== true && readEnv("ALLOW_INSECURE_COOKIE") !== "true") {
      errors.push("AUTH_COOKIE_SECURE must be true in production unless ALLOW_INSECURE_COOKIE=true is set for temporary HTTP testing.");
    }
    if (config.databaseType !== "postgres") errors.push("DATABASE_TYPE must be postgres in production.");
  }

  if (config.deploymentProfile === "production") {
    if (config.appEnv !== "production") errors.push("APP_ENV must be production when DEPLOYMENT_PROFILE=production.");
    if (config.primaryImageStorageProvider !== "oss") errors.push("IMAGE_STORAGE_PROVIDER must be oss when DEPLOYMENT_PROFILE=production.");
    if (config.videoStorageProvider !== "oss") errors.push("VIDEO_STORAGE_PROVIDER must be oss when DEPLOYMENT_PROFILE=production.");
    if (config.imageAssetStorageProvider !== "oss") errors.push("IMAGE_ASSET_STORAGE_PROVIDER must be oss when DEPLOYMENT_PROFILE=production.");
    if (!config.thirdPartyAi.baseUrl) errors.push("THIRD_PARTY_BASE_URL is required when DEPLOYMENT_PROFILE=production.");
    if (!config.thirdPartyAi.apiKey) errors.push("THIRD_PARTY_API_KEY is required when DEPLOYMENT_PROFILE=production.");
    if (!config.thirdPartyAi.model) errors.push("THIRD_PARTY_MODEL is required when DEPLOYMENT_PROFILE=production.");
  }

  if (config.deploymentProfile === "local-docker") {
    if (config.appEnv === "production") errors.push("APP_ENV must not be production when DEPLOYMENT_PROFILE=local-docker.");
    if (config.authCookieSecure !== false) errors.push("AUTH_COOKIE_SECURE must be false when DEPLOYMENT_PROFILE=local-docker.");
  }

  return errors;
}
