const { refreshAccountStatus, wechatLogin } = require("../../utils/auth");
const { request } = require("../../utils/api");
const {
  SMART_BOOK_SUGGEST_IMAGES_KEY,
  SMART_BOOK_SUGGEST_MARKDOWN_KEY,
  loadSmartSettings,
  saveSmartSetting
} = require("../../utils/smartSettings");

const EMPTY_STATS = {
  inspirationCount: 0,
  weekRecordCount: 0,
  toolUsageCount: 0
};

const WORK_IMAGES = [
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1493612276216-ee3925520721?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=900&q=80"
];
const AVATAR_IMAGE = "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=320&q=80";

function buildProfile(accountState, user) {
  if (accountState === "guest") {
    return {
      name: "未登录",
      description: "登录并注册后同步灵感和原图",
      avatarText: "灵",
      avatarUrl: AVATAR_IMAGE
    };
  }

  if (accountState === "wechat_logged_in_unregistered") {
    return {
      name: "微信用户",
      description: "完成注册后可在 Web 端继续整理灵感",
      avatarText: "微",
      avatarUrl: AVATAR_IMAGE
    };
  }

  const name = (user && (user.displayName || user.phone || user.email)) || "灵感用户";
  return {
    name,
    description: "把每天的视觉灵感留成一本册子",
    avatarText: name.slice(0, 1).toUpperCase(),
    avatarUrl: (user && user.avatarUrl) || AVATAR_IMAGE
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
    smartSettingsLoading: false,
    smartSettingsSaving: false,
    smartSuggestImages: false,
    smartSuggestMarkdown: false,
    meCards: [
      { iconKey: "file", title: "我的草稿", desc: "工具处理未保存内容" },
      { iconKey: "download", title: "本地缓存", desc: "清理预览和临时图" }
    ],
    profileTabs: ["灵感册", "工具作品", "收藏"],
    activeTab: "灵感册",
    workImages: WORK_IMAGES
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
        const [me, smartSettings] = await Promise.all([
          request({ url: "/api/miniprogram/me" }),
          loadSmartSettings().catch(() => ({ images: false, markdown: false }))
        ]);
        const meUser = me.user || user;
        nextData.user = meUser;
        nextData.profile = buildProfile(accountState, meUser);
        nextData.stats = me.stats || EMPTY_STATS;
        nextData.smartSuggestImages = smartSettings.images;
        nextData.smartSuggestMarkdown = smartSettings.markdown;
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
  },

  selectProfileTab(event) {
    this.setData({ activeTab: event.currentTarget.dataset.tab || "灵感册" });
  },

  async toggleSmartSuggestImages(event) {
    await this.updateSmartSetting(SMART_BOOK_SUGGEST_IMAGES_KEY, event.detail.value, "smartSuggestImages");
  },

  async toggleSmartSuggestMarkdown(event) {
    await this.updateSmartSetting(SMART_BOOK_SUGGEST_MARKDOWN_KEY, event.detail.value, "smartSuggestMarkdown");
  },

  async updateSmartSetting(key, value, dataKey) {
    if (this.data.accountState !== "registered") {
      wx.showToast({ title: "请先完成注册", icon: "none" });
      this.setData({ [dataKey]: false });
      return;
    }

    const previousValue = this.data[dataKey];
    this.setData({ [dataKey]: value, smartSettingsSaving: true });
    try {
      await saveSmartSetting(key, value);
      wx.showToast({ title: value ? "已开启" : "已关闭", icon: "success" });
    } catch (err) {
      this.setData({ [dataKey]: previousValue });
      wx.showToast({ title: err.message || "设置保存失败", icon: "none" });
    } finally {
      this.setData({ smartSettingsSaving: false });
    }
  }
});
