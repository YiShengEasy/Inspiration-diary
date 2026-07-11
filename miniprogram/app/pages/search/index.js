const { request, resolveAssetUrl } = require("../../utils/api");

const filterNames = ["全部", "图片", "文档", "标签"];

function buildFilters(active) {
  return filterNames.map((name) => ({
    name,
    active: name === active,
    activeClass: name === active ? "active" : ""
  }));
}

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
    createdText: card.createdAt ? new Date(Number(card.createdAt)).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) : "",
    terms,
    termsText: terms.join(" / ")
  };
}

function mergeCards(current, incoming) {
  const byId = new Map(current.map((card) => [card.id, card]));
  incoming.forEach((card) => byId.set(card.id, card));
  return Array.from(byId.values());
}

Page({
  data: {
    q: "",
    filter: "全部",
    filters: buildFilters("全部"),
    cards: [],
    page: 0,
    pageSize: 20,
    hasMore: true,
    loading: false,
    loadingMore: false,
    searched: false,
    error: ""
  },

  onLoad() {
    this.search();
  },

  onInput(event) {
    this.setData({ q: event.detail.value });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.search({ reset: true }), 300);
  },

  onUnload() {
    clearTimeout(this._searchTimer);
  },

  setFilter(event) {
    const filter = event.currentTarget.dataset.filter;
    this.setData({ filter, filters: buildFilters(filter) });
    this.search({ reset: true });
  },

  useKeyword(event) {
    this.setData({ q: event.currentTarget.dataset.keyword });
    this.search({ reset: true });
  },

  async search(options = {}) {
    const reset = options.reset !== false;
    if (reset) clearTimeout(this._searchTimer);
    if (!reset && (this.data.loadingMore || !this.data.hasMore)) return;
    const page = reset ? 1 : this.data.page + 1;
    if (reset) this._requestSeq = (this._requestSeq || 0) + 1;
    const requestSeq = this._requestSeq || 1;
    this.setData(reset
      ? { loading: true, searched: true, error: "", page: 0, hasMore: true }
      : { loadingMore: true, error: "" });
    try {
      const q = this.data.q.trim();
      const contentType = this.data.filter === "图片"
        ? "image"
        : this.data.filter === "文档" ? "md" : this.data.filter === "标签" ? "tags" : "all";
      const body = await request({
        url: `/api/db/cards?weekId=all&page=${page}&pageSize=${this.data.pageSize}&q=${encodeURIComponent(q)}&contentType=${contentType}`
      });
      if (requestSeq !== this._requestSeq) return;
      const incoming = (body.cards || []).map(normalizeCard);
      const cards = reset ? incoming : mergeCards(this.data.cards, incoming);
      incoming.forEach((card) => wx.setStorageSync(`miniCard:${card.id}`, card));
      this.setData({
        cards,
        page: Number(body.page || page),
        hasMore: Number(body.page || page) < Number(body.totalPages || 1)
      });
    } catch (err) {
      if (requestSeq === this._requestSeq) {
        this.setData({ error: err.message || "搜索失败" });
        if (!reset) wx.showToast({ title: "加载下一页失败", icon: "none" });
      }
    } finally {
      if (requestSeq === this._requestSeq) {
        this.setData(reset ? { loading: false } : { loadingMore: false });
      }
    }
  },

  onReachBottom() {
    this.search({ reset: false });
  },

  openCard(event) {
    const id = event.currentTarget.dataset.id;
    const card = this.data.cards.find((item) => item.id === id);
    if (card) wx.setStorageSync(`miniCard:${id}`, card);
    wx.navigateTo({
      url: `/pages/card-detail/index?id=${encodeURIComponent(id)}`,
      events: {
        cardDeleted: ({ id: deletedId }) => {
          this.setData({ cards: this.data.cards.filter((item) => item.id !== deletedId) });
        },
        favoriteChanged: (payload) => {
          this.setData({ cards: this.data.cards.map((item) => item.id === payload.id ? { ...item, ...payload } : item) });
        }
      }
    });
  }
});
