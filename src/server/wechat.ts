export interface WechatSession {
  openid: string;
  unionid?: string;
  sessionKey?: string;
}

export interface WechatPhone {
  phoneNumber: string;
}

export async function exchangeWechatCode(code: string): Promise<WechatSession> {
  if (process.env.WECHAT_MOCK === "true") {
    return { openid: `mock-openid-${code}`, unionid: `mock-unionid-${code}` };
  }

  const appid = process.env.WECHAT_MINI_APP_ID;
  const secret = process.env.WECHAT_MINI_APP_SECRET;
  if (!appid || !secret) {
    throw new Error("WeChat mini program credentials are not configured.");
  }

  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", appid);
  url.searchParams.set("secret", secret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const res = await fetch(url);
  const body = (await res.json()) as {
    openid?: string;
    unionid?: string;
    session_key?: string;
    errcode?: number;
    errmsg?: string;
  };
  if (!res.ok || body.errcode || !body.openid) {
    throw new Error(body.errmsg || `WeChat code exchange failed with status ${res.status}`);
  }

  return { openid: body.openid, unionid: body.unionid, sessionKey: body.session_key };
}

export async function resolveWechatPhone(phoneCode: string): Promise<WechatPhone> {
  if (process.env.WECHAT_MOCK === "true") {
    return {
      phoneNumber: phoneCode.startsWith("mock-phone-") ? phoneCode.replace("mock-phone-", "") : "13800000000",
    };
  }

  throw new Error("WeChat phone code resolution requires access_token wiring.");
}
