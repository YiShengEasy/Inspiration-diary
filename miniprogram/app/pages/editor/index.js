const { tools } = require("../../utils/tools");

const IMAGE_TOOLS = new Set(["crop", "colorPick", "pixel", "filter", "palette", "gradient", "watermark", "film", "ai"]);
const cropOptions = [
  { label: "自由", value: "free" },
  { label: "1:1", value: "square" },
  { label: "4:5", value: "portrait" },
  { label: "16:9", value: "wide" }
];
const filterOptions = [
  { label: "原始", value: "none" },
  { label: "低饱和", value: "soft" },
  { label: "漫画", value: "comic" },
  { label: "黑白", value: "mono" }
];
const pixelOptions = [
  { label: "轻微", value: "soft" },
  { label: "标准", value: "medium" },
  { label: "强烈", value: "hard" }
];
const filmOptions = [
  { label: "暖调", value: "warm" },
  { label: "冷调", value: "cool" },
  { label: "褪色", value: "fade" }
];
const watermarkPositions = [
  { label: "左上", value: "lt" },
  { label: "右上", value: "rt" },
  { label: "左下", value: "lb" },
  { label: "右下", value: "rb" }
];
const aiOptions = [
  { label: "复古像素", value: "pixel" },
  { label: "胶片海报", value: "poster" },
  { label: "低饱和", value: "soft" }
];
const paletteSets = [
  { label: "雾面", colors: ["#dae8dd", "#9cb7a6", "#4a5d50", "#f3ead7"] },
  { label: "海报", colors: ["#ff7f6f", "#7ed4d8", "#0f1720", "#fff7e8"] },
  { label: "像素", colors: ["#111111", "#b7ff38", "#6d5dfc", "#f7f7f2"] }
];
const defaultSwatches = ["#111111", "#b7ff38", "#7ed4d8", "#ff7f6f", "#f3ead7"];

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

function clampRgb(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(255, parsed));
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((part) => clampRgb(part).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function hexToRgb(hex) {
  const normalized = String(hex || "").replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
    const channel = (value) => {
      const next = value / 255;
    return next <= 0.03928 ? next / 12.92 : Math.pow((next + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return ((lighter + 0.05) / (darker + 0.05)).toFixed(2);
}

function toolState(toolId) {
  const needsImage = IMAGE_TOOLS.has(toolId);
  return {
    needsImage,
    controlTitle: needsImage ? "工具操作" : "参数设置",
    controlDesc: needsImage ? "上传图片后可继续调整参数" : "输入参数后即时生成结果"
  };
}

Page({
  data: {
    tool: "crop",
    toolName: "图片裁剪",
    toolDesc: "调整比例和构图",
    toolIcon: getToolIcon("crop"),
    needsImage: true,
    controlTitle: "工具操作",
    controlDesc: "上传图片后可继续调整参数",
    filePath: "",
    resultPath: "",
    previewClass: "",
    cropRatioClass: "crop-free",
    selectedCrop: "free",
    selectedFilter: "none",
    selectedPixel: "medium",
    selectedFilm: "warm",
    watermarkText: "Inspiration Diary",
    watermarkPosition: "rb",
    selectedAi: "pixel",
    selectedPalette: 0,
    swatches: defaultSwatches,
    selectedColor: defaultSwatches[0],
    rgbR: 183,
    rgbG: 255,
    rgbB: 56,
    hexValue: "#B7FF38",
    contrastFg: "#111111",
    contrastBg: "#B7FF38",
    contrastScore: "14.34",
    contrastLevel: "AAA",
    cropOptions,
    filterOptions,
    pixelOptions,
    filmOptions,
    watermarkPositions,
    aiOptions,
    paletteSets,
    tools
  },

  onLoad(query = {}) {
    const tool = getTool(query.tool || "crop");
    const filePath = query.filePath ? decodeURIComponent(query.filePath) : "";
    this.applyTool(tool.id, filePath);
  },

  applyTool(toolId, filePath = this.data.filePath) {
    const tool = getTool(toolId);
    const state = toolState(tool.id);
    this.setData({
      tool: tool.id,
      toolName: tool.name,
      toolDesc: tool.desc,
      toolIcon: getToolIcon(tool.id),
      filePath,
      resultPath: filePath,
      needsImage: state.needsImage,
      controlTitle: state.controlTitle,
      controlDesc: state.controlDesc
    });
    this.updatePreviewClass();
  },

  updatePreviewClass() {
    const { tool, selectedFilter, selectedPixel, selectedFilm, selectedAi } = this.data;
    let previewClass = "";
    if (tool === "filter") previewClass = `filter-${selectedFilter}`;
    if (tool === "pixel") previewClass = `pixel-${selectedPixel}`;
    if (tool === "film") previewClass = `film-${selectedFilm}`;
    if (tool === "ai") previewClass = `ai-${selectedAi}`;
    this.setData({ previewClass });
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

  setCrop(event) {
    const value = event.currentTarget.dataset.value || "free";
    this.setData({ selectedCrop: value, cropRatioClass: `crop-${value}` });
  },

  setFilter(event) {
    this.setData({ selectedFilter: event.currentTarget.dataset.value || "none" });
    this.updatePreviewClass();
  },

  setPixel(event) {
    this.setData({ selectedPixel: event.currentTarget.dataset.value || "medium" });
    this.updatePreviewClass();
  },

  setFilm(event) {
    this.setData({ selectedFilm: event.currentTarget.dataset.value || "warm" });
    this.updatePreviewClass();
  },

  setWatermarkPosition(event) {
    this.setData({ watermarkPosition: event.currentTarget.dataset.value || "rb" });
  },

  onWatermarkInput(event) {
    this.setData({ watermarkText: event.detail.value || "" });
  },

  setAiPreset(event) {
    this.setData({ selectedAi: event.currentTarget.dataset.value || "pixel" });
    this.updatePreviewClass();
  },

  selectPalette(event) {
    const index = Number(event.currentTarget.dataset.index || 0);
    const colors = paletteSets[index] ? paletteSets[index].colors : defaultSwatches;
    this.setData({
      selectedPalette: index,
      swatches: colors,
      selectedColor: colors[0]
    });
  },

  selectSwatch(event) {
    this.setData({ selectedColor: event.currentTarget.dataset.color || defaultSwatches[0] });
  },

  onRgbInput(event) {
    const channel = event.currentTarget.dataset.channel;
    const value = clampRgb(event.detail.value);
    const next = {
      rgbR: this.data.rgbR,
      rgbG: this.data.rgbG,
      rgbB: this.data.rgbB,
      [`rgb${channel}`]: value
    };
    const hexValue = rgbToHex(next.rgbR, next.rgbG, next.rgbB);
    this.setData({ [`rgb${channel}`]: value, hexValue });
  },

  onHexInput(event) {
    const value = event.detail.value || "";
    const rgb = hexToRgb(value);
    if (!rgb) {
      this.setData({ hexValue: value });
      return;
    }
    this.setData({
      hexValue: `#${value.replace("#", "").toUpperCase()}`,
      rgbR: rgb.r,
      rgbG: rgb.g,
      rgbB: rgb.b
    });
  },

  onContrastInput(event) {
    const key = event.currentTarget.dataset.key;
    const value = event.detail.value || "";
    const next = {
      contrastFg: key === "fg" ? value : this.data.contrastFg,
      contrastBg: key === "bg" ? value : this.data.contrastBg
    };
    const score = contrastRatio(next.contrastFg, next.contrastBg);
    const numericScore = Number(score);
    this.setData({
      ...next,
      contrastScore: score,
      contrastLevel: numericScore >= 7 ? "AAA" : (numericScore >= 4.5 ? "AA" : "不通过")
    });
  },

  copyValue(event) {
    const value = event.currentTarget.dataset.value || this.data.hexValue || "";
    wx.setClipboardData({ data: value });
  },

  openToolFromList(event) {
    const toolId = event.currentTarget.dataset.toolId;
    if (!toolId) return;
    this.applyTool(toolId);
  },

  saveToAlbum() {
    const path = this.data.resultPath || this.data.filePath;
    if (this.data.needsImage && !path) {
      wx.showToast({ title: "请先选择图片", icon: "none" });
      return;
    }

    if (!this.data.needsImage) {
      wx.showToast({ title: "结果已可复制使用", icon: "none" });
      return;
    }

    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
      fail: () => wx.showToast({ title: "保存失败，请检查权限", icon: "none" })
    });
  },

  saveToDiary() {
    const path = this.data.resultPath || this.data.filePath;
    if (this.data.needsImage && !path) {
      wx.showToast({ title: "请先选择图片", icon: "none" });
      return;
    }

    wx.showToast({ title: "当前工具结果已生成", icon: "none" });
  }
});
