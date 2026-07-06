const { request, uploadImage } = require("../../utils/api");
const { requireRegistered } = require("../../utils/auth");
const { currentWeekId } = require("../../utils/dates");
const { tools } = require("../../utils/tools");

const IMAGE_TOOLS = new Set(["crop", "colorPick", "pixel", "filter", "palette", "gradient", "watermark", "film", "ai"]);
const imageEditModes = [
  { label: "裁剪", value: "crop" },
  { label: "扩图", value: "expand" },
  { label: "旋转", value: "rotate" },
  { label: "矫正", value: "correct" }
];
const cropOptions = [
  { label: "自由", value: "free" },
  { label: "原比例", value: "original" },
  { label: "1:1", value: "square" },
  { label: "2:3", value: "portrait23" },
  { label: "3:2", value: "landscape32" }
];
const expandOptions = [
  { label: "原比例", value: "original" },
  { label: "1:1", value: "square" },
  { label: "3:4", value: "portrait34" },
  { label: "4:3", value: "landscape43" },
  { label: "9:16", value: "story" },
  { label: "16:9", value: "wide" }
];
const rotateOptions = [
  { label: "向左 90°", value: "left", icon: "↶" },
  { label: "向右 90°", value: "right", icon: "↷" },
  { label: "水平翻转", value: "flipX", icon: "⇆" },
  { label: "垂直翻转", value: "flipY", icon: "⇅" }
];
const correctOptions = [
  { label: "畸变矫正", value: "perspective", icon: "▥" },
  { label: "垂直", value: "vertical", icon: "▱" },
  { label: "水平", value: "horizontal", icon: "▰" }
];
const rotateTicks = ["-45", "-30", "-15", "0", "15", "30", "45"];
const correctTicks = ["-40", "-30", "-20", "-10", "0", "10", "20", "30", "40"];
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
const PALETTE_CANVAS_ID = "paletteCanvas";
const PALETTE_CANVAS_SIZE = 80;
const EDIT_CANVAS_ID = "editCanvas";
const EDIT_CANVAS_SIZE = 960;

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

function shouldExtractPalette(toolId) {
  return toolId === "colorPick" || toolId === "palette" || toolId === "gradient";
}

function isImageEditorTool(toolId) {
  return toolId === "crop";
}

function todayDayIndex() {
  const day = new Date().getDay();
  if (day === 0 || day === 6) return 5;
  return Math.max(0, day - 1);
}

function ratioFor(mode, value, info) {
  if (value === "square") return 1;
  if (value === "portrait23") return 2 / 3;
  if (value === "landscape32") return 3 / 2;
  if (value === "portrait34") return 3 / 4;
  if (value === "landscape43") return 4 / 3;
  if (value === "story") return 9 / 16;
  if (value === "wide") return 16 / 9;
  if (mode === "crop" && value === "free") return info.width / info.height;
  return info.width / info.height;
}

function canvasSizeForRatio(ratio) {
  if (ratio >= 1) {
    return {
      width: EDIT_CANVAS_SIZE,
      height: Math.round(EDIT_CANVAS_SIZE / ratio)
    };
  }

  return {
    width: Math.round(EDIT_CANVAS_SIZE * ratio),
    height: EDIT_CANVAS_SIZE
  };
}

function drawRectForMode(mode, canvasWidth, canvasHeight, sourceWidth, sourceHeight) {
  const canvasRatio = canvasWidth / canvasHeight;
  const sourceRatio = sourceWidth / sourceHeight;
  const shouldCover = mode === "crop";
  const scale = shouldCover
    ? Math.max(canvasWidth / sourceWidth, canvasHeight / sourceHeight)
    : Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
    fill: !shouldCover && Math.abs(canvasRatio - sourceRatio) > 0.01
  };
}

function colorDistance(a, b) {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  if (!left || !right) return 999;
  return Math.sqrt(
    Math.pow(left.r - right.r, 2)
    + Math.pow(left.g - right.g, 2)
    + Math.pow(left.b - right.b, 2)
  );
}

function extractSwatchesFromPixels(data) {
  const buckets = {};
  for (let index = 0; index < data.length; index += 16) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const alpha = data[index + 3];
    if (alpha < 80) continue;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max - min;
    const brightness = (r + g + b) / 3;
    if (brightness > 238 && saturation < 22) continue;

    const qr = Math.min(255, Math.round(r / 32) * 32);
    const qg = Math.min(255, Math.round(g / 32) * 32);
    const qb = Math.min(255, Math.round(b / 32) * 32);
    const key = `${qr},${qg},${qb}`;
    const score = 1 + saturation / 255 + (brightness > 35 && brightness < 225 ? 0.25 : 0);
    buckets[key] = (buckets[key] || 0) + score;
  }

  const ranked = Object.entries(buckets)
    .map(([key, score]) => {
      const [r, g, b] = key.split(",").map(Number);
      return { hex: rgbToHex(r, g, b), score };
    })
    .sort((a, b) => b.score - a.score);

  const swatches = [];
  for (const item of ranked) {
    if (swatches.every((color) => colorDistance(color, item.hex) > 48)) {
      swatches.push(item.hex);
    }
    if (swatches.length >= 5) break;
  }

  return swatches.length ? swatches : defaultSwatches;
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
    toolName: "图片编辑",
    toolDesc: "裁剪、扩图、旋转、矫正",
    toolIcon: getToolIcon("crop"),
    needsImage: true,
    controlTitle: "工具操作",
    controlDesc: "上传图片后可继续调整参数",
    filePath: "",
    resultPath: "",
    displayPath: "",
    showImagePreview: false,
    previewClass: "",
    imageEditMode: "crop",
    imageEditorFrameClass: "crop-free",
    imageEditorImageClass: "",
    imageEditorTransform: "",
    imageEditorStyle: "",
    cropRatioClass: "crop-free",
    selectedCrop: "free",
    selectedExpand: "original",
    rotationTurns: 0,
    rotationFineAngle: 0,
    rotatePointerStyle: "left: 50%;",
    rotateWheelStyle: "transform: translateX(-50%) rotate(0deg);",
    rotateDragStartX: 0,
    rotateDragStartAngle: 0,
    flipX: false,
    flipY: false,
    selectedCorrection: "",
    correctionValue: 0,
    correctionPointerStyle: "left: 50%;",
    operationStatus: "",
    selectedFilter: "none",
    selectedPixel: "medium",
    selectedFilm: "warm",
    watermarkText: "Inspiration Diary",
    watermarkPosition: "rb",
    selectedAi: "pixel",
    selectedPalette: 0,
    swatches: defaultSwatches,
    selectedColor: defaultSwatches[0],
    paletteStatus: "",
    savingDiary: false,
    rgbR: 183,
    rgbG: 255,
    rgbB: 56,
    hexValue: "#B7FF38",
    contrastFg: "#111111",
    contrastBg: "#B7FF38",
    contrastScore: "14.34",
    contrastLevel: "AAA",
    imageEditModes,
    cropOptions,
    expandOptions,
    rotateOptions,
    correctOptions,
    rotateTicks,
    correctTicks,
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
    const displayPath = filePath || "";
    this.setData({
      tool: tool.id,
      toolName: tool.name,
      toolDesc: tool.desc,
      toolIcon: getToolIcon(tool.id),
      filePath: displayPath,
      resultPath: displayPath,
      displayPath,
      showImagePreview: state.needsImage && !!displayPath,
      needsImage: state.needsImage,
      controlTitle: state.controlTitle,
      controlDesc: state.controlDesc
    });
    this.updatePreviewClass();
    this.updateImageEditorClass();
    if (displayPath && shouldExtractPalette(tool.id)) {
      this.extractPalette(displayPath);
    }
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

  updateImageEditorClass() {
    const {
      tool,
      imageEditMode,
      selectedCrop,
      selectedExpand,
      rotationTurns,
      rotationFineAngle,
      flipX,
      flipY,
      selectedCorrection,
      correctionValue
    } = this.data;
    if (!isImageEditorTool(tool)) {
      this.setData({ imageEditorFrameClass: "", imageEditorImageClass: "", imageEditorTransform: "", imageEditorStyle: "" });
      return;
    }

    const frameClass = imageEditMode === "expand" ? `expand-${selectedExpand}` : `crop-${selectedCrop}`;
    const correctionClass = selectedCorrection ? `correct-${selectedCorrection}` : "";
    const correctionAmount = Number(correctionValue || 0);
    const verticalSkew = selectedCorrection === "vertical" ? correctionAmount / -8 : 0;
    const horizontalSkew = selectedCorrection === "horizontal" ? correctionAmount / 8 : 0;
    const perspectiveTilt = selectedCorrection === "perspective" ? correctionAmount / 9 : 0;
    const transforms = [
      selectedCorrection === "perspective" ? `perspective(720rpx) rotateX(${perspectiveTilt}deg) rotateY(${-perspectiveTilt}deg)` : "",
      selectedCorrection === "vertical" ? `skewY(${verticalSkew}deg)` : "",
      selectedCorrection === "horizontal" ? `skewX(${horizontalSkew}deg)` : "",
      `rotate(${rotationTurns * 90 + Number(rotationFineAngle || 0)}deg)`,
      `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`,
      selectedCorrection ? "scale(1.03)" : ""
    ].filter(Boolean).join(" ");
    this.setData({
      imageEditorFrameClass: frameClass,
      imageEditorImageClass: correctionClass,
      imageEditorTransform: transforms,
      imageEditorStyle: `transform: ${transforms};`
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
          resultPath: filePath,
          displayPath: filePath,
          showImagePreview: true
        });
        if (shouldExtractPalette(this.data.tool)) {
          this.extractPalette(filePath);
        }
      }
    });
  },

  extractPalette(filePath = this.data.displayPath) {
    if (!filePath) return;

    this.setData({ paletteStatus: "正在提取图片主色..." });
    wx.getImageInfo({
      src: filePath,
      success: (info) => {
        const ctx = wx.createCanvasContext(PALETTE_CANVAS_ID, this);
        ctx.clearRect(0, 0, PALETTE_CANVAS_SIZE, PALETTE_CANVAS_SIZE);
        ctx.drawImage(info.path, 0, 0, PALETTE_CANVAS_SIZE, PALETTE_CANVAS_SIZE);
        ctx.draw(false, () => {
          wx.canvasGetImageData({
            canvasId: PALETTE_CANVAS_ID,
            x: 0,
            y: 0,
            width: PALETTE_CANVAS_SIZE,
            height: PALETTE_CANVAS_SIZE,
            success: (res) => {
              const swatches = extractSwatchesFromPixels(res.data || []);
              this.setData({
                swatches,
                selectedColor: swatches[0],
                selectedPalette: -1,
                paletteStatus: "已从图片提取主色"
              });
            },
            fail: (err) => {
              console.warn("Palette image data failed:", err);
              this.setData({ paletteStatus: "取色失败，可切换预设色卡" });
            }
          });
        });
      },
      fail: (err) => {
        console.warn("Palette image info failed:", err);
        this.setData({ paletteStatus: "取色失败，请重新选择图片" });
      }
    });
  },

  onPreviewImageError(event) {
    console.warn("Tool preview image failed:", event.currentTarget.dataset.src, event.detail);
    wx.showToast({ title: "图片预览失败，请重新选择", icon: "none" });
  },

  goBack() {
    wx.navigateBack();
  },

  setCrop(event) {
    const value = event.currentTarget.dataset.value || "free";
    this.setData({
      selectedCrop: value,
      cropRatioClass: `crop-${value}`,
      operationStatus: `裁剪比例：${event.currentTarget.dataset.label || value}`
    });
    this.updateImageEditorClass();
  },

  setImageEditMode(event) {
    const value = event.currentTarget.dataset.value || "crop";
    this.setData({ imageEditMode: value });
    this.updateImageEditorClass();
  },

  setExpand(event) {
    const value = event.currentTarget.dataset.value || "original";
    this.setData({
      selectedExpand: value,
      operationStatus: `扩展画布：${event.currentTarget.dataset.label || value}`
    });
    this.updateImageEditorClass();
  },

  applyRotate(event) {
    const value = event.currentTarget.dataset.value;
    const next = {};
    if (value === "left") next.rotationTurns = this.data.rotationTurns - 1;
    if (value === "right") next.rotationTurns = this.data.rotationTurns + 1;
    if (value === "flipX") next.flipX = !this.data.flipX;
    if (value === "flipY") next.flipY = !this.data.flipY;
    this.setData({ ...next, operationStatus: event.currentTarget.dataset.label || "已调整方向" });
    this.updateImageEditorClass();
  },

  setRotateFineAngle(value) {
    const nextValue = Math.max(-45, Math.min(45, Math.round(Number(value || 0))));
    this.setData({
      rotationFineAngle: nextValue,
      rotatePointerStyle: `left: ${((nextValue + 45) / 90) * 100}%;`,
      rotateWheelStyle: `transform: translateX(-50%) rotate(${-nextValue}deg);`,
      operationStatus: `旋转 ${nextValue}°`
    });
    this.updateImageEditorClass();
  },

  onRotateWheelStart(event) {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    this.setData({
      rotateDragStartX: touch.clientX,
      rotateDragStartAngle: Number(this.data.rotationFineAngle || 0)
    });
  },

  onRotateWheelMove(event) {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    const deltaX = touch.clientX - Number(this.data.rotateDragStartX || touch.clientX);
    this.setRotateFineAngle(Number(this.data.rotateDragStartAngle || 0) + deltaX * 0.22);
  },

  onRotateWheelEnd() {
    this.setRotateFineAngle(this.data.rotationFineAngle);
  },

  setCorrection(event) {
    const value = event.currentTarget.dataset.value || "";
    const nextCorrection = this.data.selectedCorrection === value ? "" : value;
    this.setData({
      selectedCorrection: nextCorrection,
      correctionValue: nextCorrection ? this.data.correctionValue : 0,
      correctionPointerStyle: nextCorrection ? this.data.correctionPointerStyle : "left: 50%;",
      operationStatus: event.currentTarget.dataset.label || "已调整矫正"
    });
    this.updateImageEditorClass();
  },

  onCorrectionValueChange(event) {
    const value = Number(event.detail.value || 0);
    this.setData({
      correctionValue: value,
      correctionPointerStyle: `left: ${((value + 40) / 80) * 100}%;`,
      operationStatus: `矫正 ${value}`
    });
    this.updateImageEditorClass();
  },

  resetImageEdit() {
    this.setData({
      selectedCrop: "free",
      selectedExpand: "original",
      rotationTurns: 0,
      rotationFineAngle: 0,
      rotatePointerStyle: "left: 50%;",
      rotateWheelStyle: "transform: translateX(-50%) rotate(0deg);",
      rotateDragStartX: 0,
      rotateDragStartAngle: 0,
      flipX: false,
      flipY: false,
      selectedCorrection: "",
      correctionValue: 0,
      correctionPointerStyle: "left: 50%;",
      operationStatus: "已还原"
    });
    this.updateImageEditorClass();
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
      selectedColor: colors[0],
      paletteStatus: "已切换预设色卡"
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

  buildEditedImage() {
    const path = this.data.resultPath || this.data.filePath;
    if (!path) return Promise.reject(new Error("请先选择图片"));

    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: path,
        success: (info) => {
          const mode = this.data.imageEditMode === "expand" ? "expand" : "crop";
          const ratioValue = mode === "expand" ? this.data.selectedExpand : this.data.selectedCrop;
          const ratio = ratioFor(mode, ratioValue, info);
          const size = canvasSizeForRatio(ratio);
          const ctx = wx.createCanvasContext(EDIT_CANVAS_ID, this);
          const turns = ((this.data.rotationTurns % 4) + 4) % 4;
          const sourceWidth = turns % 2 === 0 ? info.width : info.height;
          const sourceHeight = turns % 2 === 0 ? info.height : info.width;
          const rect = drawRectForMode(mode, size.width, size.height, sourceWidth, sourceHeight);

          ctx.clearRect(0, 0, EDIT_CANVAS_SIZE, EDIT_CANVAS_SIZE);
          ctx.setFillStyle(mode === "expand" || rect.fill ? "#f7f7f2" : "#111111");
          ctx.fillRect(0, 0, size.width, size.height);
          ctx.save();
          ctx.translate(size.width / 2, size.height / 2);
          ctx.rotate((turns * 90 + Number(this.data.rotationFineAngle || 0)) * Math.PI / 180);
          ctx.scale(this.data.flipX ? -1 : 1, this.data.flipY ? -1 : 1);
          if (typeof ctx.transform === "function" && this.data.selectedCorrection) {
            const correction = Number(this.data.correctionValue || 0) / 110;
            if (this.data.selectedCorrection === "vertical") ctx.transform(1, -correction, 0, 1, 0, 0);
            if (this.data.selectedCorrection === "horizontal") ctx.transform(1, 0, correction, 1, 0, 0);
            if (this.data.selectedCorrection === "perspective") ctx.transform(1, -correction / 2, correction / 2, 1, 0, 0);
          }
          const drawWidth = turns % 2 === 0 ? rect.width : rect.height;
          const drawHeight = turns % 2 === 0 ? rect.height : rect.width;
          ctx.drawImage(info.path, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
          ctx.restore();
          ctx.draw(false, () => {
            wx.canvasToTempFilePath({
              canvasId: EDIT_CANVAS_ID,
              x: 0,
              y: 0,
              width: size.width,
              height: size.height,
              destWidth: size.width,
              destHeight: size.height,
              fileType: "jpg",
              quality: 0.95,
              success: (res) => resolve(res.tempFilePath),
              fail: (err) => reject(new Error(err.errMsg || "导出失败"))
            }, this);
          });
        },
        fail: (err) => reject(new Error(err.errMsg || "读取图片失败"))
      });
    });
  },

  async saveEditedImageToAlbum() {
    if (!this.data.filePath) {
      wx.showToast({ title: "请先选择图片", icon: "none" });
      return;
    }

    wx.showLoading({ title: "正在生成" });
    try {
      const outputPath = await this.buildEditedImage();
      this.setData({
        filePath: outputPath,
        resultPath: outputPath,
        displayPath: outputPath,
        showImagePreview: true,
        selectedCrop: "free",
        selectedExpand: "original",
        rotationTurns: 0,
        rotationFineAngle: 0,
        rotatePointerStyle: "left: 50%;",
        rotateWheelStyle: "transform: translateX(-50%) rotate(0deg);",
        rotateDragStartX: 0,
        rotateDragStartAngle: 0,
        flipX: false,
        flipY: false,
        selectedCorrection: "",
        correctionValue: 0,
        correctionPointerStyle: "left: 50%;",
        operationStatus: "已生成新图片"
      });
      this.updateImageEditorClass();
      wx.hideLoading();
      wx.saveImageToPhotosAlbum({
        filePath: outputPath,
        success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
        fail: () => wx.showToast({ title: "保存失败，请检查权限", icon: "none" })
      });
    } catch (err) {
      wx.hideLoading();
      console.warn("Save edited image failed:", err);
      wx.showToast({ title: err.message || "生成失败", icon: "none" });
    }
  },

  async savePaletteCard(path) {
    const selectedColor = this.data.selectedColor || defaultSwatches[0];
    const paletteTerms = this.data.swatches
      .slice(0, 4)
      .map((color) => color.replace("#", "HEX-"));
    const terms = ["色卡", "主色", selectedColor.replace("#", "HEX-"), ...paletteTerms]
      .filter((term, index, list) => term && list.indexOf(term) === index)
      .slice(0, 8);
    const cardId = `mini_${Date.now()}`;

    const stored = await uploadImage({
      url: "/api/store-image",
      filePath: path,
      formData: { source: "miniprogram-toolbox" }
    });
    const card = {
      id: cardId,
      weekId: currentWeekId(),
      dayIndex: todayDayIndex(),
      imageUrl: stored.imageUrl,
      thumbnailUrl: stored.thumbnailUrl || stored.imageUrl,
      photoUid: stored.photoUid || "",
      photoHash: stored.photoHash || "",
      terms,
      insightNote: `工具箱色卡：主色 ${selectedColor}，色组 ${this.data.swatches.join(" / ")}`,
      decoType: "tape",
      angle: 0,
      createdAt: Date.now(),
      type: "image"
    };

    await request({ url: "/api/db/cards", method: "POST", data: card });
    wx.setStorageSync(`miniCard:${cardId}`, card);
  },

  async saveToDiary() {
    const path = this.data.resultPath || this.data.filePath;
    if (this.data.needsImage && !path) {
      wx.showToast({ title: "请先选择图片", icon: "none" });
      return;
    }

    if (isImageEditorTool(this.data.tool)) {
      await this.saveEditedImageToAlbum();
      return;
    }

    if (shouldExtractPalette(this.data.tool)) {
      if (!requireRegistered() || this.data.savingDiary) return;

      this.setData({ savingDiary: true });
      wx.showLoading({ title: "正在保存" });
      try {
        await this.savePaletteCard(path);
        wx.hideLoading();
        wx.showToast({ title: "已保存到灵感", icon: "success" });
      } catch (err) {
        console.warn("Save palette card failed:", err);
        wx.hideLoading();
        wx.showToast({ title: "保存失败", icon: "none" });
      } finally {
        this.setData({ savingDiary: false });
      }
      return;
    }

    wx.showToast({ title: "当前工具结果已生成", icon: "none" });
  }
});
