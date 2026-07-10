export interface WechatSession {
  openid: string;
  unionid?: string;
  sessionKey?: string;
}

export interface WechatPhone {
  phoneNumber: string;
}

interface WechatErrorBody {
  errcode?: number;
  errmsg?: string;
}

interface WechatAccessTokenBody extends WechatErrorBody {
  access_token?: string;
  expires_in?: number;
}

interface WechatPhoneBody extends WechatErrorBody {
  phone_info?: {
    phoneNumber?: string;
    purePhoneNumber?: string;
  };
}

export class WechatApiError extends Error {
  public readonly publicMessage: string;
  public readonly statusCode: number;
  public readonly errcode?: number;

  constructor(message: string, publicMessage: string, statusCode: number, errcode?: number) {
    super(message);
    this.name = "WechatApiError";
    this.publicMessage = publicMessage;
    this.statusCode = statusCode;
    this.errcode = errcode;
  }
}

let accessTokenCache: { token: string; refreshAt: number } | null = null;

function getWechatCredentials(): { appid: string; secret: string } {
  const appid = String(process.env.WECHAT_MINI_APP_ID || "").trim();
  const secret = String(process.env.WECHAT_MINI_APP_SECRET || "").trim();
  if (!appid || !secret) {
    throw new WechatApiError(
      "WeChat mini program credentials are not configured.",
      "微信登录配置未完成",
      503
    );
  }
  return { appid, secret };
}

function buildWechatApiError(body: WechatErrorBody, fallback: string): WechatApiError {
  const errcode = Number(body.errcode || 0);
  const detail = body.errmsg || fallback;

  if (errcode === 40029 || errcode === 40163) {
    return new WechatApiError(`WeChat credential rejected (${errcode}): ${detail}`, "微信登录凭证无效，请重试", 400, errcode);
  }
  if (errcode === 40013 || errcode === 40125) {
    return new WechatApiError(`WeChat app credentials rejected (${errcode}): ${detail}`, "微信登录配置无效", 503, errcode);
  }
  if (errcode === -1) {
    return new WechatApiError(`WeChat system busy (${errcode}): ${detail}`, "微信服务暂不可用，请稍后重试", 503, errcode);
  }

  return new WechatApiError(
    `WeChat API error${errcode ? ` (${errcode})` : ""}: ${detail}`,
    "微信服务暂不可用，请稍后重试",
    502,
    errcode || undefined
  );
}

async function fetchWechatJson<T extends WechatErrorBody>(url: URL, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(url, init);
    const body = (await res.json()) as T;
    if (!res.ok) throw buildWechatApiError(body, `HTTP ${res.status}`);
    return body;
  } catch (err: unknown) {
    if (err instanceof WechatApiError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new WechatApiError(`WeChat request failed: ${detail}`, "微信服务暂不可用，请稍后重试", 503);
  }
}

async function getWechatAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && accessTokenCache && accessTokenCache.refreshAt > Date.now()) {
    return accessTokenCache.token;
  }

  const { appid, secret } = getWechatCredentials();
  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", appid);
  url.searchParams.set("secret", secret);

  const body = await fetchWechatJson<WechatAccessTokenBody>(url);
  if ((body.errcode && body.errcode !== 0) || !body.access_token) {
    throw buildWechatApiError(body, "Access token missing");
  }

  const expiresInSeconds = Math.max(300, Number(body.expires_in || 7200));
  accessTokenCache = {
    token: body.access_token,
    refreshAt: Date.now() + Math.max(60, expiresInSeconds - 300) * 1000,
  };
  return accessTokenCache.token;
}

export async function exchangeWechatCode(code: string): Promise<WechatSession> {
  if (process.env.WECHAT_MOCK === "true") {
    return { openid: `mock-openid-${code}`, unionid: `mock-unionid-${code}` };
  }

  const { appid, secret } = getWechatCredentials();

  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", appid);
  url.searchParams.set("secret", secret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const body = await fetchWechatJson<{
    openid?: string;
    unionid?: string;
    session_key?: string;
    errcode?: number;
    errmsg?: string;
  }>(url);
  if ((body.errcode && body.errcode !== 0) || !body.openid) {
    throw buildWechatApiError(body, "OpenID missing");
  }

  return { openid: body.openid, unionid: body.unionid, sessionKey: body.session_key };
}

export async function resolveWechatPhone(phoneCode: string): Promise<WechatPhone> {
  if (process.env.WECHAT_MOCK === "true") {
    return {
      phoneNumber: phoneCode.startsWith("mock-phone-") ? phoneCode.replace("mock-phone-", "") : "13800000000",
    };
  }

  let accessToken = await getWechatAccessToken();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const url = new URL("https://api.weixin.qq.com/wxa/business/getuserphonenumber");
    url.searchParams.set("access_token", accessToken);
    const body = await fetchWechatJson<WechatPhoneBody>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: phoneCode }),
    });

    const tokenExpired = body.errcode === 40001 || body.errcode === 40014 || body.errcode === 42001;
    if (tokenExpired && attempt === 0) {
      accessTokenCache = null;
      accessToken = await getWechatAccessToken(true);
      continue;
    }
    if (body.errcode && body.errcode !== 0) {
      throw buildWechatApiError(body, "Phone number exchange failed");
    }

    const phoneNumber = body.phone_info?.phoneNumber || body.phone_info?.purePhoneNumber || "";
    if (!phoneNumber) {
      throw new WechatApiError("WeChat phone response did not include a phone number.", "未获取到微信手机号，请手动填写", 502);
    }
    return { phoneNumber };
  }

  throw new WechatApiError("WeChat access token refresh failed.", "微信服务暂不可用，请稍后重试", 503);
}
