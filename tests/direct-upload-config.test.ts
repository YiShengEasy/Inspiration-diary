import assert from "node:assert/strict";
import test from "node:test";
import { getRuntimeConfig, validateRuntimeConfig } from "../src/server/runtimeConfig";

const DIRECT_UPLOAD_ENV_NAMES = [
  "APP_ENV",
  "DEPLOYMENT_PROFILE",
  "DATABASE_TYPE",
  "DATABASE_URL",
  "AUTH_COOKIE_SECURE",
  "IMAGE_STORAGE_PROVIDER",
  "VIDEO_STORAGE_PROVIDER",
  "IMAGE_ASSET_STORAGE_PROVIDER",
  "OSS_REGION",
  "OSS_BUCKET",
  "OSS_ENDPOINT",
  "OSS_ACCESS_KEY_ID",
  "OSS_ACCESS_KEY_SECRET",
  "OSS_PUBLIC_BASE_URL",
  "OSS_STS_ROLE_ARN",
  "THIRD_PARTY_BASE_URL",
  "THIRD_PARTY_API_KEY",
  "THIRD_PARTY_MODEL",
  "WEB_DIRECT_OSS_UPLOAD_MODE",
  "UPLOAD_AUTH_TTL_SECONDS",
  "UPLOAD_VIDEO_STS_TTL_SECONDS",
  "UPLOAD_ACTIVE_SESSIONS_PER_USER",
  "UPLOAD_AUTHORIZATIONS_PER_MINUTE",
  "UPLOAD_MAX_IMAGE_BYTES",
  "UPLOAD_MAX_DOCUMENT_BYTES",
  "UPLOAD_MAX_VIDEO_BYTES",
  "UPLOAD_MAX_ANALYSIS_BYTES",
] as const;

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const name of DIRECT_UPLOAD_ENV_NAMES) {
    previous.set(name, process.env[name]);
    delete process.env[name];
  }

  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function productionOssEnv(mode: "off" | "admin" | "all"): Record<string, string> {
  return {
    APP_ENV: "production",
    DEPLOYMENT_PROFILE: "production",
    DATABASE_TYPE: "postgres",
    DATABASE_URL: "postgresql://example.invalid/notebook",
    AUTH_COOKIE_SECURE: "true",
    IMAGE_STORAGE_PROVIDER: "oss",
    VIDEO_STORAGE_PROVIDER: "oss",
    IMAGE_ASSET_STORAGE_PROVIDER: "oss",
    OSS_REGION: "oss-cn-hangzhou",
    OSS_BUCKET: "private-bucket",
    OSS_ENDPOINT: "https://oss-cn-hangzhou.aliyuncs.com",
    OSS_ACCESS_KEY_ID: "test-access-key-id",
    OSS_ACCESS_KEY_SECRET: "test-access-key-secret",
    OSS_PUBLIC_BASE_URL: "https://private-bucket.oss-cn-hangzhou.aliyuncs.com",
    THIRD_PARTY_BASE_URL: "https://example.invalid/v1",
    THIRD_PARTY_API_KEY: "test-api-key",
    THIRD_PARTY_MODEL: "test-model",
    WEB_DIRECT_OSS_UPLOAD_MODE: mode,
  };
}

test("keeps private OSS direct upload disabled with conservative defaults", () => {
  withEnv({}, () => {
    assert.deepEqual(getRuntimeConfig().directUpload, {
      mode: "off",
      stsRoleArn: "",
      authorizationTtlSeconds: 900,
      videoStsTtlSeconds: 900,
      activeSessionsPerUser: 5,
      authorizationsPerMinute: 20,
      maxImageBytes: 26_214_400,
      maxDocumentBytes: 20_971_520,
      maxVideoBytes: 104_857_600,
      maxAnalysisBytes: 5_242_880,
    });
  });
});

test("parses each supported direct upload audience", () => {
  for (const mode of ["off", "admin", "all"] as const) {
    withEnv({ WEB_DIRECT_OSS_UPLOAD_MODE: mode }, () => {
      assert.equal(getRuntimeConfig().directUpload.mode, mode);
    });
  }
});

test("reports an invalid direct upload audience instead of silently enabling it", () => {
  withEnv({ WEB_DIRECT_OSS_UPLOAD_MODE: "everyone" }, () => {
    const config = getRuntimeConfig();
    const errors = validateRuntimeConfig(config);
    assert.equal(config.directUpload.mode, "off");
    assert.ok(errors.includes("WEB_DIRECT_OSS_UPLOAD_MODE must be off, admin, or all."));
  });
});

test("parses configured positive integer limits", () => {
  withEnv(
    {
      UPLOAD_AUTH_TTL_SECONDS: "600",
      UPLOAD_VIDEO_STS_TTL_SECONDS: "720",
      UPLOAD_ACTIVE_SESSIONS_PER_USER: "3",
      UPLOAD_AUTHORIZATIONS_PER_MINUTE: "12",
      UPLOAD_MAX_IMAGE_BYTES: "1000",
      UPLOAD_MAX_DOCUMENT_BYTES: "2000",
      UPLOAD_MAX_VIDEO_BYTES: "3000",
      UPLOAD_MAX_ANALYSIS_BYTES: "4000",
    },
    () => {
      const config = getRuntimeConfig().directUpload;
      assert.deepEqual(
        [
          config.authorizationTtlSeconds,
          config.videoStsTtlSeconds,
          config.activeSessionsPerUser,
          config.authorizationsPerMinute,
          config.maxImageBytes,
          config.maxDocumentBytes,
          config.maxVideoBytes,
          config.maxAnalysisBytes,
        ],
        [600, 720, 3, 12, 1000, 2000, 3000, 4000],
      );
    },
  );
});

test("requires every configured direct upload limit to be a positive integer", () => {
  const names = [
    "UPLOAD_AUTH_TTL_SECONDS",
    "UPLOAD_VIDEO_STS_TTL_SECONDS",
    "UPLOAD_ACTIVE_SESSIONS_PER_USER",
    "UPLOAD_AUTHORIZATIONS_PER_MINUTE",
    "UPLOAD_MAX_IMAGE_BYTES",
    "UPLOAD_MAX_DOCUMENT_BYTES",
    "UPLOAD_MAX_VIDEO_BYTES",
    "UPLOAD_MAX_ANALYSIS_BYTES",
  ] as const;

  for (const name of names) {
    for (const value of ["0", "-1", "1.5", "invalid"]) {
      withEnv({ [name]: value }, () => {
        const errors = validateRuntimeConfig(getRuntimeConfig());
        assert.ok(errors.includes(`${name} must be a positive integer.`), `${name} accepted ${value}`);
      });
    }
  }
});

test("caps signed upload and video STS grants at fifteen minutes", () => {
  withEnv(
    {
      UPLOAD_AUTH_TTL_SECONDS: "901",
      UPLOAD_VIDEO_STS_TTL_SECONDS: "1200",
    },
    () => {
      const errors = validateRuntimeConfig(getRuntimeConfig());
      assert.ok(errors.includes("UPLOAD_AUTH_TTL_SECONDS must not exceed 900 seconds."));
      assert.ok(errors.includes("UPLOAD_VIDEO_STS_TTL_SECONDS must not exceed 900 seconds."));
    },
  );
});

test("requires an STS role when direct upload is enabled", () => {
  for (const mode of ["admin", "all"] as const) {
    withEnv(productionOssEnv(mode), () => {
      const errors = validateRuntimeConfig(getRuntimeConfig());
      assert.ok(
        errors.includes("OSS_STS_ROLE_ARN is required when direct upload is enabled."),
      );
    });
  }
});

test("does not require an STS role while direct upload is off", () => {
  withEnv(productionOssEnv("off"), () => {
    const errors = validateRuntimeConfig(getRuntimeConfig());
    assert.ok(!errors.some((error) => error.startsWith("OSS_STS_ROLE_ARN")));
  });
});

test("requires PostgreSQL, OSS configuration, and STS when enabled locally", () => {
  withEnv({ WEB_DIRECT_OSS_UPLOAD_MODE: "admin" }, () => {
    const errors = validateRuntimeConfig(getRuntimeConfig());
    assert.ok(errors.includes("DATABASE_TYPE must be postgres when direct upload is enabled."));
    assert.ok(errors.includes("OSS_STS_ROLE_ARN is required when direct upload is enabled."));
    assert.ok(errors.includes("OSS_REGION is required when any storage provider is oss."));
  });
});
