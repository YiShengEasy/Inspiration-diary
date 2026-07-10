const { refreshAccountStatus, wechatLogin } = require("../../utils/auth");
const { request, resolveAssetUrl } = require("../../utils/api");
const { readToolDrafts, removeToolDraft } = require("../../utils/toolDrafts");
const {
  SMART_BOOK_SUGGEST_IMAGES_KEY,
  SMART_BOOK_SUGGEST_MARKDOWN_KEY,
  loadSmartSettings,
  saveSmartSetting
} = require("../../utils/smartSettings");
const {
  flattenCustomTagGroups,
  flattenEnabledCustomTagGroups,
  loadCustomTagLibrary
} = require("../../utils/customTagLibrary");

const EMPTY_STATS = {
  inspirationCount: 0,
  weekRecordCount: 0,
  toolUsageCount: 0
};

const AVATAR_IMAGE = "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=320&q=80";
const profileTabs = ["灵感册", "草稿", "收藏"];

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

function formatTermsText(terms) {
  const visibleTerms = terms.slice(0, 3);
  return `${visibleTerms.join(" / ")}${terms.length > 3 ? " ..." : ""}`;
}

function normalizeBook(book) {
  const cover = book.coverCard || null;
  const coverIsCombo = cover && cover.type === "combo";
  const coverImage = cover
    ? resolveAssetUrl(coverIsCombo ? ((cover.comboSummary && cover.comboSummary.coverImageUrl) || "") : (cover.thumbnail240Url || cover.thumbnailUrl || cover.imageUrl || ""))
    : "";
  return {
    ...book,
    coverImage,
    title: book.title || "未命名灵感册",
    descriptionText: book.description || "暂无描述",
    countText: `${Number(book.cardCount || 0)} 条灵感`
  };
}

function normalizeCard(card) {
  const terms = Array.isArray(card.terms) ? card.terms : [];
  const isCombo = card.type === "combo";
  return {
    ...card,
    image: isCombo ? resolveAssetUrl((card.comboSummary && card.comboSummary.coverImageUrl) || "") : resolveAssetUrl(card.thumbnail240Url || card.thumbnailUrl || card.imageUrl || ""),
    title: card.mdName || terms[0] || (isCombo ? "组合卡片" : "灵感图片"),
    summary: isCombo
      ? `${(card.comboSummary && card.comboSummary.imageCount) || 0} 张参考图 / ${(card.comboSummary && card.comboSummary.generationCount) || 0} 条视频记录`
      : (card.mdSummary || card.mdContent || card.insightNote || ""),
    typeLabel: isCombo ? "组合" : (card.type === "md" ? "DOC" : "IMG"),
    isMd: card.type === "md",
    isCombo,
    createdText: card.createdAt ? new Date(Number(card.createdAt)).toLocaleDateString("zh-CN") : "",
    terms,
    termsText: formatTermsText(terms)
  };
}

function normalizeDraft(draft) {
  return {
    ...draft,
    createdText: draft.createdAt ? new Date(Number(draft.createdAt)).toLocaleDateString("zh-CN") : "",
    title: draft.title || "工具草稿",
    note: draft.note || "保存在本机"
  };
}

Page({
  data: {
    accountState: "guest",
    user: null,
    profile: buildProfile("guest", null),
    stats: EMPTY_STATS,
    loading: false,
    tabLoading: false,
    debugLoginOpen: false,
    debugIdentifier: "",
    debugPassword: "",
    debugLoading: false,
    smartSettingsLoading: false,
    smartSettingsSaving: false,
    smartSettingsOpen: false,
    smartSuggestImages: false,
    smartSuggestMarkdown: false,
    customTagLibraryEnabled: true,
    customTagTotalCount: 0,
    customTagEnabledCount: 0,
    profileTabs,
    activeTab: "灵感册",
    books: [],
    drafts: [],
    favorites: [],
    sectionError: ""
  },

  async onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 2 });

    await this.load();
  },

  async load() {
    this.setData({
      loading: true,
      sectionError: "",
      drafts: readToolDrafts().map(normalizeDraft)
    });

    try {
      const status = await refreshAccountStatus();
      const accountState = status.accountState || "guest";
      const user = status.user || null;
      const nextData = {
        accountState,
        user,
        profile: buildProfile(accountState, user),
        stats: EMPTY_STATS,
        books: [],
        favorites: []
      };

      if (accountState === "registered") {
        const [me, smartSettings, customTagLibrary, books, favorites] = await Promise.all([
          request({ url: "/api/miniprogram/me" }),
          loadSmartSettings().catch(() => ({ images: false, markdown: false })),
          loadCustomTagLibrary().catch(() => ({ enabled: true, groups: [] })),
          this.loadBooks(),
          this.loadFavorites()
        ]);
        const meUser = me.user || user;
        nextData.user = meUser;
        nextData.profile = buildProfile(accountState, meUser);
        nextData.stats = {
          ...(me.stats || EMPTY_STATS),
          toolUsageCount: readToolDrafts().length
        };
        nextData.smartSuggestImages = smartSettings.images;
        nextData.smartSuggestMarkdown = smartSettings.markdown;
        nextData.books = books;
        nextData.favorites = favorites;
        const groups = customTagLibrary.groups || [];
        nextData.customTagLibraryEnabled = customTagLibrary.enabled !== false;
        nextData.customTagTotalCount = flattenCustomTagGroups(groups).length;
        nextData.customTagEnabledCount = customTagLibrary.enabled !== false ? flattenEnabledCustomTagGroups(groups).length : 0;
      } else {
        nextData.stats = {
          ...EMPTY_STATS,
          toolUsageCount: readToolDrafts().length
        };
      }

      this.setData(nextData);
    } catch (err) {
      wx.showToast({ title: err.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadBooks() {
    const body = await request({ url: "/api/db/books" });
    const books = Array.isArray(body) ? body : [];
    return books.map(normalizeBook);
  },

  async loadFavorites() {
    const body = await request({ url: "/api/db/cards?weekId=all&page=1&pageSize=60&favorite=true" });
    const rawCards = Array.isArray(body) ? body : body.cards || [];
    const cards = rawCards.map(normalizeCard);
    cards.forEach((card) => wx.setStorageSync(`miniCard:${card.id}`, card));
    return cards;
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
    this.setData({
      activeTab: event.currentTarget.dataset.tab || "灵感册",
      drafts: readToolDrafts().map(normalizeDraft)
    });
  },

  openBook(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/books/index?bookId=${encodeURIComponent(id)}&from=me` });
  },

  openFavorite(event) {
    const id = event.currentTarget.dataset.id;
    const card = this.data.favorites.find((item) => item.id === id);
    if (card) wx.setStorageSync(`miniCard:${id}`, card);
    wx.navigateTo({ url: `/pages/card-detail/index?id=${encodeURIComponent(id)}` });
  },

  openDraft(event) {
    const id = event.currentTarget.dataset.id;
    const draft = this.data.drafts.find((item) => item.id === id);
    if (!draft) return;

    wx.showActionSheet({
      itemList: ["预览", "保存到相册", "删除草稿"],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.previewImage({ urls: [draft.filePath], current: draft.filePath });
        } else if (res.tapIndex === 1) {
          wx.saveImageToPhotosAlbum({
            filePath: draft.filePath,
            success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
            fail: () => wx.showToast({ title: "保存失败，请检查权限", icon: "none" })
          });
        } else if (res.tapIndex === 2) {
          removeToolDraft(id);
          this.setData({
            drafts: readToolDrafts().map(normalizeDraft),
            stats: {
              ...this.data.stats,
              toolUsageCount: readToolDrafts().length
            }
          });
        }
      }
    });
  },

  toggleSmartSettingsOpen() {
    this.setData({ smartSettingsOpen: !this.data.smartSettingsOpen });
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
  },

  openCustomTags() {
    if (this.data.accountState !== "registered") {
      wx.showToast({ title: "请先完成注册", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/custom-tags/index" });
  }
});
