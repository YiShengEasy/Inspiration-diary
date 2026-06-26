const { request, resolveAssetUrl } = require("../../utils/api");

function formatTermsText(terms) {
  const visibleTerms = terms.slice(0, 3);
  return `${visibleTerms.join(" / ")}${terms.length > 3 ? " ..." : ""}`;
}

function normalizeBook(book) {
  const cover = book.coverCard || null;
  const coverImage = cover ? resolveAssetUrl(cover.thumbnailUrl || cover.imageUrl || "") : "";
  const description = book.description || "暂无描述";
  return {
    ...book,
    cardCountText: `${Number(book.cardCount || 0)} 条灵感`,
    descriptionText: description,
    coverImage,
    tags: Array.isArray(book.tags) ? book.tags : [],
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
    entryFrom: "",
    cards: [],
    visibleBooks: [],
    bookSearch: "",
    title: "",
    loading: false,
    cardsLoading: false,
    creating: false,
    error: ""
  },

  onLoad(query = {}) {
    this.setData({
      selectedBookId: query.bookId ? decodeURIComponent(query.bookId) : "",
      entryFrom: query.from || ""
    });
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const body = await request({ url: "/api/db/books" });
      const books = Array.isArray(body) ? body.map(normalizeBook) : [];
      const selectedBookId = this.data.selectedBookId || (books[0] && books[0].id) || "";
      const selectedBook = books.find((book) => book.id === selectedBookId) || {};
      this.setData({ books, visibleBooks: this.filterBooks(books, this.data.bookSearch), selectedBookId, selectedBook });
      if (selectedBookId) {
        await this.loadBookCards(selectedBookId);
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

  onBookSearchInput(event) {
    const bookSearch = event.detail.value;
    this.setData({
      bookSearch,
      visibleBooks: this.filterBooks(this.data.books, bookSearch)
    });
  },

  filterBooks(books, keyword) {
    const q = String(keyword || "").trim().toLowerCase();
    if (!q) return books;
    return books.filter((book) => {
      const haystack = `${book.title || ""} ${book.descriptionText || ""}`.toLowerCase();
      return haystack.includes(q);
    });
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
    wx.navigateBack();
  },

  editBook() {
    wx.showToast({ title: "编辑功能待补充", icon: "none" });
  },

  deleteBook() {
    wx.showToast({ title: "删除功能待补充", icon: "none" });
  },

  openCollect() {
    wx.showToast({ title: "收录功能待补充", icon: "none" });
  },

  openCard(event) {
    const id = event.currentTarget.dataset.id;
    const card = this.data.cards.find((item) => item.id === id);
    if (card) wx.setStorageSync(`miniCard:${id}`, card);
    wx.navigateTo({ url: `/pages/card-detail/index?id=${encodeURIComponent(id)}` });
  }
});
