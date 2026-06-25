function normalizeCard(card) {
  if (!card) return null;
  const terms = Array.isArray(card.terms) ? card.terms : [];
  return {
    ...card,
    image: card.image || card.imageUrl || card.thumbnailUrl || "",
    title: card.mdName || terms[0] || "灵感卡片",
    summary: card.mdSummary || card.insightNote || "",
    typeLabel: card.type === "md" ? "MD" : "IMG",
    createdText: card.createdAt ? new Date(Number(card.createdAt)).toLocaleString("zh-CN") : "",
    terms,
    termsText: terms.join(" / ")
  };
}

Page({
  data: {
    id: "",
    card: null,
    hasCard: false
  },

  onLoad(query) {
    const id = query.id || "";
    const cached = id ? wx.getStorageSync(`miniCard:${id}`) : null;
    const card = normalizeCard(cached);
    this.setData({ id, card, hasCard: !!card });
  },

  openSearch() {
    wx.redirectTo({ url: "/pages/search/index" });
  }
});
