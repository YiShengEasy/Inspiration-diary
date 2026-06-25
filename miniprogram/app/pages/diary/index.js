const { request, uploadImage, resolveAssetUrl } = require("../../utils/api");
const { requireRegistered, refreshAccountStatus } = require("../../utils/auth");
const { currentWeekId, days } = require("../../utils/dates");

function todayDayIndex() {
  const day = new Date().getDay();
  if (day === 0 || day === 6) return 5;
  return Math.max(0, day - 1);
}

function imageFor(card) {
  return resolveAssetUrl(card.thumbnailUrl || card.imageUrl || "");
}

function previewFor(card) {
  const image = imageFor(card);
  return {
    id: card.id,
    isMd: card.type === "md",
    image,
    title: card.mdName || "Markdown Note",
    summary: card.mdSummary || card.mdContent || "点击查看完整手稿。"
  };
}

function weekLabel(weekId) {
  const match = String(weekId || "").match(/W(\d+)/);
  return match ? `第 ${Number(match[1])} 周` : "本周";
}

function weekDateRange(weekId) {
  const match = String(weekId || "").match(/^(\d{4})-W(\d{1,2})$/);
  if (!match) return "";

  const year = Number(match[1]);
  const week = Number(match[2]);
  const janFourth = new Date(Date.UTC(year, 0, 4));
  const janFourthDay = janFourth.getUTCDay() || 7;
  const monday = new Date(janFourth);
  monday.setUTCDate(janFourth.getUTCDate() - janFourthDay + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const format = (date) => `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
  return `${format(monday)} - ${format(sunday)}`;
}

function formatTermsText(terms) {
  const visibleTerms = terms.slice(0, 3);
  return `${visibleTerms.join(" / ")}${terms.length > 3 ? " ..." : ""}`;
}

function normalizeCard(card) {
  const terms = Array.isArray(card.terms) ? card.terms : [];
  return {
    ...card,
    image: imageFor(card),
    title: card.mdName || terms[0] || "灵感图片",
    summary: card.mdSummary || card.insightNote || "",
    typeLabel: card.type === "md" ? "MD" : "IMG",
    isMd: card.type === "md",
    createdText: card.createdAt ? new Date(Number(card.createdAt)).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "",
    terms,
    termsText: formatTermsText(terms)
  };
}

function normalizeBook(book) {
  const cover = book.coverCard || null;
  const coverImage = cover ? resolveAssetUrl(cover.thumbnailUrl || cover.imageUrl || "") : "";
  return {
    ...book,
    coverImage,
    cardCountText: `${Number(book.cardCount || 0)} 条`,
    descriptionText: book.description || ""
  };
}

function cacheCards(cards) {
  cards.forEach((card) => {
    if (card && card.id) wx.setStorageSync(`miniCard:${card.id}`, card);
  });
}

Page({
  data: {
    accountState: "guest",
    weekId: currentWeekId(),
    weekLabel: weekLabel(currentWeekId()),
    weekDateRange: weekDateRange(currentWeekId()),
    days,
    books: [],
    cardsByDay: [],
    totalCards: 0,
    mdCount: 0,
    totalTerms: 0,
    loading: false,
    uploading: false,
    error: ""
  },

  async onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 0 });

    try {
      const status = await refreshAccountStatus();
      this.setData({ accountState: status.accountState || "guest", error: "" });
      if (status.accountState === "registered") {
        await Promise.all([this.loadCards(), this.loadBooks()]);
      } else {
        this.setData({ cardsByDay: [], books: [] });
      }
    } catch (err) {
      this.setData({ accountState: "guest", error: err.message || "账号状态加载失败" });
    }
  },

  async loadCards() {
    this.setData({ loading: true, error: "" });
    try {
      const body = await request({
        url: `/api/db/cards?weekId=${encodeURIComponent(this.data.weekId)}&page=1&pageSize=200`
      });
      const rawCards = Array.isArray(body) ? body : body.cards || [];
      const cards = rawCards.map(normalizeCard);
      cacheCards(cards);

      const cardsByDay = days.map((day, index) => {
        const dayCards = cards.filter((card) => Number(card.dayIndex) === index);
        const count = dayCards.length;
        const coverPreviews = dayCards.slice(0, 3).map(previewFor);
        return {
          day,
          cards: dayCards,
          count,
          countText: count ? `${count} 条灵感` : "等待记录",
          cover: dayCards[0] || null,
          coverPreviews
        };
      });
      const allTerms = cards.reduce((sum, card) => sum + card.terms.length, 0);
      const mdCount = cards.filter((card) => card.type === "md").length;
      this.setData({ cardsByDay, totalCards: cards.length, mdCount, totalTerms: allTerms });
    } catch (err) {
      this.setData({ error: err.message || "灵感加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadBooks() {
    try {
      const body = await request({ url: "/api/db/books" });
      const books = Array.isArray(body) ? body.map(normalizeBook) : [];
      this.setData({ books });
    } catch (err) {
      this.setData({ books: [] });
    }
  },

  openDay(event) {
    wx.navigateTo({
      url: `/pages/day-detail/index?dayIndex=${event.currentTarget.dataset.index}&weekId=${encodeURIComponent(this.data.weekId)}`
    });
  },

  onImageError(event) {
    console.warn("Diary cover image failed:", event.currentTarget.dataset.src, event.detail);
  },

  openSearch() {
    if (requireRegistered()) wx.navigateTo({ url: "/pages/search/index" });
  },

  openBooks() {
    if (requireRegistered()) wx.navigateTo({ url: "/pages/books/index" });
  },

  openRegister() {
    wx.navigateTo({ url: "/pages/register-complete/index" });
  },

  chooseUpload() {
    if (!requireRegistered() || this.data.uploading) return;

    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: async (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file || !file.tempFilePath) return;

        const filePath = file.tempFilePath;
        const cardId = `mini_${Date.now()}`;
        this.setData({ uploading: true, error: "" });

        try {
          const stored = await uploadImage({
            url: "/api/store-image",
            filePath,
            formData: { source: "miniprogram" }
          });
          const card = {
            id: cardId,
            weekId: this.data.weekId,
            dayIndex: todayDayIndex(),
            imageUrl: stored.imageUrl,
            thumbnailUrl: stored.thumbnailUrl || stored.imageUrl,
            photoUid: stored.photoUid || "",
            photoHash: stored.photoHash || "",
            terms: ["灵感图片", "待分析"],
            decoType: "tape",
            angle: 0,
            createdAt: Date.now(),
            type: "image"
          };

          await request({ url: "/api/db/cards", method: "POST", data: card });
          wx.setStorageSync(`miniCard:${cardId}`, normalizeCard(card));
          wx.showToast({ title: "已保存", icon: "success" });
          await this.loadCards();

          uploadImage({
            url: "/api/analyze-image",
            filePath,
            formData: { source: "miniprogram" }
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
            .then(() => this.loadCards())
            .catch(() => undefined);
        } catch (err) {
          this.setData({ error: err.message || "上传失败" });
          wx.showToast({ title: "上传失败", icon: "none" });
        } finally {
          this.setData({ uploading: false });
        }
      }
    });
  }
});
