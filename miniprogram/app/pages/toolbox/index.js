const { tools } = require("../../utils/tools");

const categories = ["常用", "风格", "色彩", "AI", "更多"];
const commonToolIds = ["crop", "watermark", "filter"];
const decoratedTools = tools.map((tool) => ({
  ...tool,
  iconText: tool.name.slice(0, 1)
}));

function getVisibleTools(category) {
  if (category === "常用") {
    return decoratedTools.filter((tool) => commonToolIds.includes(tool.id));
  }

  return decoratedTools.filter((tool) => tool.category === category);
}

Page({
  data: {
    category: "常用",
    categories,
    tools: decoratedTools,
    visibleTools: getVisibleTools("常用")
  },

  selectCategory(event) {
    const category = event.currentTarget.dataset.category || "常用";
    this.setData({
      category,
      visibleTools: getVisibleTools(category)
    });
  },

  openTool(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;

    wx.navigateTo({ url: `/pages/editor/index?tool=${id}` });
  },

  importImage(event) {
    const source = event.currentTarget.dataset.source || "album";

    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: [source],
      success: (res) => {
        const filePath = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
        if (!filePath) return;

        wx.navigateTo({
          url: `/pages/editor/index?tool=crop&filePath=${encodeURIComponent(filePath)}`
        });
      }
    });
  }
});
