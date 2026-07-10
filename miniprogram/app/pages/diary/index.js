const { request, uploadImage, resolveAssetUrl, downloadAsset } = require("../../utils/api");
const { requireRegistered, refreshAccountStatus, wechatLogin } = require("../../utils/auth");
const { currentWeekId, shiftWeekId, days } = require("../../utils/dates");
const { loadSmartSettings } = require("../../utils/smartSettings");
const { loadEnabledCustomTagHints } = require("../../utils/customTagLibrary");
const { loadAiUploadHeaders } = require("../../utils/aiSettings");

const dismissedSmartSuggestions = new Set();

function todayDayIndex() {
  const day = new Date().getDay();
  if (day === 0 || day === 6) return 5;
  return Math.max(0, day - 1);
}

function imageFor(card) {
  if (card && card.image && card.image.indexOf("/api/") < 0) return card.image;
  const isCombo = card.type === "combo";
  return resolveAssetUrl(isCombo ? ((card.comboSummary && card.comboSummary.coverImageUrl) || "") : (card.thumbnailUrl || card.imageUrl || ""));
}

function previewFor(card) {
  const image = imageFor(card);
  const isCombo = card.type === "combo";
  return {
    id: card.id,
    isMd: card.type === "md",
    isCombo,
    image,
    title: card.mdName || (isCombo ? "组合卡片" : "文档手稿"),
    summary: isCombo
      ? `${(card.comboSummary && card.comboSummary.imageCount) || 0} 张参考图 / ${(card.comboSummary && card.comboSummary.generationCount) || 0} 条视频记录`
      : (card.mdSummary || card.mdContent || "点击查看完整手稿。")
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

function padWeek(week) {
  return String(week).padStart(2, "0");
}

function weekIdFromDate(date) {
  const normalized = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = normalized.getUTCDay() || 7;
  normalized.setUTCDate(normalized.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(normalized.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((normalized - yearStart) / 86400000) + 1) / 7);
  return `${normalized.getUTCFullYear()}-W${padWeek(week)}`;
}

function mondayForDate(date) {
  const result = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = result.getUTCDay() || 7;
  result.setUTCDate(result.getUTCDate() - day + 1);
  return result;
}

function weekStartDate(weekId) {
  const match = String(weekId || "").match(/^(\d{4})-W(\d{1,2})$/);
  if (!match) return mondayForDate(new Date());

  const year = Number(match[1]);
  const week = Number(match[2]);
  const janFourth = new Date(Date.UTC(year, 0, 4));
  const janFourthDay = janFourth.getUTCDay() || 7;
  const monday = new Date(janFourth);
  monday.setUTCDate(janFourth.getUTCDate() - janFourthDay + 1 + (week - 1) * 7);
  return monday;
}

function monthLabel(year, month) {
  return `${year} 年 ${month + 1} 月`;
}

function monthFromWeekId(weekId) {
  const start = weekStartDate(weekId);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const middle = new Date(start);
  middle.setUTCDate(start.getUTCDate() + 3);
  return { year: middle.getUTCFullYear(), month: middle.getUTCMonth() };
}

function buildMonthWeekOptions(year, month, activeWeekId) {
  const monthStart = new Date(Date.UTC(year, month, 1));
  const monthEnd = new Date(Date.UTC(year, month + 1, 0));
  const cursor = mondayForDate(monthStart);
  const result = [];

  while (cursor <= monthEnd) {
    const weekId = weekIdFromDate(cursor);
    result.push({
      weekId,
      label: weekLabel(weekId),
      range: weekDateRange(weekId),
      active: weekId === activeWeekId,
      countText: "..."
    });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  return result;
}

function shiftMonth(year, month, offset) {
  const date = new Date(Date.UTC(year, month + Number(offset || 0), 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

function formatTermsText(terms) {
  const visibleTerms = terms.slice(0, 3);
  return `${visibleTerms.join(" / ")}${terms.length > 3 ? " ..." : ""}`;
}

function sortNewestFirst(cards) {
  return cards.slice().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function normalizeCard(card) {
  const terms = Array.isArray(card.terms) ? card.terms : [];
  const isCombo = card.type === "combo";
  return {
    ...card,
    image: isCombo ? resolveAssetUrl((card.comboSummary && card.comboSummary.coverImageUrl) || "") : imageFor(card),
    title: card.mdName || terms[0] || (isCombo ? "组合卡片" : "灵感图片"),
    summary: isCombo
      ? `${(card.comboSummary && card.comboSummary.imageCount) || 0} 张参考图 / ${(card.comboSummary && card.comboSummary.generationCount) || 0} 条视频记录`
      : (card.mdSummary || card.insightNote || ""),
    typeLabel: isCombo ? "组合" : (card.type === "md" ? "DOC" : "IMG"),
    isMd: card.type === "md",
    isCombo,
    createdText: card.createdAt ? new Date(Number(card.createdAt)).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "",
    terms,
    termsText: formatTermsText(terms)
  };
}

async function hydrateCardMedia(card) {
  if (!card || card.isMd || !card.image) return card;
  return {
    ...card,
    image: await downloadAsset(card.image)
  };
}

function normalizeBook(book) {
  const cover = book.coverCard || null;
  const coverImage = cover ? imageFor(cover) : "";
  return {
    ...book,
    coverImage,
    cardCountText: `${Number(book.cardCount || 0)} 条`,
    descriptionText: book.description || ""
  };
}

async function hydrateBookMedia(book) {
  if (!book || !book.coverImage) return book;
  return {
    ...book,
    coverImage: await downloadAsset(book.coverImage)
  };
}

function cacheCards(cards) {
  cards.forEach((card) => {
    if (card && card.id) wx.setStorageSync(`miniCard:${card.id}`, card);
  });
}

function suggestionKey(cardId, bookId) {
  return `${cardId}:${bookId}`;
}

function bookHintsFromBooks(books) {
  return (books || [])
    .map((book) => [book.title, book.description].filter(Boolean).join("：").trim())
    .filter(Boolean)
    .slice(0, 20);
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
    loginLoading: false,
    uploading: false,
    weekPickerOpen: false,
    weekPickerLoading: false,
    weekPickerYear: monthFromWeekId(currentWeekId()).year,
    weekPickerMonth: monthFromWeekId(currentWeekId()).month,
    weekPickerMonthLabel: monthLabel(monthFromWeekId(currentWeekId()).year, monthFromWeekId(currentWeekId()).month),
    weekOptions: [],
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
      const cards = sortNewestFirst(await Promise.all(rawCards.map((card) => hydrateCardMedia(normalizeCard(card)))));
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
      const books = Array.isArray(body) ? await Promise.all(body.map((book) => hydrateBookMedia(normalizeBook(book)))) : [];
      this.setData({ books });
    } catch (err) {
      this.setData({ books: [] });
    }
  },

  async maybeSuggestBookMembership(card) {
    try {
      const settings = await loadSmartSettings();
      const shouldSuggest = card.type === "md" ? settings.markdown : settings.images;
      if (!shouldSuggest) return;

      const suggestionsBody = await request({ url: `/api/db/cards/${encodeURIComponent(card.id)}/book-suggestions?limit=3` });
      const candidates = Array.isArray(suggestionsBody.candidates) ? suggestionsBody.candidates : [];
      const match = candidates[0];
      if (!match) return;

      const key = suggestionKey(card.id, match.book.id);
      if (dismissedSmartSuggestions.has(key)) return;

      const memberships = await request({ url: `/api/db/cards/${encodeURIComponent(card.id)}/books` });
      const alreadyContains = Array.isArray(memberships)
        && memberships.some((book) => book.id === match.book.id && book.containsCard);
      if (alreadyContains) return;

      const confirmed = await new Promise((resolve) => {
        wx.showModal({
          title: "加入灵感册？",
          content: `默认推荐《${match.book.title}》，也可以改选其他候选册。`,
          confirmText: "选择",
          cancelText: "暂不",
          success: (res) => resolve(Boolean(res.confirm)),
          fail: () => resolve(false)
        });
      });

      if (!confirmed) {
        dismissedSmartSuggestions.add(key);
        await request({
          url: `/api/db/cards/${encodeURIComponent(card.id)}/book-suggestion-feedback`,
          method: "POST",
          data: {
            suggestedBookId: match.book.id,
            action: "dismissed",
            matchedTerms: match.matchedTerms || [],
            score: match.score || 0
          }
        }).catch((err) => console.warn("Mini smart book feedback skipped:", err));
        return;
      }

      let selected = match;
      if (candidates.length > 1) {
        const selectedIndex = await new Promise((resolve) => {
          wx.showActionSheet({
            itemList: candidates.map((candidate) => `《${candidate.book.title}》`),
            success: (res) => resolve(res.tapIndex),
            fail: () => resolve(0)
          });
        });
        selected = candidates[Number(selectedIndex)] || match;
      }

      await request({
        url: `/api/db/books/${encodeURIComponent(selected.book.id)}/cards`,
        method: "POST",
        data: { cardId: card.id }
      });
      await request({
        url: `/api/db/cards/${encodeURIComponent(card.id)}/book-suggestion-feedback`,
        method: "POST",
        data: {
          suggestedBookId: match.book.id,
          selectedBookId: selected.book.id,
          action: selected.book.id === match.book.id ? "accepted" : "corrected",
          matchedTerms: selected.matchedTerms || match.matchedTerms || [],
          score: selected.score || match.score || 0
        }
      });
      wx.showToast({ title: "已加入灵感册", icon: "success" });
      await this.loadBooks();
    } catch (err) {
      console.warn("Mini smart book suggestion skipped:", err);
    }
  },

  async loadBookHintsForSmartImage() {
    try {
      const settings = await loadSmartSettings();
      if (!settings.images) return [];
      const booksBody = await request({ url: "/api/db/books" });
      return bookHintsFromBooks(Array.isArray(booksBody) ? booksBody : []);
    } catch (err) {
      console.warn("Mini smart book hints skipped:", err);
      return [];
    }
  },

  openDay(event) {
    const dayIndex = Number(event.currentTarget.dataset.index || 0);
    const day = this.data.cardsByDay[dayIndex];
    if (!day || !day.count) {
      this.chooseUpload(dayIndex);
      return;
    }

    wx.navigateTo({
      url: `/pages/day-detail/index?dayIndex=${dayIndex}&weekId=${encodeURIComponent(this.data.weekId)}`
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

  async setWeek(weekId) {
    if (!weekId || this.data.loading) return;

    this.setData({
      weekId,
      weekLabel: weekLabel(weekId),
      weekDateRange: weekDateRange(weekId),
      weekPickerOpen: false,
      weekOptions: this.data.weekOptions.map((option) => ({
        ...option,
        active: option.weekId === weekId
      }))
    });
    await this.loadCards();
  },

  async changeWeek(event) {
    const offset = Number(event.currentTarget.dataset.offset || 0);
    if (!offset || this.data.loading) return;

    await this.setWeek(shiftWeekId(this.data.weekId, offset));
  },

  async openWeekPicker() {
    if (!requireRegistered()) return;

    const { year, month } = monthFromWeekId(this.data.weekId || currentWeekId());
    const weekOptions = buildMonthWeekOptions(year, month, this.data.weekId);
    this.setData({
      weekPickerOpen: true,
      weekPickerLoading: true,
      weekPickerYear: year,
      weekPickerMonth: month,
      weekPickerMonthLabel: monthLabel(year, month),
      weekOptions
    });

    await this.loadWeekOptionCounts(weekOptions);
  },

  async loadWeekOptionCounts(weekOptions = this.data.weekOptions) {
    this.setData({ weekPickerLoading: true });

    const nextOptions = await Promise.all(weekOptions.map(async (option) => {
      try {
        const body = await request({
          url: `/api/db/cards?weekId=${encodeURIComponent(option.weekId)}&page=1&pageSize=1`
        });
        const total = typeof body.total === "number"
          ? body.total
          : (Array.isArray(body) ? body.length : ((body.cards || []).length));
        return { ...option, countText: `${total} 条` };
      } catch (err) {
        return { ...option, countText: "-- 条" };
      }
    }));

    if (this.data.weekPickerOpen) {
      this.setData({ weekOptions: nextOptions, weekPickerLoading: false });
    }
  },

  async changePickerMonth(event) {
    const offset = Number(event.currentTarget.dataset.offset || 0);
    if (!offset) return;

    const { year, month } = shiftMonth(this.data.weekPickerYear, this.data.weekPickerMonth, offset);
    const weekOptions = buildMonthWeekOptions(year, month, this.data.weekId);
    this.setData({
      weekPickerYear: year,
      weekPickerMonth: month,
      weekPickerMonthLabel: monthLabel(year, month),
      weekOptions
    });

    await this.loadWeekOptionCounts(weekOptions);
  },

  closeWeekPicker() {
    this.setData({ weekPickerOpen: false });
  },

  noop() {},

  async selectWeek(event) {
    await this.setWeek(event.currentTarget.dataset.weekId);
  },

  async backToCurrentWeek() {
    await this.setWeek(currentWeekId());
  },

  openBook(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    if (requireRegistered()) wx.navigateTo({ url: `/pages/books/index?bookId=${encodeURIComponent(id)}&from=diary` });
  },

  openRegister() {
    wx.navigateTo({ url: "/pages/register-complete/index" });
  },

  async loginWithWechat() {
    if (this.data.loginLoading) return;
    this.setData({ loginLoading: true, error: "" });

    try {
      const result = await wechatLogin();
      const accountState = result.accountState || "wechat_logged_in_unregistered";
      this.setData({ accountState });

      if (accountState === "registered") {
        await Promise.all([this.loadCards(), this.loadBooks()]);
        return;
      }

      wx.navigateTo({ url: "/pages/register-complete/index" });
    } catch (err) {
      const message = err.message || "微信登录失败";
      this.setData({ accountState: "guest", error: message });
      wx.showToast({ title: message, icon: "none" });
    } finally {
      this.setData({ loginLoading: false });
    }
  },

  chooseUpload(targetDayIndex) {
    if (!requireRegistered() || this.data.uploading) return;
    const dayIndex = Number.isFinite(Number(targetDayIndex)) ? Number(targetDayIndex) : todayDayIndex();

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
            dayIndex,
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
          await this.maybeSuggestBookMembership(card);

          const [bookHints, customTagHints, aiHeaders] = await Promise.all([
            this.loadBookHintsForSmartImage(),
            loadEnabledCustomTagHints(),
            loadAiUploadHeaders()
          ]);

          uploadImage({
            url: "/api/analyze-image",
            filePath,
            header: aiHeaders,
            formData: {
              source: "miniprogram",
              ...(bookHints.length ? { bookHints: JSON.stringify(bookHints) } : {}),
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
                return this.maybeSuggestBookMembership({ ...card, terms });
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
