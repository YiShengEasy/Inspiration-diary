import dotenv from "dotenv";
import { getRuntimeConfig, validateRuntimeConfig } from "../src/server/runtimeConfig";

const envFile = process.argv[2] || ".env.local";
dotenv.config({ path: envFile });

if (!process.env.APP_ENV) {
  if (envFile.includes("production")) {
    process.env.APP_ENV = "production";
  } else if (envFile.includes("local")) {
    process.env.APP_ENV = "local";
  }
}

const config = getRuntimeConfig();
const errors = validateRuntimeConfig(config);

if (errors.length > 0) {
  console.error(`Runtime config validation failed for ${envFile}:`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Runtime config OK for ${envFile}`);
console.log(
  JSON.stringify(
    {
      appEnv: config.appEnv,
      deploymentProfile: config.deploymentProfile,
      databaseType: config.databaseType,
      primaryImageStorageProvider: config.primaryImageStorageProvider,
      videoStorageProvider: config.videoStorageProvider,
      imageAssetStorageProvider: config.imageAssetStorageProvider,
      mediaDeliveryMode: config.mediaDeliveryMode,
      directUploadMode: config.directUpload.mode,
      directUploadLimits: {
        authorizationTtlSeconds: config.directUpload.authorizationTtlSeconds,
        videoStsTtlSeconds: config.directUpload.videoStsTtlSeconds,
        activeSessionsPerUser: config.directUpload.activeSessionsPerUser,
        authorizationsPerMinute: config.directUpload.authorizationsPerMinute,
        maxImageBytes: config.directUpload.maxImageBytes,
        maxDocumentBytes: config.directUpload.maxDocumentBytes,
        maxVideoBytes: config.directUpload.maxVideoBytes,
        maxAnalysisBytes: config.directUpload.maxAnalysisBytes,
      },
      authCookieSecure: config.authCookieSecure,
    },
    null,
    2,
  ),
);
