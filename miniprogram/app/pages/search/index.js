const { request, resolveAssetUrl, downloadAsset } = require("../../utils/api");

const filterNames = ["全部", "图片", "MD", "标签"];

function buildFilters(active) {
  return filterNames.map((name) => ({
    name,
    active: name === active,
    activeClass: name === active ? "active" : ""
  }));
}

function normalizeCard(card) {
  const terms = Array.isArray(card.terms) ? card.terms : [];
  return {
    ...card,
    image: resolveAssetUrl(card.thumbnailUrl || card.imageUrl || ""),
    title: card.mdName || terms[0] || "灵感图片",
    summary: card.mdSummary || card.insightNote || "",
    typeLabel: card.type === "md" ? "MD" : "IMG",
    createdText: card.createdAt ? new Date(Number(card.createdAt)).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) : "",
    terms,
    termsText: terms.join(" / ")
  };
}

async function hydrateCardImage(card) {
  if (!card.image) return card;
  return { ...card, image: await downloadAsset(card.image) };
}

Page({
  data: {
    q: "",
    filter: "全部",
    filters: buildFilters("全部"),
    cards: [],
    loading: false,
    searched: false,
    error: ""
  },

  onLoad() {
    this.search();
  },

  onInput(event) {
    this.setData({ q: event.detail.value });
  },

  setFilter(event) {
    const filter = event.currentTarget.dataset.filter;
    this.setData({ filter, filters: buildFilters(filter) });
    this.search();
  },

  useKeyword(event) {
    this.setData({ q: event.currentTarget.dataset.keyword });
    this.search();
  },

  async search() {
    this.setData({ loading: true, searched: true, error: "" });
    try {
      const q = this.data.q.trim();
      const body = await request({
        url: `/api/db/cards?weekId=all&page=1&pageSize=50&q=${encodeURIComponent(q)}`
      });
      let cards = (body.cards || []).map(normalizeCard);
      if (this.data.filter === "图片") {
        cards = cards.filter((card) => card.type !== "md");
      } else if (this.data.filter === "MD") {
        cards = cards.filter((card) => card.type === "md");
      } else if (this.data.filter === "标签" && q) {
        cards = cards.filter((card) => card.terms.some((term) => term.indexOf(q) >= 0));
      }
      const hydratedCards = await Promise.all(cards.map(hydrateCardImage));
      hydratedCards.forEach((card) => wx.setStorageSync(`miniCard:${card.id}`, card));
      this.setData({ cards: hydratedCards });
    } catch (err) {
      this.setData({ error: err.message || "搜索失败" });
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
