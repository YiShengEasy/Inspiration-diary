const { request, uploadImage } = require("../../utils/api");
const { requireRegistered, refreshAccountStatus } = require("../../utils/auth");
const { currentWeekId, days } = require("../../utils/dates");

function todayDayIndex() {
  const day = new Date().getDay();
  if (day === 0 || day === 6) return 5;
  return Math.max(0, day - 1);
}

function imageFor(card) {
  return card.thumbnailUrl || card.imageUrl || "";
}

function normalizeCard(card) {
  const terms = Array.isArray(card.terms) ? card.terms : [];
  return {
    ...card,
    image: imageFor(card),
    title: card.mdName || terms[0] || "灵感图片",
    summary: card.mdSummary || card.insightNote || "",
    typeLabel: card.type === "md" ? "MD" : "IMG",
    createdText: card.createdAt ? new Date(Number(card.createdAt)).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "",
    terms,
    termsText: terms.join(" / ")
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
    days,
    cardsByDay: [],
    totalCards: 0,
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
        await this.loadCards();
      } else {
        this.setData({ cardsByDay: [] });
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
        return {
          day,
          cards: dayCards,
          count,
          countText: count ? `${count} 条灵感` : "等待记录",
          cover: dayCards[0] || null,
          coverImages: dayCards.slice(0, 3).map(imageFor).filter(Boolean)
        };
      });
      const allTerms = cards.reduce((sum, card) => sum + card.terms.length, 0);
      this.setData({ cardsByDay, totalCards: cards.length, totalTerms: allTerms });
    } catch (err) {
      this.setData({ error: err.message || "灵感加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  openDay(event) {
    wx.navigateTo({
      url: `/pages/day-detail/index?dayIndex=${event.currentTarget.dataset.index}&weekId=${encodeURIComponent(this.data.weekId)}`
    });
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
