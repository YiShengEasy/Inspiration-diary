const { request } = require("../../utils/api");

Page({
  data: {
    mode: "link",
    identifier: "",
    password: "",
    phone: "",
    submitting: false
  },

  selectMode(event) {
    this.setData({
      mode: event.currentTarget.dataset.mode === "register" ? "register" : "link",
      password: ""
    });
  },

  async getPhoneNumber(event) {
    const code = event.detail && event.detail.code;
    if (!code) {
      wx.showToast({ title: "未授权手机号，请手动填写", icon: "none" });
      return;
    }

    try {
      const result = await request({
        url: "/api/auth/wechat-phone",
        method: "POST",
        data: { code }
      });
      this.setData({
        identifier: result.phone || "",
        phone: result.phone || ""
      });
      wx.showToast({ title: "手机号已绑定", icon: "success" });
    } catch (err) {
      wx.showToast({ title: err.message || "手机号授权失败", icon: "none" });
    }
  },

  onIdentifierInput(event) {
    this.setData({ identifier: event.detail.value });
  },

  onPasswordInput(event) {
    this.setData({ password: event.detail.value });
  },

  async submit() {
    const identifier = this.data.identifier.trim();
    const password = this.data.password;

    if (!identifier) {
      wx.showToast({ title: "请输入手机号或邮箱", icon: "none" });
      return;
    }

    if (password.length < 8) {
      wx.showToast({ title: "密码至少 8 位", icon: "none" });
      return;
    }

    this.setData({ submitting: true });

    try {
      const isLinkMode = this.data.mode === "link";
      const result = await request({
        url: isLinkMode ? "/api/auth/link-existing-account" : "/api/auth/complete-registration",
        method: "POST",
        data: { identifier, password }
      });
      const app = getApp();
      app.globalData.accountState = result.accountState || "registered";
      app.globalData.user = result.user || null;
      wx.showToast({ title: isLinkMode ? "关联成功" : "注册完成", icon: "success" });
      setTimeout(() => {
        wx.navigateBack();
      }, 500);
    } catch (err) {
      wx.showToast({ title: err.message || (this.data.mode === "link" ? "关联失败" : "注册失败"), icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
