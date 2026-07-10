const { tools } = require("../../utils/tools");
const { requireRegistered } = require("../../utils/auth");

const categories = ["常用", "色彩", "风格", "AI", "更多"];
const featuredToolIds = ["colorPick", "pixel", "filter"];
const commonToolIds = ["crop", "watermark", "film", "more"];
const recommendCards = [
  {
    type: "image",
    typeLabel: "图片",
    title: "自然光影",
    meta: "图片参考",
    image: "/assets/reference-image.jpg"
  },
  {
    type: "md",
    typeLabel: "MD",
    title: "周末手记",
    meta: "文档参考"
  },
  {
    type: "combo",
    typeLabel: "组合",
    title: "场景组合",
    meta: "组合参考",
    images: ["/assets/reference-combo-a.jpg", "/assets/reference-combo-b.jpg"]
  }
];
const promoImages = [
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1493612276216-ee3925520721?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=900&q=80"
];
const featuredTools = tools
  .filter((tool) => featuredToolIds.includes(tool.id))
  .map((tool, index) => ({
    ...tool,
    label: index === 0 ? "色彩灵感" : "重点工具",
    featureClass: index === 0 ? "main-feature" : "side-feature"
  }));

function getVisibleTools(category) {
  if (category === "常用") {
    return tools.filter((tool) => commonToolIds.includes(tool.id));
  }

  return tools.filter((tool) => !featuredToolIds.includes(tool.id) && tool.category === category);
}

Page({
  data: {
    category: "常用",
    categories,
    promoImages,
    featuredTools,
    recommendCards,
    visibleTools: getVisibleTools("常用")
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 1 });
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

    const tool = tools.find((item) => item.id === id);
    if (tool && tool.locked) {
      if (!requireRegistered()) return;
    }

    wx.navigateTo({ url: `/pages/editor/index?tool=${id}` });
  },

  openDiary() {
    wx.switchTab({ url: "/pages/diary/index" });
  },

  openReferenceCard(event) {
    const type = event.currentTarget.dataset.reference;
    if (!["image", "md", "combo"].includes(type)) return;
    wx.navigateTo({ url: `/pages/card-detail/index?reference=${encodeURIComponent(type)}` });
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
