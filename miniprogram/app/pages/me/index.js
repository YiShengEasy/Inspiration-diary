const { refreshAccountStatus, wechatLogin } = require("../../utils/auth");
const { request } = require("../../utils/api");

const EMPTY_STATS = {
  inspirationCount: 0,
  weekRecordCount: 0,
  toolUsageCount: 0
};

function buildProfile(accountState, user) {
  if (accountState === "guest") {
    return {
      name: "未登录",
      description: "登录并注册后同步灵感和原图",
      avatarText: "灵"
    };
  }

  if (accountState === "wechat_logged_in_unregistered") {
    return {
      name: "微信用户",
      description: "完成注册后可在 Web 端继续整理灵感",
      avatarText: "微"
    };
  }

  const name = (user && (user.displayName || user.phone || user.email)) || "灵感用户";
  return {
    name,
    description: "把每天的视觉灵感留成一本册子",
    avatarText: name.slice(0, 1).toUpperCase()
  };
}

Page({
  data: {
    accountState: "guest",
    user: null,
    profile: buildProfile("guest", null),
    stats: EMPTY_STATS,
    loading: false,
    debugLoginOpen: false,
    debugIdentifier: "",
    debugPassword: "",
    debugLoading: false,
    menuRows: [
      { title: "草稿", desc: "工具处理未保存内容" },
      { title: "本地缓存", desc: "清理预览和临时图" },
      { title: "灵感日记", desc: "查看已保存的每日灵感" },
      { title: "工具作品", desc: "管理工具生成的作品" },
      { title: "收藏", desc: "快速回看重点内容" },
      { title: "隐私", desc: "账号与数据保护" },
      { title: "关于和版本", desc: "当前小程序信息" }
    ]
  },

  async onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 2 });

    await this.load();
  },

  async load() {
    this.setData({ loading: true });

    try {
      const status = await refreshAccountStatus();
      const accountState = status.accountState || "guest";
      const user = status.user || null;
      const nextData = {
        accountState,
        user,
        profile: buildProfile(accountState, user),
        stats: EMPTY_STATS
      };

      if (accountState === "registered") {
        const me = await request({ url: "/api/miniprogram/me" });
        const meUser = me.user || user;
        nextData.user = meUser;
        nextData.profile = buildProfile(accountState, meUser);
        nextData.stats = me.stats || EMPTY_STATS;
      }

      this.setData(nextData);
    } catch (err) {
      wx.showToast({ title: err.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async login() {
    try {
      await wechatLogin();
      await this.load();
    } catch (err) {
      wx.showToast({ title: err.message || "微信登录失败", icon: "none" });
    }
  },

  toggleDebugLogin() {
    this.setData({ debugLoginOpen: !this.data.debugLoginOpen });
  },

  onDebugIdentifierInput(event) {
    this.setData({ debugIdentifier: event.detail.value });
  },

  onDebugPasswordInput(event) {
    this.setData({ debugPassword: event.detail.value });
  },

  async debugPasswordLogin() {
    const identifier = this.data.debugIdentifier.trim();
    const password = this.data.debugPassword;

    if (!identifier || !password) {
      wx.showToast({ title: "请输入账号和密码", icon: "none" });
      return;
    }

    this.setData({ debugLoading: true });
    try {
      const result = await request({
        url: "/api/auth/miniprogram-password-login",
        method: "POST",
        data: { identifier, password }
      });
      wx.setStorageSync("miniToken", result.token);

      const app = getApp();
      app.globalData.accountState = result.accountState;
      app.globalData.user = result.user || null;

      this.setData({
        accountState: result.accountState || "registered",
        user: result.user || null,
        profile: buildProfile(result.accountState || "registered", result.user || null),
        debugPassword: ""
      });
      await this.load();
    } catch (err) {
      wx.showToast({ title: err.message || "调试登录失败", icon: "none" });
    } finally {
      this.setData({ debugLoading: false });
    }
  },

  completeRegistration() {
    wx.navigateTo({ url: "/pages/register-complete/index" });
  }
});
