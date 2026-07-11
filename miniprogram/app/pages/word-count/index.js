function countText(text) {
  const normalized = String(text || "").replace(/\r\n?/g, "\n");
  const trimmed = normalized.trim();
  const chinese = normalized.match(/[\u3400-\u9fff]/g) || [];
  const englishWords = normalized.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || [];
  const noSpaces = normalized.replace(/\s/g, "");
  const paragraphs = trimmed ? trimmed.split(/\n\s*\n/).filter((item) => item.trim()).length : 0;
  const lines = normalized ? normalized.split("\n").length : 0;
  const readableCount = chinese.length + englishWords.length;
  return {
    total: normalized.length,
    noSpaces: noSpaces.length,
    chinese: chinese.length,
    words: englishWords.length,
    lines,
    paragraphs,
    readingMinutes: readableCount ? Math.max(1, Math.ceil(readableCount / 300)) : 0
  };
}

Page({
  data: {
    text: "",
    stats: countText("")
  },

  changeText(event) {
    const text = event.detail.value || "";
    this.setData({ text, stats: countText(text) });
  },

  pasteText() {
    wx.getClipboardData({
      success: (result) => {
        const text = result.data || "";
        this.setData({ text, stats: countText(text) });
      }
    });
  },

  copyText() {
    if (!this.data.text) return wx.showToast({ title: "没有可复制的内容", icon: "none" });
    wx.setClipboardData({ data: this.data.text });
  },

  clearText() {
    this.setData({ text: "", stats: countText("") });
  }
});
