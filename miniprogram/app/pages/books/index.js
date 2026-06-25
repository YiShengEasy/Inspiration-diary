const { request, resolveAssetUrl, downloadAsset } = require("../../utils/api");

async function normalizeBook(book) {
  const cover = book.coverCard || null;
  const coverImage = cover ? await downloadAsset(resolveAssetUrl(cover.thumbnailUrl || cover.imageUrl || "")) : "";
  return {
    ...book,
    cardCountText: `${Number(book.cardCount || 0)} 条灵感`,
    descriptionText: book.description || "暂无描述",
    coverImage,
    updatedText: book.updatedAt ? new Date(Number(book.updatedAt)).toLocaleDateString("zh-CN") : ""
  };
}

Page({
  data: {
    books: [],
    title: "",
    loading: false,
    creating: false,
    error: ""
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const body = await request({ url: "/api/db/books" });
      const books = Array.isArray(body) ? await Promise.all(body.map(normalizeBook)) : [];
      this.setData({ books });
    } catch (err) {
      this.setData({ error: err.message || "灵感册加载失败" });
    } finally {
      this.setData({ loading: false });
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
  }
});
