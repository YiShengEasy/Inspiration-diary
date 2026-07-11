const { request, resolveAssetUrl } = require("../../utils/api");
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

function sortNewestFirst(cards) {
  return cards.slice().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function mergeCards(current, incoming) {
  const byId = new Map(current.map((card) => [card.id, card]));
  incoming.forEach((card) => byId.set(card.id, card));
  return Array.from(byId.values());
}

Page({
  data: {
    weekId: "",
    dayIndex: 0,
    dayName: "",
    cards: [],
    page: 0,
    pageSize: 20,
    total: 0,
    hasMore: true,
    loading: false,
    loadingMore: false,
    error: ""
  },

  onLoad(query) {
    const dayIndex = Number(query.dayIndex || 0);
    this.setData({
      weekId: query.weekId || "",
      dayIndex,
      dayName: days[dayIndex] || "日期详情"
    });
    this.load(true);
  },

  async load(reset = false) {
    if ((reset && this.data.loading) || (!reset && (this.data.loadingMore || !this.data.hasMore))) return;
    const page = reset ? 1 : this.data.page + 1;
    this.setData(reset ? { loading: true, error: "" } : { loadingMore: true, error: "" });
    try {
      const body = await request({
        url: `/api/db/cards?weekId=${encodeURIComponent(this.data.weekId)}&dayIndex=${this.data.dayIndex}&page=${page}&pageSize=${this.data.pageSize}`
      });
      const incoming = sortNewestFirst((body.cards || []).map(normalizeCard));
      const cards = reset ? incoming : mergeCards(this.data.cards, incoming);
      incoming.forEach((card) => wx.setStorageSync(`miniCard:${card.id}`, card));
      this.setData({
        cards,
        page: Number(body.page || page),
        total: Number(body.total || cards.length),
        hasMore: Number(body.page || page) < Number(body.totalPages || 1)
      });
    } catch (err) {
      this.setData({ error: err.message || "日期灵感加载失败" });
      if (!reset) wx.showToast({ title: "加载下一页失败", icon: "none" });
    } finally {
      this.setData(reset ? { loading: false } : { loadingMore: false });
    }
  },

  onReachBottom() {
    this.load(false);
  },

  openCard(event) {
    const id = event.currentTarget.dataset.id;
    const card = this.data.cards.find((item) => item.id === id);
    if (card) wx.setStorageSync(`miniCard:${id}`, card);
    wx.navigateTo({
      url: `/pages/card-detail/index?id=${encodeURIComponent(id)}`,
      events: {
        cardDeleted: ({ id: deletedId }) => {
          const cards = this.data.cards.filter((item) => item.id !== deletedId);
          this.setData({ cards, total: Math.max(0, this.data.total - 1) });
        },
        favoriteChanged: (payload) => {
          this.setData({ cards: this.data.cards.map((item) => item.id === payload.id ? { ...item, ...payload } : item) });
        }
      }
    });
  }
});
