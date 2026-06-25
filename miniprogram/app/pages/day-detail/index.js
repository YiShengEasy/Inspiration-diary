const { request } = require("../../utils/api");
const { days } = require("../../utils/dates");

function normalizeCard(card) {
  const terms = Array.isArray(card.terms) ? card.terms : [];
  return {
    ...card,
    image: card.thumbnailUrl || card.imageUrl || "",
    title: card.mdName || terms[0] || "灵感图片",
    summary: card.mdSummary || card.insightNote || "",
    typeLabel: card.type === "md" ? "MD" : "IMG",
    createdText: card.createdAt ? new Date(Number(card.createdAt)).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "",
    terms,
    termsText: terms.join(" / ")
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
      const cards = rawCards
        .filter((card) => Number(card.dayIndex) === this.data.dayIndex)
        .map(normalizeCard);
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
