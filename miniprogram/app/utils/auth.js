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
      fail: reject
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
