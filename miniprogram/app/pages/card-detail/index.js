const { request, resolveAssetUrl, downloadAsset, getToken } = require("../../utils/api");

function normalizeCard(card) {
  if (!card) return null;
  const terms = Array.isArray(card.terms) ? card.terms : [];
  const isCombo = card.type === "combo";
  return {
    ...card,
    image: isCombo ? resolveAssetUrl((card.comboSummary && card.comboSummary.coverImageUrl) || "") : resolveAssetUrl(card.image || card.imageUrl || card.thumbnailUrl || ""),
    title: card.mdName || terms[0] || (isCombo ? "组合卡片" : "灵感卡片"),
    summary: isCombo
      ? `${(card.comboSummary && card.comboSummary.imageCount) || 0} 张参考图 / ${(card.comboSummary && card.comboSummary.generationCount) || 0} 条视频记录`
      : (card.mdSummary || card.mdContent || card.insightNote || ""),
    typeLabel: isCombo ? "组合" : (card.type === "md" ? "DOC" : "IMG"),
    isMd: card.type === "md",
    isCombo,
    createdText: card.createdAt ? new Date(Number(card.createdAt)).toLocaleString("zh-CN") : "",
    terms,
    termsText: terms.join(" / ")
  };
}

async function hydrateCardMedia(card) {
  if (!card || card.isMd || !card.image) return card;
  return {
    ...card,
    image: await downloadAsset(card.image)
  };
}

async function downloadFileForSave(url) {
  const resolved = await downloadAsset(url);
  if (!/^https?:\/\//.test(resolved)) return resolved;

  return new Promise((resolve, reject) => {
    const token = getToken();
    wx.downloadFile({
      url: resolved,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(res.tempFilePath);
          return;
        }
        reject(new Error(`下载失败 ${res.statusCode || ""}`.trim()));
      },
      fail(err) {
        reject(new Error(err.errMsg || "下载失败"));
      }
    });
  });
}

function roleLabel(role) {
  if (role === "character") return "人物图";
  if (role === "scene") return "场景图";
  if (role === "story") return "故事图";
  return "其他";
}

function normalizeComboDetail(detail) {
  if (!detail) return null;
  return {
    ...detail,
    images: Array.isArray(detail.images)
      ? detail.images.map((image) => ({
        ...image,
        imageUrl: resolveAssetUrl(image.imageUrl || ""),
        roleLabel: roleLabel(image.role)
      }))
      : [],
    generations: Array.isArray(detail.generations)
      ? detail.generations.map((generation) => ({
        ...generation,
        videoUrl: resolveAssetUrl(generation.videoUrl || ""),
        posterUrl: generation.posterUrl ? resolveAssetUrl(generation.posterUrl) : "",
        promptNote: generation.promptNote || "暂无提示词"
      }))
      : []
  };
}

async function hydrateComboDetail(detail) {
  if (!detail) return null;
  const images = await Promise.all((detail.images || []).map(async (image) => ({
    ...image,
    imageUrl: await downloadAsset(image.imageUrl)
  })));
  const generations = await Promise.all((detail.generations || []).map(async (generation) => ({
    ...generation,
    videoUrl: await downloadAsset(generation.videoUrl),
    posterUrl: generation.posterUrl ? await downloadAsset(generation.posterUrl) : ""
  })));
  return {
    ...detail,
    images,
    generations
  };
}

Page({
  data: {
    id: "",
    card: null,
    comboDetail: null,
    hasCard: false,
    loading: false,
    error: ""
  },

  onLoad(query) {
    const id = query.id || "";
    const cached = id ? wx.getStorageSync(`miniCard:${id}`) : null;
    const card = normalizeCard(cached);
    this.setData({ id, card, hasCard: !!card });
    this.load();
  },

  async load() {
    if (!this.data.id) return;
    this.setData({ loading: true, error: "" });
    try {
      const card = await hydrateCardMedia(normalizeCard(await request({ url: `/api/db/cards/${encodeURIComponent(this.data.id)}` })));
      let comboDetail = null;
      if (card && card.type === "combo") {
        comboDetail = await hydrateComboDetail(normalizeComboDetail(await request({ url: `/api/db/cards/${encodeURIComponent(this.data.id)}/combo` })));
      }
      wx.setStorageSync(`miniCard:${this.data.id}`, card);
      this.setData({ card, comboDetail, hasCard: !!card, loading: false });
    } catch (err) {
      this.setData({
        loading: false,
        error: err.message || "卡片详情加载失败"
      });
    }
  },

  async deleteCard() {
    wx.showModal({
      title: "删除卡片？",
      content: "删除后不可恢复，确认要删除这张灵感卡片吗？",
      confirmText: "删除",
      confirmColor: "#d64545",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await request({ url: `/api/db/cards/${encodeURIComponent(this.data.id)}`, method: "DELETE" });
          wx.removeStorageSync(`miniCard:${this.data.id}`);
          wx.navigateBack();
        } catch (err) {
          wx.showToast({ title: err.message || "删除失败", icon: "none" });
        }
      }
    });
  },

  async downloadCardAsset() {
    const card = this.data.card;
    if (!card || card.isMd || !card.image) {
      wx.showToast({ title: "暂无可下载图片", icon: "none" });
      return;
    }

    try {
      wx.showLoading({ title: "正在下载" });
      const filePath = await downloadFileForSave(card.image);
      wx.hideLoading();
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
        fail: () => wx.showToast({ title: "保存失败，请检查权限", icon: "none" })
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || "下载失败", icon: "none" });
    }
  },

  async downloadComboVideo(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) {
      wx.showToast({ title: "暂无可下载视频", icon: "none" });
      return;
    }

    try {
      wx.showLoading({ title: "正在下载" });
      const filePath = await downloadFileForSave(url);
      wx.hideLoading();
      wx.saveVideoToPhotosAlbum({
        filePath,
        success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
        fail: () => wx.showToast({ title: "保存失败，请检查权限", icon: "none" })
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || "下载失败", icon: "none" });
    }
  },

  openSearch() {
    wx.redirectTo({ url: "/pages/search/index" });
  }
});
