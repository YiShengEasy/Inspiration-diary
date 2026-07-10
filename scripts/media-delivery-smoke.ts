import assert from "node:assert/strict";
import { deliverOssObject, imageProcessFor, type MediaProcesses } from "../src/server/mediaDelivery";
import { getRuntimeConfig, validateRuntimeConfig } from "../src/server/runtimeConfig";
import { createOssStorageProvider } from "../src/server/storage/ossStorage";

const processes: MediaProcesses = {
  "thumb-240": "process-thumb-240",
  "thumb-480": "process-thumb-480",
  "detail-1280": "process-detail-1280",
};

assert.equal(imageProcessFor("thumb-240", processes), "process-thumb-240");
assert.equal(imageProcessFor("thumb-480", processes), "process-thumb-480");
assert.equal(imageProcessFor("detail-1280", processes), "process-detail-1280");
assert.equal(imageProcessFor("original", processes), undefined);

const signedRequests: Array<{ storageKey: string; process?: string }> = [];
const storage = {
  async getSignedReadUrl(storageKey: string, options?: { process?: string }) {
    signedRequests.push({ storageKey, process: options?.process });
    return `https://media.example.test/${storageKey}?signature=test`;
  },
};

let proxiedUrl = "";
await deliverOssObject({
  mode: "proxy",
  storage,
  storageKey: "images/example.jpg",
  process: processes["thumb-480"],
  response: { redirect: () => assert.fail("proxy mode must not redirect") },
  proxy: (url) => {
    proxiedUrl = url;
    return url;
  },
});
assert.match(proxiedUrl, /^https:\/\/media\.example\.test\//);

let redirectStatus = 0;
let redirectUrl = "";
await deliverOssObject({
  mode: "oss",
  storage,
  storageKey: "videos/example.mp4",
  response: {
    redirect(status, url) {
      redirectStatus = status;
      redirectUrl = url;
      return url;
    },
  },
  proxy: () => assert.fail("oss mode must not proxy"),
});
assert.equal(redirectStatus, 302);
assert.match(redirectUrl, /^https:\/\/media\.example\.test\//);
assert.deepEqual(signedRequests, [
  { storageKey: "images/example.jpg", process: "process-thumb-480" },
  { storageKey: "videos/example.mp4", process: undefined },
]);

const baseConfig = getRuntimeConfig();
const ossStorage = createOssStorageProvider({
  ...baseConfig,
  oss: {
    region: "oss-cn-hangzhou",
    bucket: "media-smoke-bucket",
    endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
    accessKeyId: "fake-access-key-id",
    accessKeySecret: "fake-access-key-secret",
    publicBaseUrl: "https://media-smoke-bucket.oss-cn-hangzhou.aliyuncs.com",
    signedUrlTtlSeconds: 900,
  },
});
const processedUrl = new URL(await ossStorage.getSignedReadUrl("images/example.jpg", { process: processes["detail-1280"] }));
assert.equal(processedUrl.searchParams.get("x-oss-process"), processes["detail-1280"]);
assert.equal(processedUrl.protocol, "https:");

const previousMode = process.env.MEDIA_DELIVERY_MODE;
process.env.MEDIA_DELIVERY_MODE = "invalid";
assert.ok(validateRuntimeConfig(getRuntimeConfig()).includes("MEDIA_DELIVERY_MODE must be proxy or oss."));
if (previousMode === undefined) delete process.env.MEDIA_DELIVERY_MODE;
else process.env.MEDIA_DELIVERY_MODE = previousMode;

console.log("Media delivery smoke passed");
