const { request, resolveAssetUrl } = require("../../utils/api");

function normalizeCard(card) {
  if (!card) return null;
  const terms = Array.isArray(card.terms) ? card.terms : [];
  return {
    ...card,
    image: resolveAssetUrl(card.image || card.imageUrl || card.thumbnailUrl || ""),
    title: card.mdName || terms[0] || "灵感卡片",
    summary: card.mdSummary || card.mdContent || card.insightNote || "",
    typeLabel: card.type === "md" ? "MD" : "IMG",
    isMd: card.type === "md",
    createdText: card.createdAt ? new Date(Number(card.createdAt)).toLocaleString("zh-CN") : "",
    terms,
    termsText: terms.join(" / ")
  };
}

Page({
  data: {
    id: "",
    card: null,
    hasCard: false,
    loading: false,
    error: ""
  },

  onLoad(query) {
    const id = query.id || "";
    const cached = id ? wx.getStorageSync(`miniCard:${id}`) : null;
    const card = normalizeCard(cached);
    this.setData({ id, card, hasCard: !!card });
    this.load();
  },

  async load() {
    if (!this.data.id) return;
    this.setData({ loading: true, error: "" });
    try {
      const card = normalizeCard(await request({ url: `/api/db/cards/${encodeURIComponent(this.data.id)}` }));
      wx.setStorageSync(`miniCard:${this.data.id}`, card);
      this.setData({ card, hasCard: !!card, loading: false });
    } catch (err) {
      this.setData({
        loading: false,
        error: err.message || "卡片详情加载失败"
      });
    }
  },

  async deleteCard() {
    try {
      await request({ url: `/api/db/cards/${encodeURIComponent(this.data.id)}`, method: "DELETE" });
      wx.removeStorageSync(`miniCard:${this.data.id}`);
      wx.navigateBack();
    } catch (err) {
      wx.showToast({ title: err.message || "删除失败", icon: "none" });
    }
  },

  openSearch() {
    wx.redirectTo({ url: "/pages/search/index" });
  }
});
