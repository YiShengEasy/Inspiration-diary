const { request, resolveAssetUrl } = require("../../utils/api");

function normalizeCard(card) {
  if (!card) return null;
  const terms = Array.isArray(card.terms) ? card.terms : [];
  const isCombo = card.type === "combo";
  return {
    ...card,
    image: isCombo ? resolveAssetUrl((card.comboSummary && card.comboSummary.coverImageUrl) || "") : resolveAssetUrl(card.image || card.imageUrl || card.thumbnailUrl || ""),
    title: card.mdName || terms[0] || (isCombo ? "组合卡片" : "灵感卡片"),
    summary: isCombo
      ? `${(card.comboSummary && card.comboSummary.imageCount) || 0} 张参考图 / ${(card.comboSummary && card.comboSummary.generationCount) || 0} 条视频记录`
      : (card.mdSummary || card.mdContent || card.insightNote || ""),
    typeLabel: isCombo ? "组合" : (card.type === "md" ? "DOC" : "IMG"),
    isMd: card.type === "md",
    isCombo,
    createdText: card.createdAt ? new Date(Number(card.createdAt)).toLocaleString("zh-CN") : "",
    terms,
    termsText: terms.join(" / ")
  };
}

function roleLabel(role) {
  if (role === "character") return "人物图";
  if (role === "scene") return "场景图";
  if (role === "story") return "故事图";
  return "其他";
}

function normalizeComboDetail(detail) {
  if (!detail) return null;
  return {
    ...detail,
    images: Array.isArray(detail.images)
      ? detail.images.map((image) => ({
        ...image,
        imageUrl: resolveAssetUrl(image.imageUrl || ""),
        roleLabel: roleLabel(image.role)
      }))
      : [],
    generations: Array.isArray(detail.generations)
      ? detail.generations.map((generation) => ({
        ...generation,
        videoUrl: resolveAssetUrl(generation.videoUrl || ""),
        posterUrl: generation.posterUrl ? resolveAssetUrl(generation.posterUrl) : "",
        promptNote: generation.promptNote || "暂无提示词"
      }))
      : []
  };
}

Page({
  data: {
    id: "",
    card: null,
    comboDetail: null,
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
      let comboDetail = null;
      if (card && card.type === "combo") {
        comboDetail = normalizeComboDetail(await request({ url: `/api/db/cards/${encodeURIComponent(this.data.id)}/combo` }));
      }
      wx.setStorageSync(`miniCard:${this.data.id}`, card);
      this.setData({ card, comboDetail, hasCard: !!card, loading: false });
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
