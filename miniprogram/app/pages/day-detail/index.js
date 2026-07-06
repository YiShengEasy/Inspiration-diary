const { request, resolveAssetUrl, downloadAsset } = require("../../utils/api");
const { days } = require("../../utils/dates");

function normalizeCard(card) {
  const terms = Array.isArray(card.terms) ? card.terms : [];
  const isCombo = card.type === "combo";
  return {
    ...card,
    image: isCombo ? resolveAssetUrl((card.comboSummary && card.comboSummary.coverImageUrl) || "") : resolveAssetUrl(card.thumbnailUrl || card.imageUrl || ""),
    title: card.mdName || terms[0] || (isCombo ? "组合卡片" : "灵感图片"),
    summary: isCombo
      ? `${(card.comboSummary && card.comboSummary.imageCount) || 0} 张参考图 / ${(card.comboSummary && card.comboSummary.generationCount) || 0} 条视频记录`
      : (card.mdSummary || card.mdContent || card.insightNote || ""),
    typeLabel: isCombo ? "组合" : (card.type === "md" ? "DOC" : "IMG"),
    isMd: card.type === "md",
    isCombo,
    createdText: card.createdAt ? new Date(Number(card.createdAt)).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "",
    terms,
    termsText: terms.join(" / ")
  };
}

async function hydrateCardMedia(card) {
  if (!card || card.isMd || !card.image) return card;
  return {
    ...card,
    image: await downloadAsset(card.image)
  };
}

Page({
  data: {
    weekId: "",
    dayIndex: 0,
    dayName: "",
    cards: [],
    loading: false,
    error: ""
  },

  onLoad(query) {
    const dayIndex = Number(query.dayIndex || 0);
    this.setData({
      weekId: query.weekId || "",
      dayIndex,
      dayName: days[dayIndex] || "日期详情"
    });
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const body = await request({
        url: `/api/db/cards?weekId=${encodeURIComponent(this.data.weekId)}&page=1&pageSize=200`
      });
      const rawCards = Array.isArray(body) ? body : body.cards || [];
      const cards = await Promise.all(rawCards
        .filter((card) => Number(card.dayIndex) === this.data.dayIndex)
        .map((card) => hydrateCardMedia(normalizeCard(card))));
      cards.forEach((card) => wx.setStorageSync(`miniCard:${card.id}`, card));
      this.setData({ cards });
    } catch (err) {
      this.setData({ error: err.message || "日期灵感加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  openCard(event) {
    const id = event.currentTarget.dataset.id;
    const card = this.data.cards.find((item) => item.id === id);
    if (card) wx.setStorageSync(`miniCard:${id}`, card);
    wx.navigateTo({ url: `/pages/card-detail/index?id=${encodeURIComponent(id)}` });
  }
});
