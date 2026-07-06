const { request } = require("./api");

function compactHeaders(headers) {
  return Object.keys(headers).reduce((result, key) => {
    const value = headers[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      result[key] = String(value).trim();
    }
    return result;
  }, {});
}

async function loadAiUploadHeaders() {
  try {
    const settings = await request({ url: "/api/db/settings" });
    const provider = settings.custom_provider || "";

    if (provider === "anthropic") {
      return compactHeaders({
        "x-provider": "anthropic",
        "x-api-key": settings.custom_anthropic_auth_token,
        "x-model-name": settings.custom_anthropic_model,
        "x-anthropic-base-url": settings.custom_anthropic_base_url
      });
    }

    if (provider === "thirdparty") {
      return compactHeaders({
        "x-provider": "gemini",
        "x-api-key": settings.custom_thirdparty_api_key,
        "x-model-name": settings.custom_thirdparty_model,
        "x-gemini-base-url": settings.custom_thirdparty_base_url,
        "x-thinking-enabled": settings.custom_thirdparty_thinking === "true" ? "true" : ""
      });
    }

    if (provider === "gemini") {
      return compactHeaders({
        "x-provider": "gemini",
        "x-api-key": settings.custom_gemini_api_key,
        "x-model-name": settings.custom_gemini_model,
        "x-gemini-base-url": settings.custom_gemini_base_url
      });
    }

    return {};
  } catch (err) {
    console.warn("Mini AI settings skipped:", err);
    return {};
  }
}

module.exports = { loadAiUploadHeaders };
