const { request } = require("./api");

async function refreshAccountStatus() {
  const status = await request({ url: "/api/auth/account-status" });
  const app = getApp();
  app.globalData.accountState = status.accountState;
  app.globalData.user = status.user || null;
  return status;
}

function wechatLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: async (loginRes) => {
        try {
          if (!loginRes.code) {
            throw new Error("未获取到微信登录凭证，请重试");
          }
          const result = await request({
            url: "/api/auth/wechat-login",
            method: "POST",
            data: { code: loginRes.code }
          });

          wx.setStorageSync("miniToken", result.token);
          const app = getApp();
          app.globalData.accountState = result.accountState;
          app.globalData.user = result.user || null;
          resolve(result);
        } catch (err) {
          reject(err);
        }
      },
      fail: (err) => reject(new Error((err && err.errMsg) || "微信登录失败，请重试"))
    });
  });
}

function requireRegistered() {
  const app = getApp();
  if (app.globalData.accountState === "registered") return true;

  wx.navigateTo({ url: "/pages/register-complete/index" });
  return false;
}

module.exports = { refreshAccountStatus, wechatLogin, requireRegistered };
