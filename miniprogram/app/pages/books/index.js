const { request, resolveAssetUrl } = require("../../utils/api");

function formatTermsText(terms) {
  const visibleTerms = terms.slice(0, 3);
  return `${visibleTerms.join(" / ")}${terms.length > 3 ? " ..." : ""}`;
}

function normalizeBook(book) {
  const cover = book.coverCard || null;
  const coverImage = cover ? resolveAssetUrl(cover.thumbnailUrl || cover.imageUrl || "") : "";
  return {
    ...book,
    cardCountText: `${Number(book.cardCount || 0)} 条灵感`,
    descriptionText: book.description || "暂无描述",
    coverImage,
    updatedText: book.updatedAt ? new Date(Number(book.updatedAt)).toLocaleDateString("zh-CN") : ""
  };
}

function normalizeCard(card) {
  const terms = Array.isArray(card.terms) ? card.terms : [];
  return {
    ...card,
    image: resolveAssetUrl(card.thumbnailUrl || card.imageUrl || ""),
    title: card.mdName || terms[0] || "灵感图片",
    summary: card.mdSummary || card.mdContent || card.insightNote || "",
    typeLabel: card.type === "md" ? "MD" : "IMG",
    isMd: card.type === "md",
    createdText: card.createdAt ? new Date(Number(card.createdAt)).toLocaleDateString("zh-CN") : "",
    terms,
    termsText: formatTermsText(terms)
  };
}

Page({
  data: {
    books: [],
    selectedBookId: "",
    selectedBook: {},
    cards: [],
    title: "",
    loading: false,
    cardsLoading: false,
    creating: false,
    error: ""
  },

  onLoad(query = {}) {
    this.setData({ selectedBookId: query.bookId ? decodeURIComponent(query.bookId) : "" });
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const body = await request({ url: "/api/db/books" });
      const books = Array.isArray(body) ? body.map(normalizeBook) : [];
      const selectedBook = books.find((book) => book.id === this.data.selectedBookId) || {};
      this.setData({ books, selectedBook });
      if (this.data.selectedBookId) {
        await this.loadBookCards(this.data.selectedBookId);
      }
    } catch (err) {
      this.setData({ error: err.message || "灵感册加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadBookCards(bookId) {
    this.setData({ cardsLoading: true, error: "" });
    try {
      const body = await request({
        url: `/api/db/books/${encodeURIComponent(bookId)}/cards?page=1&pageSize=200`
      });
      const rawCards = Array.isArray(body) ? body : body.cards || [];
      const cards = rawCards.map(normalizeCard);
      cards.forEach((card) => wx.setStorageSync(`miniCard:${card.id}`, card));
      this.setData({ cards });
    } catch (err) {
      this.setData({ error: err.message || "灵感册内容加载失败", cards: [] });
    } finally {
      this.setData({ cardsLoading: false });
    }
  },

  onTitleInput(event) {
    this.setData({ title: event.detail.value });
  },

  async createBook() {
    const title = this.data.title.trim();
    if (!title) {
      wx.showToast({ title: "请输入灵感册名称", icon: "none" });
      return;
    }

    this.setData({ creating: true, error: "" });
    try {
      await request({
        url: "/api/db/books",
        method: "POST",
        data: { title, description: "" }
      });
      this.setData({ title: "" });
      wx.showToast({ title: "已创建", icon: "success" });
      await this.load();
    } catch (err) {
      this.setData({ error: err.message || "创建失败" });
      wx.showToast({ title: "创建失败", icon: "none" });
    } finally {
      this.setData({ creating: false });
    }
  },

  openBook(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    const selectedBook = this.data.books.find((book) => book.id === id) || {};
    this.setData({ selectedBookId: id, selectedBook, cards: [] });
    this.loadBookCards(id);
  },

  closeBook() {
    this.setData({ selectedBookId: "", selectedBook: {}, cards: [], error: "" });
  },

  openCard(event) {
    const id = event.currentTarget.dataset.id;
    const card = this.data.cards.find((item) => item.id === id);
    if (card) wx.setStorageSync(`miniCard:${id}`, card);
    wx.navigateTo({ url: `/pages/card-detail/index?id=${encodeURIComponent(id)}` });
  }
});
