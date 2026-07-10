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
const correctTicks = ["-40", "-30", "-20", "-10", "0", "10", "20", "30", "40"];
const rotateMarks = Array.from({ length: 19 }, (_item, index) => {
  const angle = -45 + index * 5;
  const isMajor = angle % 15 === 0;
  return {
    angle,
    label: isMajor ? String(angle) : "",
    markStyle: `transform: rotate(${angle}deg) translateY(202rpx);`,
    labelStyle: `transform: translateX(-50%) rotate(${-angle}deg);`,
    major: isMajor
  };
});
const filterOptions = [
  { label: "原始", value: "none" },
  { label: "低饱和", value: "soft" },
  { label: "漫画", value: "comic" },
  { label: "黑白", value: "mono" }
];
const pixelOptions = [
  { label: "36X", value: 36 },
  { label: "52X", value: 52 },
  { label: "72X", value: 72 },
  { label: "104X", value: 104 },
  { label: "156X", value: 156 }
];
const beadRatioOptions = [
  { label: "自定义", value: "custom", className: "crop-free" },
  { label: "1:1", value: "square", className: "crop-square" },
  { label: "4:3", value: "landscape43", className: "crop-landscape43" },
  { label: "3:4", value: "portrait34", className: "crop-portrait34" },
  { label: "16:9", value: "wide", className: "crop-wide" }
];
const beadBrandOptions = [
  { label: "通用", value: "generic" },
  { label: "Perler", value: "perler" },
  { label: "Hama", value: "hama" },
  { label: "Artkal", value: "artkal" }
];
const beadColorOptions = [8, 16, 24, 32];
const beadPalettes = {
  generic: [
    ["G01", "白", "#F8F7F0"], ["G02", "黑", "#151515"], ["G03", "灰", "#8B8B86"], ["G04", "米白", "#EADCC4"],
    ["G05", "红", "#D93434"], ["G06", "橙", "#F47A25"], ["G07", "黄", "#F7D844"], ["G08", "柠檬绿", "#B7FF38"],
    ["G09", "草绿", "#38A65A"], ["G10", "青绿", "#33B6A5"], ["G11", "天蓝", "#6CC7E8"], ["G12", "蓝", "#2D67C8"],
    ["G13", "深蓝", "#1B2F6B"], ["G14", "紫", "#7B55C7"], ["G15", "粉", "#F5A3BC"], ["G16", "棕", "#8A5738"],
    ["G17", "肤色", "#F1BE93"], ["G18", "酒红", "#8E2441"], ["G19", "薄荷", "#A7E3C1"], ["G20", "浅紫", "#C7B7F4"],
    ["G21", "深绿", "#1E5D43"], ["G22", "沙色", "#C9A56A"], ["G23", "亮粉", "#FF5D9E"], ["G24", "湖蓝", "#2A9FD6"],
    ["G25", "深棕", "#4D3027"], ["G26", "浅灰", "#CFCFC8"], ["G27", "珊瑚", "#FF826C"], ["G28", "金黄", "#F3B431"],
    ["G29", "海军蓝", "#0F243B"], ["G30", "橄榄", "#768B3A"], ["G31", "薰衣草", "#A98ADB"], ["G32", "象牙", "#FFF3D8"]
  ],
  perler: [
    ["P01", "White", "#F7F7F2"], ["P02", "Black", "#111111"], ["P03", "Grey", "#8E8F8A"], ["P04", "Light Grey", "#D7D8D2"],
    ["P05", "Red", "#D82F36"], ["P06", "Orange", "#F47B28"], ["P07", "Yellow", "#F6D247"], ["P08", "Cheddar", "#F2A22C"],
    ["P09", "Kiwi Lime", "#A7D94A"], ["P10", "Green", "#2D9B52"], ["P11", "Dark Green", "#1F5A3A"], ["P12", "Turquoise", "#31B7B7"],
    ["P13", "Light Blue", "#79C9E8"], ["P14", "Blue", "#2D63B8"], ["P15", "Dark Blue", "#1C3675"], ["P16", "Purple", "#7A55B8"],
    ["P17", "Lavender", "#BBA8DD"], ["P18", "Pink", "#F29AB7"], ["P19", "Hot Coral", "#FF6E68"], ["P20", "Cranapple", "#8C2847"],
    ["P21", "Tan", "#D5A56F"], ["P22", "Light Brown", "#A66A3D"], ["P23", "Brown", "#6C442C"], ["P24", "Peach", "#F4BC91"],
    ["P25", "Cream", "#F6E6C8"], ["P26", "Toothpaste", "#A9E3D0"], ["P27", "Plum", "#5D315F"], ["P28", "Rust", "#B85732"],
    ["P29", "Pastel Yellow", "#F8E58A"], ["P30", "Pastel Green", "#BEE5A2"], ["P31", "Pastel Blue", "#A8D8F0"], ["P32", "Pastel Lavender", "#D1C4E8"]
  ],
  hama: [
    ["H01", "White", "#F6F5EF"], ["H02", "Black", "#151515"], ["H03", "Grey", "#8C8E8B"], ["H04", "Clear Grey", "#C9CCC5"],
    ["H05", "Red", "#D33535"], ["H06", "Orange", "#EF7624"], ["H07", "Yellow", "#F3D13E"], ["H08", "Beige", "#E3C89D"],
    ["H09", "Light Green", "#9FD660"], ["H10", "Green", "#2D944E"], ["H11", "Dark Green", "#245A3F"], ["H12", "Turquoise", "#37ADAE"],
    ["H13", "Light Blue", "#75C2DD"], ["H14", "Blue", "#2E64B4"], ["H15", "Dark Blue", "#23376D"], ["H16", "Purple", "#754AA6"],
    ["H17", "Lilac", "#BEA5D6"], ["H18", "Pink", "#F2A1B8"], ["H19", "Cerise", "#D94478"], ["H20", "Burgundy", "#822A3E"],
    ["H21", "Brown", "#744829"], ["H22", "Light Brown", "#AD7141"], ["H23", "Skin", "#F0BD92"], ["H24", "Cream", "#F5E8CD"],
    ["H25", "Pastel Pink", "#F6C7D4"], ["H26", "Pastel Blue", "#B5DAE8"], ["H27", "Pastel Green", "#C9E4B0"], ["H28", "Olive", "#788945"],
    ["H29", "Petrol", "#1F6E7B"], ["H30", "Gold", "#D9A441"], ["H31", "Silver", "#B5B7B2"], ["H32", "Claret", "#64344C"]
  ],
  artkal: [
    ["A01", "White", "#F8F7F1"], ["A02", "Black", "#111111"], ["A03", "Cool Grey", "#90938E"], ["A04", "Warm Grey", "#BDB6AA"],
    ["A05", "Bright Red", "#E13538"], ["A06", "Tomato", "#F35F43"], ["A07", "Orange", "#F38628"], ["A08", "Yellow", "#F7D94A"],
    ["A09", "Lime", "#B8E145"], ["A10", "Green", "#34A95B"], ["A11", "Emerald", "#19805B"], ["A12", "Mint", "#91E0BC"],
    ["A13", "Cyan", "#38BDE0"], ["A14", "Blue", "#2E6FD0"], ["A15", "Navy", "#183970"], ["A16", "Violet", "#6F50BD"],
    ["A17", "Lavender", "#C2B4EA"], ["A18", "Rose", "#F39CBC"], ["A19", "Magenta", "#D93B8A"], ["A20", "Wine", "#84304F"],
    ["A21", "Skin", "#F2C09A"], ["A22", "Tan", "#D1A16F"], ["A23", "Coffee", "#8A5735"], ["A24", "Chocolate", "#543329"],
    ["A25", "Ivory", "#FFF0CE"], ["A26", "Aqua", "#7AD6D1"], ["A27", "Sky", "#A7D9F4"], ["A28", "Coral", "#FF836F"],
    ["A29", "Olive", "#7C8B42"], ["A30", "Teal", "#176F78"], ["A31", "Pale Yellow", "#F7ECA0"], ["A32", "Pale Pink", "#F8C9DA"]
  ]
};
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

function paletteForBrand(brand) {
  const palette = beadPalettes[brand] || beadPalettes.generic;
  return palette.map(([code, name, hex]) => ({ code, name, hex }));
}

function nearestBeadColor(rgb, palette) {
  let best = palette[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of palette) {
    const target = hexToRgb(item.hex);
    if (!target) continue;
    const distance = Math.pow(rgb.r - target.r, 2) + Math.pow(rgb.g - target.g, 2) + Math.pow(rgb.b - target.b, 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = item;
    }
  }
  return best;
}

function materialListFromCells(cells, selectedPalette) {
  const bucket = {};
  for (const code of cells) {
    bucket[code] = (bucket[code] || 0) + 1;
  }

  return selectedPalette
    .map((item, index) => ({
      ...item,
      index: index + 1,
      count: bucket[item.code] || 0
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
}

function clampGridSize(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(8, Math.min(156, parsed));
}

function beadRatioValue(value, gridWidth, gridHeight) {
  if (value === "square") return 1;
  if (value === "landscape43") return 4 / 3;
  if (value === "portrait34") return 3 / 4;
  if (value === "wide") return 16 / 9;
  return gridWidth / gridHeight;
}

function beadCropClass(value) {
  const option = beadRatioOptions.find((item) => item.value === value);
  return option ? option.className : "crop-free";
}

function beadCropScale(value, gridWidth, gridHeight) {
  const ratio = beadRatioValue(value, gridWidth, gridHeight);
  if (Math.abs(ratio - 1) < 0.01) return "1:1";
  if (value === "landscape43") return "4:3";
  if (value === "portrait34") return "3:4";
  if (value === "wide") return "16:9";

  const width = clampGridSize(gridWidth, 72);
  const height = clampGridSize(gridHeight, 72);
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function gcd(a, b) {
  let left = Math.abs(Number.parseInt(a, 10) || 1);
  let right = Math.abs(Number.parseInt(b, 10) || 1);
  while (right) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left || 1;
}

function sourceCropRectForRatio(info, ratio, offsetX = 0, offsetY = 0) {
  const sourceRatio = info.width / info.height;
  if (Math.abs(sourceRatio - ratio) < 0.01) {
    return { sx: 0, sy: 0, sw: info.width, sh: info.height };
  }

  if (sourceRatio > ratio) {
    const sw = info.height * ratio;
    const maxX = Math.max(0, info.width - sw);
    return { sx: Math.max(0, Math.min(maxX, maxX / 2 + offsetX * maxX / 2)), sy: 0, sw, sh: info.height };
  }

  const sh = info.width / ratio;
  const maxY = Math.max(0, info.height - sh);
  return { sx: 0, sy: Math.max(0, Math.min(maxY, maxY / 2 + offsetY * maxY / 2)), sw: info.width, sh };
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
  if (toolId === "pixel") {
    return {
      needsImage,
      controlTitle: "裁剪图片",
      controlDesc: "选择生成区域、画板边长和构图比例"
    };
  }
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
    correctionRulerLeft: 0,
    correctionRulerWidth: 0,
    operationStatus: "",
    selectedFilter: "none",
    selectedPixel: 72,
    beadStage: "crop",
    beadGridWidth: 72,
    beadGridHeight: 72,
    beadCropRatio: "custom",
    beadCropFrameClass: "crop-free",
    beadCropOffsetX: 0,
    beadCropOffsetY: 0,
    beadCropDragStartX: 0,
    beadCropDragStartY: 0,
    beadCropDragOffsetX: 0,
    beadCropDragOffsetY: 0,
    beadCropImageStyle: "transform: scale(1.08);",
    beadBrand: "generic",
    beadColorCount: 32,
    beadGenerating: false,
    beadShowGrid: true,
    beadShowCodes: true,
    beadMirror: false,
    beadPatternPath: "",
    beadMaterials: [],
    beadPatternSummary: "",
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
    rotateMarks,
    correctTicks,
    filterOptions,
    pixelOptions,
    beadRatioOptions,
    beadBrandOptions,
    beadColorOptions,
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
    const nextState = {
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
    };
    if (tool.id === "pixel") {
      Object.assign(nextState, {
        beadStage: "crop",
        beadPatternPath: "",
        beadMaterials: [],
        beadPatternSummary: "",
        beadGenerating: false,
        beadCropFrameClass: beadCropClass(this.data.beadCropRatio)
      });
    }
    this.setData(nextState);
    this.updatePreviewClass();
    this.updateImageEditorClass();
    if (displayPath && shouldExtractPalette(tool.id)) {
      this.extractPalette(displayPath);
    }
  },

  updatePreviewClass() {
    const { tool, selectedFilter, selectedFilm, selectedAi } = this.data;
    let previewClass = "";
    if (tool === "filter") previewClass = `filter-${selectedFilter}`;
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
    if (this.data.tool === "pixel") {
      this.chooseBeadImageForCrop();
      return;
    }

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
          showImagePreview: true,
          beadStage: this.data.tool === "pixel" ? "crop" : this.data.beadStage,
          beadPatternPath: "",
          beadMaterials: [],
          beadPatternSummary: "",
          beadGenerating: false,
          beadCropOffsetX: 0,
          beadCropOffsetY: 0,
          beadCropImageStyle: "transform: scale(1.08);",
          controlTitle: this.data.tool === "pixel" ? "裁剪图片" : this.data.controlTitle,
          controlDesc: this.data.tool === "pixel" ? "选择生成区域、画板边长和构图比例" : this.data.controlDesc
        });
        if (shouldExtractPalette(this.data.tool)) {
          this.extractPalette(filePath);
        }
      }
    });
  },

  resetBeadCropState(filePath) {
    this.setData({
      filePath,
      resultPath: filePath,
      displayPath: filePath,
      showImagePreview: true,
      beadStage: "crop",
      beadPatternPath: "",
      beadMaterials: [],
      beadPatternSummary: "",
      beadGenerating: false,
      beadCropOffsetX: 0,
      beadCropOffsetY: 0,
      beadCropImageStyle: "transform: scale(1.08);",
      controlTitle: "裁剪图片",
      controlDesc: "选择生成区域、画板边长和构图比例"
    });
  },

  chooseBeadImageForCrop() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const filePath = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
        if (!filePath) return;
        this.cropBeadImage(filePath);
      }
    });
  },

  cropCurrentBeadImage() {
    const sourcePath = this.data.filePath || this.data.displayPath;
    if (!sourcePath) {
      this.chooseBeadImageForCrop();
      return;
    }
    this.cropBeadImage(sourcePath);
  },

  cropBeadImage(sourcePath) {
    if (!sourcePath) return;
    if (typeof wx.cropImage !== "function") {
      this.resetBeadCropState(sourcePath);
      wx.showToast({ title: "当前微信版本不支持系统裁剪", icon: "none" });
      return;
    }

    wx.cropImage({
      src: sourcePath,
      cropScale: beadCropScale(this.data.beadCropRatio, this.data.beadGridWidth, this.data.beadGridHeight),
      success: (res) => {
        const filePath = res.tempFilePath || sourcePath;
        this.resetBeadCropState(filePath);
      },
      fail: (err) => {
        if (err && /cancel/i.test(err.errMsg || "")) return;
        console.warn("Bead crop image failed:", err);
        this.resetBeadCropState(sourcePath);
        wx.showToast({ title: "裁剪失败，已保留原图", icon: "none" });
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

  handleHeaderBack() {
    if (this.data.tool === "pixel" && this.data.beadStage === "pattern") {
      this.backToBeadCrop();
      return;
    }
    this.goBack();
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
    this.setData({
      imageEditMode: value,
      selectedCorrection: value === "correct" && !this.data.selectedCorrection ? "vertical" : this.data.selectedCorrection
    });
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
    this.setData({
      selectedCorrection: value,
      operationStatus: event.currentTarget.dataset.label || "已调整矫正"
    });
    this.updateImageEditorClass();
  },

  setCorrectionValue(value) {
    const nextValue = Math.max(-40, Math.min(40, Math.round(Number(value || 0))));
    this.setData({
      correctionValue: nextValue,
      correctionPointerStyle: `left: ${((nextValue + 40) / 80) * 100}%;`,
      selectedCorrection: this.data.selectedCorrection || "vertical",
      operationStatus: `矫正 ${nextValue}`
    });
    this.updateImageEditorClass();
  },

  setCorrectionValueFromTouch(touch) {
    if (!touch) return;
    const width = Number(this.data.correctionRulerWidth || 0);
    const left = Number(this.data.correctionRulerLeft || 0);
    if (!width) return;
    const progress = Math.max(0, Math.min(1, (touch.clientX - left) / width));
    this.setCorrectionValue(progress * 80 - 40);
  },

  onCorrectionRulerStart(event) {
    const touch = event.touches && event.touches[0];
    wx.createSelectorQuery()
      .in(this)
      .select(".correct-ruler")
      .boundingClientRect((rect) => {
        if (!rect) return;
        const progress = touch ? Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width)) : 0.5;
        this.setData({
          correctionRulerLeft: rect.left,
          correctionRulerWidth: rect.width
        });
        this.setCorrectionValue(progress * 80 - 40);
      })
      .exec();
  },

  onCorrectionRulerMove(event) {
    const touch = event.touches && event.touches[0];
    this.setCorrectionValueFromTouch(touch);
  },

  onCorrectionValueChange(event) {
    const value = Number(event.detail.value || 0);
    this.setCorrectionValue(value);
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
    const size = clampGridSize(event.currentTarget.dataset.value, 72);
    this.setData({
      selectedPixel: size,
      beadGridWidth: size,
      beadGridHeight: size,
      beadStage: "crop",
      beadPatternPath: "",
      beadMaterials: [],
      beadPatternSummary: "",
      beadGenerating: false,
      beadCropOffsetX: 0,
      beadCropOffsetY: 0,
      beadCropImageStyle: "transform: scale(1.08);",
      resultPath: this.data.filePath,
      displayPath: this.data.filePath,
      controlTitle: "裁剪图片",
      controlDesc: "选择生成区域、画板边长和构图比例"
    });
    this.updatePreviewClass();
  },

  onBeadGridInput(event) {
    const axis = event.currentTarget.dataset.axis;
    const key = axis === "height" ? "beadGridHeight" : "beadGridWidth";
    const nextValue = clampGridSize(event.detail.value, this.data[key] || 48);
    this.setData({
      [key]: nextValue,
      selectedPixel: "",
      beadStage: "crop",
      beadPatternPath: "",
      beadMaterials: [],
      beadPatternSummary: "",
      beadGenerating: false,
      beadCropOffsetX: 0,
      beadCropOffsetY: 0,
      beadCropImageStyle: "transform: scale(1.08);",
      resultPath: this.data.filePath,
      displayPath: this.data.filePath,
      controlTitle: "裁剪图片",
      controlDesc: "选择生成区域、画板边长和构图比例"
    });
    this.updatePreviewClass();
  },

  setBeadCropRatio(event) {
    const value = event.currentTarget.dataset.value || "custom";
    this.setData({
      beadCropRatio: value,
      beadCropFrameClass: beadCropClass(value),
      beadCropOffsetX: 0,
      beadCropOffsetY: 0,
      beadCropImageStyle: "transform: scale(1.08);",
      beadStage: "crop",
      beadPatternPath: "",
      beadMaterials: [],
      beadPatternSummary: "",
      beadGenerating: false,
      resultPath: this.data.filePath,
      displayPath: this.data.filePath,
      controlTitle: "裁剪图片",
      controlDesc: "选择生成区域、画板边长和构图比例"
    });
    this.updatePreviewClass();
  },

  updateBeadCropImageStyle() {
    const offsetX = Number(this.data.beadCropOffsetX || 0);
    const offsetY = Number(this.data.beadCropOffsetY || 0);
    this.setData({
      beadCropImageStyle: `transform: translate(${Math.round(offsetX * 60)}rpx, ${Math.round(offsetY * 60)}rpx) scale(1.08);`
    });
  },

  onBeadCropStart(event) {
    if (this.data.tool !== "pixel" || this.data.beadStage !== "crop") return;
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    this.setData({
      beadCropDragStartX: touch.clientX,
      beadCropDragStartY: touch.clientY,
      beadCropDragOffsetX: Number(this.data.beadCropOffsetX || 0),
      beadCropDragOffsetY: Number(this.data.beadCropOffsetY || 0)
    });
  },

  onBeadCropMove(event) {
    if (this.data.tool !== "pixel" || this.data.beadStage !== "crop") return;
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    const nextX = Math.max(-1, Math.min(1, Number(this.data.beadCropDragOffsetX || 0) - (touch.clientX - Number(this.data.beadCropDragStartX || touch.clientX)) / 180));
    const nextY = Math.max(-1, Math.min(1, Number(this.data.beadCropDragOffsetY || 0) - (touch.clientY - Number(this.data.beadCropDragStartY || touch.clientY)) / 180));
    this.setData({
      beadCropOffsetX: nextX,
      beadCropOffsetY: nextY
    });
    this.updateBeadCropImageStyle();
  },

  setBeadBrand(event) {
    this.setData({
      beadBrand: event.currentTarget.dataset.value || "generic",
      beadStage: "crop",
      beadPatternPath: "",
      beadMaterials: [],
      beadPatternSummary: "",
      beadGenerating: false,
      resultPath: this.data.filePath,
      displayPath: this.data.filePath,
      controlTitle: "裁剪图片",
      controlDesc: "选择生成区域、画板边长和构图比例"
    });
    this.updatePreviewClass();
  },

  setBeadColorCount(event) {
    const count = Number(event.currentTarget.dataset.value || 16);
    this.setData({
      beadColorCount: count,
      beadStage: "crop",
      beadPatternPath: "",
      beadMaterials: [],
      beadPatternSummary: "",
      beadGenerating: false,
      resultPath: this.data.filePath,
      displayPath: this.data.filePath,
      controlTitle: "裁剪图片",
      controlDesc: "选择生成区域、画板边长和构图比例"
    });
    this.updatePreviewClass();
  },

  async toggleBeadOption(event) {
    const key = event.currentTarget.dataset.key;
    if (key === "grid") this.setData({ beadShowGrid: !this.data.beadShowGrid });
    if (key === "codes") this.setData({ beadShowCodes: !this.data.beadShowCodes });
    if (key === "mirror") this.setData({ beadMirror: !this.data.beadMirror, beadPatternPath: "", beadPatternSummary: "", beadMaterials: [] });
    if (this.data.beadStage === "pattern") await this.generateBeadPattern();
  },

  async nextBeadStep() {
    await this.generateBeadPattern();
  },

  backToBeadCrop() {
    this.setData({
      beadStage: "crop",
      resultPath: this.data.filePath,
      displayPath: this.data.filePath,
      beadPatternPath: "",
      beadMaterials: [],
      beadPatternSummary: "",
      beadGenerating: false,
      controlTitle: "裁剪图片",
      controlDesc: "选择生成区域、画板边长和构图比例"
    });
  },

  buildBeadPatternImage() {
    const sourcePath = this.data.filePath;
    if (!sourcePath) return Promise.reject(new Error("请先选择图片"));

    const gridWidth = clampGridSize(this.data.beadGridWidth, 48);
    const gridHeight = clampGridSize(this.data.beadGridHeight, 48);
    const fullPalette = paletteForBrand(this.data.beadBrand);
    const colorLimit = Math.min(Number(this.data.beadColorCount || 16), fullPalette.length);
    const brandLabel = (beadBrandOptions.find((item) => item.value === this.data.beadBrand) || beadBrandOptions[0]).label;
    const cropRatio = beadRatioValue(this.data.beadCropRatio, gridWidth, gridHeight);

    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: sourcePath,
        success: (info) => {
          const cropRect = sourceCropRectForRatio(info, cropRatio, Number(this.data.beadCropOffsetX || 0), Number(this.data.beadCropOffsetY || 0));
          const ctx = wx.createCanvasContext(EDIT_CANVAS_ID, this);
          ctx.clearRect(0, 0, EDIT_CANVAS_SIZE, EDIT_CANVAS_SIZE);
          if (this.data.beadMirror) {
            ctx.save();
            ctx.translate(gridWidth, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(info.path, cropRect.sx, cropRect.sy, cropRect.sw, cropRect.sh, 0, 0, gridWidth, gridHeight);
            ctx.restore();
          } else {
            ctx.drawImage(info.path, cropRect.sx, cropRect.sy, cropRect.sw, cropRect.sh, 0, 0, gridWidth, gridHeight);
          }
          ctx.draw(false, () => {
            wx.canvasGetImageData({
              canvasId: EDIT_CANVAS_ID,
              x: 0,
              y: 0,
              width: gridWidth,
              height: gridHeight,
              success: (res) => {
                const pixels = res.data || [];
                const sampled = [];
                const firstPassCounts = {};
                for (let index = 0; index < pixels.length; index += 4) {
                  const alpha = pixels[index + 3];
                  const rgb = alpha < 30
                    ? { r: 248, g: 247, b: 240 }
                    : { r: pixels[index], g: pixels[index + 1], b: pixels[index + 2] };
                  const nearest = nearestBeadColor(rgb, fullPalette);
                  sampled.push(rgb);
                  firstPassCounts[nearest.code] = (firstPassCounts[nearest.code] || 0) + 1;
                }

                const selectedCodes = Object.entries(firstPassCounts)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, colorLimit)
                  .map(([code]) => code);
                const selectedPalette = selectedCodes
                  .map((code) => fullPalette.find((item) => item.code === code))
                  .filter(Boolean);
                const palette = selectedPalette.length ? selectedPalette : fullPalette.slice(0, colorLimit);
                const cells = sampled.map((rgb) => nearestBeadColor(rgb, palette).code);
                const materials = materialListFromCells(cells, palette);
                const materialByCode = materials.reduce((map, item, index) => {
                  map[item.code] = { ...item, index: index + 1 };
                  return map;
                }, {});
                const totalCount = gridWidth * gridHeight;

                ctx.clearRect(0, 0, EDIT_CANVAS_SIZE, EDIT_CANVAS_SIZE);
                ctx.setFillStyle("#f8f5ee");
                ctx.fillRect(0, 0, EDIT_CANVAS_SIZE, EDIT_CANVAS_SIZE);

                ctx.setFillStyle("#111111");
                ctx.setFontSize(34);
                ctx.setTextAlign("left");
                ctx.fillText("拼豆图纸", 32, 54);
                ctx.setFontSize(20);
                ctx.setFillStyle("#777b72");
                ctx.fillText(`${gridWidth} x ${gridHeight} 格 · ${brandLabel} · ${materials.length} 色 · ${totalCount} 颗`, 32, 84);

                const maxGridWidth = 896;
                const maxGridHeight = 640;
                const cellSize = Math.max(4, Math.floor(Math.min(maxGridWidth / gridWidth, maxGridHeight / gridHeight)));
                const gridPixelWidth = cellSize * gridWidth;
                const gridPixelHeight = cellSize * gridHeight;
                const gridX = Math.round((EDIT_CANVAS_SIZE - gridPixelWidth) / 2);
                const gridY = 108;

                ctx.setFillStyle("#ffffff");
                ctx.fillRect(gridX - 10, gridY - 10, gridPixelWidth + 20, gridPixelHeight + 20);
                ctx.setStrokeStyle("#e2dccd");
                ctx.setLineWidth(2);
                ctx.strokeRect(gridX - 10, gridY - 10, gridPixelWidth + 20, gridPixelHeight + 20);

                for (let row = 0; row < gridHeight; row += 1) {
                  for (let col = 0; col < gridWidth; col += 1) {
                    const code = cells[row * gridWidth + col];
                    const material = materialByCode[code] || palette[0];
                    const x = gridX + col * cellSize;
                    const y = gridY + row * cellSize;
                    ctx.setFillStyle(material.hex);
                    if (cellSize >= 8) {
                      ctx.beginPath();
                      ctx.arc(x + cellSize / 2, y + cellSize / 2, Math.max(2, cellSize * 0.42), 0, Math.PI * 2);
                      ctx.fill();
                    } else {
                      ctx.fillRect(x, y, cellSize, cellSize);
                    }
                    if (this.data.beadShowCodes && cellSize >= 15) {
                      ctx.setFillStyle(luminance(material.hex) > 0.55 ? "#111111" : "#ffffff");
                      ctx.setFontSize(Math.max(8, Math.floor(cellSize * 0.42)));
                      ctx.setTextAlign("center");
                      ctx.fillText(String(material.index || ""), x + cellSize / 2, y + cellSize * 0.66);
                    }
                  }
                }

                if (this.data.beadShowGrid && cellSize >= 10) {
                  ctx.setStrokeStyle("rgba(17,17,17,0.12)");
                  ctx.setLineWidth(1);
                  for (let col = 0; col <= gridWidth; col += 1) {
                    const x = gridX + col * cellSize;
                    ctx.beginPath();
                    ctx.moveTo(x, gridY);
                    ctx.lineTo(x, gridY + gridPixelHeight);
                    ctx.stroke();
                  }
                  for (let row = 0; row <= gridHeight; row += 1) {
                    const y = gridY + row * cellSize;
                    ctx.beginPath();
                    ctx.moveTo(gridX, y);
                    ctx.lineTo(gridX + gridPixelWidth, y);
                    ctx.stroke();
                  }
                }

                const legendY = Math.min(gridY + gridPixelHeight + 38, 790);
                ctx.setTextAlign("left");
                ctx.setFillStyle("#111111");
                ctx.setFontSize(24);
                ctx.fillText("材料清单", 32, legendY);
                ctx.setFontSize(18);
                const legendItems = materials.slice(0, 24);
                const columnWidth = 224;
                const rowHeight = 30;
                legendItems.forEach((item, index) => {
                  const col = index % 4;
                  const row = Math.floor(index / 4);
                  const x = 32 + col * columnWidth;
                  const y = legendY + 30 + row * rowHeight;
                  ctx.setFillStyle(item.hex);
                  ctx.fillRect(x, y - 18, 20, 20);
                  ctx.setStrokeStyle("rgba(17,17,17,0.18)");
                  ctx.strokeRect(x, y - 18, 20, 20);
                  ctx.setFillStyle("#111111");
                  ctx.fillText(`${index + 1}. ${item.code} ${item.count}`, x + 28, y);
                });
                if (materials.length > legendItems.length) {
                  ctx.setFillStyle("#777b72");
                  ctx.fillText(`另有 ${materials.length - legendItems.length} 色请查看页面清单`, 32, 944);
                }

                ctx.draw(false, () => {
                  wx.canvasToTempFilePath({
                    canvasId: EDIT_CANVAS_ID,
                    x: 0,
                    y: 0,
                    width: EDIT_CANVAS_SIZE,
                    height: EDIT_CANVAS_SIZE,
                    destWidth: EDIT_CANVAS_SIZE,
                    destHeight: EDIT_CANVAS_SIZE,
                    fileType: "png",
                    quality: 1,
                    success: (output) => resolve({
                      path: output.tempFilePath,
                      materials,
                      summary: `${gridWidth}x${gridHeight} · ${brandLabel} · ${materials.length}色 · ${totalCount}颗`
                    }),
                    fail: (err) => reject(new Error(err.errMsg || "导出图纸失败"))
                  }, this);
                });
              },
              fail: (err) => reject(new Error(err.errMsg || "读取像素失败"))
            });
          });
        },
        fail: (err) => reject(new Error(err.errMsg || "读取图片失败"))
      });
    });
  },

  async generateBeadPattern() {
    if (!this.data.filePath) {
      wx.showToast({ title: "请先选择图片", icon: "none" });
      return null;
    }

    this.setData({
      beadStage: "pattern",
      beadGenerating: true,
      controlTitle: "拼豆图纸",
      controlDesc: "查看材料清单，切换网格和色号后导出"
    });
    wx.showLoading({ title: "正在生成" });
    try {
      const result = await this.buildBeadPatternImage();
      this.setData({
        beadStage: "pattern",
        beadPatternPath: result.path,
        beadMaterials: result.materials,
        beadPatternSummary: result.summary,
        resultPath: result.path,
        displayPath: result.path,
        showImagePreview: true,
        previewClass: "",
        beadGenerating: false,
        controlTitle: "拼豆图纸",
        controlDesc: "查看材料清单，切换网格和色号后导出"
      });
      wx.hideLoading();
      wx.showToast({ title: "图纸已生成", icon: "success" });
      return result.path;
    } catch (err) {
      wx.hideLoading();
      console.warn("Generate bead pattern failed:", err);
      this.setData({
        beadStage: "crop",
        beadGenerating: false,
        controlTitle: "裁剪图片",
        controlDesc: "选择生成区域、画板边长和构图比例"
      });
      wx.showToast({ title: err.message || "生成失败", icon: "none" });
      return null;
    }
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

  async saveToAlbum() {
    let path = this.data.resultPath || this.data.filePath;
    if (this.data.needsImage && !path) {
      wx.showToast({ title: "请先选择图片", icon: "none" });
      return;
    }

    if (!this.data.needsImage) {
      wx.showToast({ title: "结果已可复制使用", icon: "none" });
      return;
    }

    if (this.data.tool === "pixel") {
      path = this.data.beadPatternPath || await this.generateBeadPattern();
      if (!path) return;
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

    if (this.data.tool === "pixel") {
      await this.generateBeadPattern();
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
