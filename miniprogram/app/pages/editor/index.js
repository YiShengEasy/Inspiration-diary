const { requireRegistered } = require("../../utils/auth");
const { tools } = require("../../utils/tools");

function getTool(id) {
  return tools.find((tool) => tool.id === id) || tools[0];
}

function getToolIcon(id) {
  const icons = {
    crop: "⌗",
    pixel: "▦",
    filter: "◐",
    watermark: "T",
    colorPick: "◎",
    palette: "✦",
    gradient: "⌁",
    contrast: "✓",
    rgbhex: "#",
    film: "◌",
    ai: "✦",
    more: "▤"
  };
  return icons[id] || "✦";
}

Page({
  data: {
    tool: "crop",
    toolName: "图片裁剪",
    toolDesc: "调整比例和构图",
    toolIcon: getToolIcon("crop"),
    filePath: "",
    resultPath: ""
  },

  onLoad(query = {}) {
    const tool = getTool(query.tool || "crop");
    const filePath = query.filePath ? decodeURIComponent(query.filePath) : "";

    this.setData({
      tool: tool.id,
      toolName: tool.name,
      toolDesc: tool.desc,
      toolIcon: getToolIcon(tool.id),
      filePath,
      resultPath: filePath
    });
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const filePath = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
        if (!filePath) return;

        this.setData({
          filePath,
          resultPath: filePath
        });
      }
    });
  },

  goBack() {
    wx.navigateBack();
  },

  saveToAlbum() {
    const path = this.data.resultPath || this.data.filePath;
    if (!path) {
      wx.showToast({ title: "请先选择图片", icon: "none" });
      return;
    }

    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
      fail: () => wx.showToast({ title: "保存失败，请检查权限", icon: "none" })
    });
  },

  saveToDiary() {
    if (!requireRegistered()) return;

    const path = this.data.resultPath || this.data.filePath;
    if (!path) {
      wx.showToast({ title: "请先选择图片", icon: "none" });
      return;
    }

    wx.showToast({ title: "已通过注册校验", icon: "none" });
  }
});
