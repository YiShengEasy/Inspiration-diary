const { request, uploadImage, uploadDocument, resolveAssetUrl } = require("../../utils/api");
const { requireRegistered } = require("../../utils/auth");
const { currentWeekId } = require("../../utils/dates");
const { loadEnabledCustomTagHints } = require("../../utils/customTagLibrary");
const { loadAiUploadHeaders } = require("../../utils/aiSettings");

function formatTermsText(terms) {
  const visibleTerms = terms.slice(0, 3);
  return `${visibleTerms.join(" / ")}${terms.length > 3 ? " ..." : ""}`;
}

function normalizeBook(book) {
  const cover = book.coverCard || null;
  const coverIsCombo = cover && cover.type === "combo";
  const coverImage = cover
    ? resolveAssetUrl(coverIsCombo ? ((cover.comboSummary && cover.comboSummary.coverImageUrl) || "") : (cover.thumbnail240Url || cover.thumbnailUrl || cover.imageUrl || ""))
    : "";
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
    createdText: card.createdAt ? new Date(Number(card.createdAt)).toLocaleDateString("zh-CN") : "",
    terms,
    termsText: formatTermsText(terms)
  };
}

function mergeCards(current, incoming) {
  const byId = new Map(current.map((card) => [card.id, card]));
  incoming.forEach((card) => byId.set(card.id, card));
  return Array.from(byId.values());
}

function todayDayIndex() {
  const day = new Date().getDay();
  if (day === 0 || day === 6) return 5;
  return Math.max(0, day - 1);
}

function createMiniCardId() {
  return `mini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function fallbackDocumentSummary(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s*/, "").replace(/^[-*+]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 160) || "已保存文档手稿，点击卡片查看完整内容。";
}

Page({
  data: {
    books: [],
    selectedBookId: "",
    selectedBook: {},
    entryFrom: "",
    cards: [],
    cardsPage: 0,
    cardsPageSize: 20,
    cardsHasMore: true,
    cardsLoadingMore: false,
    visibleBooks: [],
    bookSearch: "",
    title: "",
    loading: false,
    cardsLoading: false,
    creating: false,
    uploading: false,
    uploadStatus: "",
    error: ""
  },

  onLoad(query = {}) {
    this.setData({
      selectedBookId: query.bookId ? decodeURIComponent(query.bookId) : "",
      entryFrom: query.from || ""
    });
  },

  async onShow() {
    const silent = this._hasLoaded === true;
    await this.load({ silent });
    this._hasLoaded = true;
  },

  async load({ silent = false } = {}) {
    if (!silent) this.setData({ loading: true, error: "" });
    try {
      const body = await request({ url: "/api/db/books" });
      const books = Array.isArray(body) ? body.map(normalizeBook) : [];
      const selectedBookId = this.data.selectedBookId || (books[0] && books[0].id) || "";
      const selectedBook = books.find((book) => book.id === selectedBookId) || {};
      this.setData({ books, visibleBooks: this.filterBooks(books, this.data.bookSearch), selectedBookId, selectedBook });
      if (selectedBookId) {
        await this.loadBookCards(selectedBookId, { reset: true, silent });
      }
    } catch (err) {
      if (silent) wx.showToast({ title: err.message || "刷新失败", icon: "none" });
      else this.setData({ error: err.message || "灵感册加载失败" });
    } finally {
      if (!silent) this.setData({ loading: false });
    }
  },

  async loadBookCards(bookId, { reset = false, silent = false } = {}) {
    if (!bookId || (!reset && (this.data.cardsLoadingMore || !this.data.cardsHasMore))) return;
    const page = reset ? 1 : this.data.cardsPage + 1;
    if (!silent) this.setData(reset ? { cardsLoading: true, error: "" } : { cardsLoadingMore: true, error: "" });
    try {
      const body = await request({
        url: `/api/db/books/${encodeURIComponent(bookId)}/cards?page=${page}&pageSize=${this.data.cardsPageSize}`
      });
      if (bookId !== this.data.selectedBookId) return;
      const incoming = (body.cards || []).map(normalizeCard);
      const cards = reset
        ? (silent ? mergeCards(incoming, this.data.cards.slice(this.data.cardsPageSize)) : incoming)
        : mergeCards(this.data.cards, incoming);
      incoming.forEach((card) => wx.setStorageSync(`miniCard:${card.id}`, card));
      this.setData({
        cards,
        cardsPage: silent ? Math.max(this.data.cardsPage, Number(body.page || page)) : Number(body.page || page),
        cardsHasMore: (silent ? Math.max(this.data.cardsPage, Number(body.page || page)) : Number(body.page || page)) < Number(body.totalPages || 1),
        error: ""
      });
    } catch (err) {
      if (reset && !silent) this.setData({ error: err.message || "灵感册内容加载失败" });
      else wx.showToast({ title: "加载失败", icon: "none" });
    } finally {
      if (!silent) this.setData(reset ? { cardsLoading: false } : { cardsLoadingMore: false });
    }
  },

  loadMoreCards() {
    this.loadBookCards(this.data.selectedBookId, { reset: false });
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
    this.setData({ selectedBookId: id, selectedBook, cards: [], cardsPage: 0, cardsHasMore: true });
    this.loadBookCards(id, { reset: true });
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

  chooseUpload() {
    if (!requireRegistered() || this.data.uploading || !this.data.selectedBookId) return;

    wx.showActionSheet({
      itemList: ["上传图片", "导入文档"],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.chooseBookImages();
        } else if (res.tapIndex === 1) {
          this.chooseBookDocument();
        }
      }
    });
  },

  chooseBookImages() {
    wx.chooseMedia({
      count: 9,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const files = (res.tempFiles || []).filter((file) => file && file.tempFilePath);
        if (!files.length) return;
        this.importBookImages(files);
      }
    });
  },

  chooseBookDocument() {
    if (typeof wx.chooseMessageFile !== "function") {
      wx.showToast({ title: "当前微信版本不支持选择文档", icon: "none" });
      return;
    }

    wx.chooseMessageFile({
      count: 10,
      type: "file",
      extension: ["md", "markdown", "txt", "pdf", "docx"],
      success: (res) => {
        const files = (res.tempFiles || []).filter((file) => file && file.path);
        if (!files.length) return;
        this.importBookDocumentFiles(files);
      }
    });
  },

  async importBookImages(files) {
    const bookId = this.data.selectedBookId;
    let succeeded = 0;
    const failed = [];

    this.setData({ uploading: true, error: "", uploadStatus: `正在导入 1 / ${files.length}` });

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      this.setData({ uploadStatus: `正在导入图片 ${index + 1} / ${files.length}` });
      try {
        await this.importBookImage(bookId, file.tempFilePath);
        succeeded += 1;
      } catch (err) {
        failed.push(err.message || "图片导入失败");
      }
    }

    await this.finishBookImport(bookId, succeeded, failed);
  },

  async importBookImage(bookId, filePath) {
    const cardId = createMiniCardId();
    const stored = await uploadImage({
      url: "/api/store-image",
      filePath,
      formData: { source: "miniprogram" }
    });
    const card = {
      id: cardId,
      weekId: currentWeekId(),
      dayIndex: todayDayIndex(),
      imageUrl: stored.imageUrl,
      thumbnail240Url: stored.thumbnail240Url || stored.thumbnailUrl || stored.imageUrl,
      thumbnailUrl: stored.thumbnailUrl || stored.imageUrl,
      originalImageUrl: stored.originalImageUrl || stored.imageUrl,
      photoUid: stored.photoUid || "",
      photoHash: stored.photoHash || "",
      terms: ["灵感图片", "待分析"],
      decoType: "tape",
      angle: 0,
      createdAt: Date.now(),
      type: "image"
    };

    await request({ url: "/api/db/cards", method: "POST", data: card });
    await request({
      url: `/api/db/books/${encodeURIComponent(bookId)}/cards`,
      method: "POST",
      data: { cardId }
    });
    wx.setStorageSync(`miniCard:${cardId}`, normalizeCard(card));

    const [customTagHints, aiHeaders] = await Promise.all([
      loadEnabledCustomTagHints(),
      loadAiUploadHeaders()
    ]);

    uploadImage({
      url: "/api/analyze-image",
      filePath,
      header: aiHeaders,
      formData: {
        source: "miniprogram",
        ...(customTagHints.length ? { customTagHints: JSON.stringify(customTagHints) } : {})
      }
    })
      .then((analysis) => {
        const terms = Array.isArray(analysis.terms) ? analysis.terms : [];
        if (!terms.length) return null;
        return request({
          url: `/api/db/cards/${encodeURIComponent(cardId)}/terms`,
          method: "PUT",
          data: { terms }
        }).then(() => {
          const cached = wx.getStorageSync(`miniCard:${cardId}`) || card;
          wx.setStorageSync(`miniCard:${cardId}`, normalizeCard({ ...cached, terms }));
        });
      })
      .then(() => this.loadBookCards(bookId))
      .catch(() => undefined);
  },

  async importBookDocumentFiles(files) {
    const bookId = this.data.selectedBookId;
    let succeeded = 0;
    const failed = [];

    this.setData({ uploading: true, error: "", uploadStatus: `正在导入 1 / ${files.length}` });

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      this.setData({ uploadStatus: `正在导入文档 ${index + 1} / ${files.length}` });
      try {
        await this.importBookDocument(bookId, file);
        succeeded += 1;
      } catch (err) {
        failed.push(`${file.name || "文档"}：${err.message || "导入失败"}`);
      }
    }

    await this.finishBookImport(bookId, succeeded, failed);
  },

  async summarizeDocument(text) {
    try {
      const customTagHints = await loadEnabledCustomTagHints();
      const body = await request({
        url: "/api/summarize-md",
        method: "POST",
        data: {
          markdown: text,
          customTagHints
        }
      });
      const terms = Array.isArray(body.terms)
        ? body.terms.filter((term) => typeof term === "string" && term.trim()).slice(0, 5)
        : [];
      return {
        summary: body.summary || fallbackDocumentSummary(text),
        terms: terms.length ? terms : ["文档手稿", "资料整理"]
      };
    } catch (err) {
      return {
        summary: fallbackDocumentSummary(text),
        terms: ["文档手稿", "资料整理"]
      };
    }
  },

  async importBookDocument(bookId, file) {
    const extracted = await uploadDocument({
      url: "/api/documents/extract-text",
      filePath: file.path,
      formData: { filename: file.name || "文档" }
    });
    const text = extracted.text || "";
    if (!String(text || "").trim()) {
      throw new Error("文档内容为空");
    }

    const cardId = createMiniCardId();
    const summary = await this.summarizeDocument(text);
    const card = {
      id: cardId,
      weekId: currentWeekId(),
      dayIndex: todayDayIndex(),
      imageUrl: "",
      terms: summary.terms,
      decoType: "washi",
      angle: 0,
      createdAt: Date.now(),
      type: "md",
      mdContent: text,
      mdSummary: summary.summary,
      mdName: extracted.filename || file.name || "文档手稿"
    };

    await request({ url: "/api/db/cards", method: "POST", data: card });
    await request({
      url: `/api/db/books/${encodeURIComponent(bookId)}/cards`,
      method: "POST",
      data: { cardId }
    });
    wx.setStorageSync(`miniCard:${cardId}`, normalizeCard(card));
  },

  async finishBookImport(bookId, succeeded, failed) {
    const failedCount = failed.length;
    this.setData({
      uploading: false,
      uploadStatus: failedCount
        ? `导入完成：成功 ${succeeded} 个，失败 ${failedCount} 个`
        : `导入完成：成功 ${succeeded} 个`
    });
    wx.showToast({
      title: failedCount ? `成功 ${succeeded} 个，失败 ${failedCount} 个` : "已导入当前册",
      icon: failedCount ? "none" : "success"
    });
    await this.load();
    if (bookId) {
      this.setData({ selectedBookId: bookId });
      await this.loadBookCards(bookId);
    }
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
