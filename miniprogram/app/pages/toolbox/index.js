const { tools: editorTools } = require("../../utils/tools");
const { requireRegistered } = require("../../utils/auth");

const categories = ["常用", "图片", "文字", "文档", "开发", "实用"];
const editorToolIds = editorTools.map((tool) => tool.id);

const toolboxTools = [
  { id: "crop", name: "图片编辑", category: "图片", desc: "裁剪与基础调整", iconText: "⌗", enabled: true },
  { id: "imageCompress", name: "图片压缩", category: "图片", desc: "减小体积不失真", iconText: "▱", enabled: true, page: "/pages/image-compress/index" },
  { id: "longImage", name: "长图拼接", category: "图片", desc: "多张图片纵向拼接", iconText: "▥", enabled: true, page: "/pages/long-image/index" },
  { id: "qrCode", name: "二维码", category: "实用", desc: "生成与识别", iconText: "▦", enabled: true, page: "/pages/qr-code/index" },
  { id: "textClean", name: "文本整理", category: "文字", desc: "排版、去空行、去重", iconText: "≡", enabled: true, page: "/pages/text-clean/index" },
  { id: "colorPick", name: "图片取色", category: "图片", desc: "提取主色与辅助色", iconText: "◎", enabled: true },
  { id: "watermark", name: "加水印", category: "图片", desc: "文字和日期印记", iconText: "T", enabled: true },
  { id: "pixel", name: "拼豆图纸", category: "图片", desc: "图片转拼豆图纸", iconText: "▦", enabled: true },
  { id: "filter", name: "滤镜风格", category: "图片", desc: "胶片、漫画、低饱和", iconText: "◐", enabled: true },
  { id: "palette", name: "色卡配色", category: "图片", desc: "生成灵感色卡", iconText: "✦", enabled: true },
  { id: "gradient", name: "渐变色卡", category: "图片", desc: "封面渐变方案", iconText: "⌁", enabled: true },
  { id: "contrast", name: "对比度检测", category: "图片", desc: "检查文字可读性", iconText: "◑", enabled: true },
  { id: "rgbhex", name: "RGB 转 HEX", category: "图片", desc: "颜色格式转换", iconText: "#", enabled: true },
  { id: "film", name: "胶片感", category: "图片", desc: "暖色颗粒氛围", iconText: "◌", enabled: true },
  { id: "nineGrid", name: "九宫格切图", category: "图片", desc: "社交分享切图", iconText: "田", enabled: true, page: "/pages/nine-grid/index" },
  { id: "mosaic", name: "马赛克", category: "图片", desc: "遮挡隐私信息", iconText: "▧", enabled: true, page: "/pages/mosaic/index" },

  { id: "wordCount", name: "字数统计", category: "文字", desc: "字符、段落统计", iconText: "字", enabled: true, page: "/pages/word-count/index" },
  { id: "textDeduplicate", name: "去重排序", category: "文字", desc: "重复行清理与排序", iconText: "⇅", enabled: true, page: "/pages/text-clean/index?action=dedupe" },
  { id: "caseConvert", name: "大小写转换", category: "文字", desc: "英文格式转换", iconText: "Aa", enabled: true, page: "/pages/text-clean/index?action=upper" },
  { id: "urlExtract", name: "URL 提取", category: "文字", desc: "从文本提取链接", iconText: "↗", enabled: true, page: "/pages/text-clean/index?action=url" },

  { id: "markdown", name: "Markdown 预览", category: "文档", desc: "实时渲染文档", iconText: "M↓", enabled: true, page: "/pages/markdown-preview/index" },

  { id: "json", name: "JSON 格式化", category: "开发", desc: "美化、压缩与校验", iconText: "{}", enabled: true, page: "/pages/dev-tool/index?tool=json" },
  { id: "base64", name: "Base64", category: "开发", desc: "编码与解码", iconText: "64", enabled: true, page: "/pages/dev-tool/index?tool=base64" },
  { id: "urlCodec", name: "URL 编解码", category: "开发", desc: "参数编码与还原", iconText: "↗", enabled: true, page: "/pages/dev-tool/index?tool=urlCodec" },
  { id: "timestamp", name: "时间戳", category: "开发", desc: "Unix 时间转换", iconText: "◷", enabled: true, page: "/pages/dev-tool/index?tool=timestamp" },
  { id: "uuid", name: "UUID 生成", category: "开发", desc: "生成唯一标识", iconText: "ID", enabled: true, page: "/pages/dev-tool/index?tool=uuid" },
  { id: "jwt", name: "JWT 解析", category: "开发", desc: "解析 Header 与 Payload", iconText: "J", enabled: true, page: "/pages/dev-tool/index?tool=jwt" },
  { id: "hash", name: "哈希 / 校验", category: "开发", desc: "MD5、SHA 系列", iconText: "#", enabled: true, page: "/pages/dev-tool/index?tool=hash" },
  { id: "regex", name: "正则测试", category: "开发", desc: "实时匹配与替换", iconText: ".*", enabled: true, page: "/pages/dev-tool/index?tool=regex" },
  { id: "textDiff", name: "文本 Diff", category: "开发", desc: "对比文本差异", iconText: "⇄", enabled: true, page: "/pages/dev-tool/index?tool=textDiff" },
  { id: "jsonYaml", name: "JSON-YAML", category: "开发", desc: "数据格式互转", iconText: "↔", enabled: true, page: "/pages/dev-tool/index?tool=jsonYaml" },
  { id: "radix", name: "进制转换", category: "开发", desc: "2/8/10/16 进制", iconText: "01", enabled: true, page: "/pages/dev-tool/index?tool=radix" },
  { id: "cron", name: "Cron 解析", category: "开发", desc: "解析 Cron 表达式", iconText: "▣", enabled: true, page: "/pages/dev-tool/index?tool=cron" },

  { id: "password", name: "随机密码", category: "实用", desc: "日常密码生成", iconText: "***", enabled: true, page: "/pages/utility-tool/index?tool=password" },
  { id: "dateCalc", name: "日期计算", category: "实用", desc: "日期间隔与推算", iconText: "日", enabled: true, page: "/pages/utility-tool/index?tool=dateCalc" },
  { id: "unitConvert", name: "单位换算", category: "实用", desc: "常用单位转换", iconText: "⇄", enabled: true, page: "/pages/utility-tool/index?tool=unitConvert" },
  { id: "random", name: "随机数", category: "实用", desc: "范围随机生成", iconText: "?", enabled: true, page: "/pages/utility-tool/index?tool=random" }
];

const commonToolIds = ["longImage", "imageCompress", "qrCode", "textClean", "crop", "nineGrid", "wordCount", "json", "timestamp", "watermark", "markdown", "mosaic"];
const featuredIds = {
  常用: "crop",
  图片: "crop",
  文字: "textClean",
  文档: "markdown",
  开发: "json",
  实用: "qrCode"
};
const RECENT_TOOLS_STORAGE_KEY = "toolbox-recent-tools-v1";
const MAX_RECENT_TOOLS = 6;

const recommendCards = [
  { type: "image", typeLabel: "图片", title: "自然光影", meta: "图片参考", image: "/assets/reference-image.jpg" },
  { type: "md", typeLabel: "MD", title: "周末手记", meta: "文档参考" },
  { type: "combo", typeLabel: "组合", title: "场景组合", meta: "组合参考", images: ["/assets/reference-combo-a.jpg", "/assets/reference-combo-b.jpg"] }
];
const promoImages = [
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1493612276216-ee3925520721?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=900&q=80"
];

function toolsForCategory(category) {
  if (category === "常用") return commonToolIds.map((id) => toolboxTools.find((tool) => tool.id === id)).filter(Boolean);
  return toolboxTools.filter((tool) => tool.category === category);
}

function buildCategoryView(category, showAll = false) {
  const categoryTools = toolsForCategory(category);
  const featuredId = featuredIds[category];
  const featuredTool = categoryTools.find((tool) => tool.id === featuredId) || categoryTools[0] || null;
  const remaining = categoryTools.filter((tool) => !featuredTool || tool.id !== featuredTool.id);
  return {
    featuredTool,
    gridTools: remaining.slice(0, 4),
    listTools: showAll ? remaining.slice(4) : remaining.slice(4, 10),
    totalTools: categoryTools.length,
    allExpanded: showAll || remaining.length <= 10
  };
}

function getRecentToolIds() {
  try {
    const stored = wx.getStorageSync(RECENT_TOOLS_STORAGE_KEY);
    if (!Array.isArray(stored)) return [];
    return stored.filter((id) => toolboxTools.some((tool) => tool.id === id && tool.enabled)).slice(0, MAX_RECENT_TOOLS);
  } catch (error) {
    return [];
  }
}

function getRecentTools() {
  return getRecentToolIds().map((id) => toolboxTools.find((tool) => tool.id === id)).filter(Boolean);
}

Page({
  data: {
    category: "常用",
    categories,
    promoImages,
    recommendCards,
    recentTools: [],
    searchKeyword: "",
    searchResults: [],
    isSearching: false,
    ...buildCategoryView("常用")
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 1 });
    this.setData({ recentTools: getRecentTools() });
  },

  selectCategory(event) {
    const category = event.currentTarget.dataset.category || "常用";
    this.setData({ category, searchKeyword: "", searchResults: [], isSearching: false, ...buildCategoryView(category) });
  },

  searchTools(event) {
    const searchKeyword = String(event.detail.value || "").trim();
    const keyword = searchKeyword.toLowerCase();
    const searchResults = keyword
      ? toolboxTools.filter((tool) => `${tool.name}${tool.desc}${tool.category}`.toLowerCase().includes(keyword))
      : [];
    this.setData({ searchKeyword, searchResults, isSearching: Boolean(keyword) });
  },

  clearSearch() {
    this.setData({ searchKeyword: "", searchResults: [], isSearching: false });
  },

  openTool(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    const tool = toolboxTools.find((item) => item.id === id);
    const editorTool = editorTools.find((item) => item.id === id);

    if (editorTool && editorTool.locked && !requireRegistered()) return;
    if (tool && tool.enabled && tool.page) {
      this.recordRecentTool(id);
      wx.navigateTo({ url: tool.page });
      return;
    }
    if (tool && tool.enabled && editorToolIds.includes(id)) {
      this.recordRecentTool(id);
      wx.navigateTo({ url: `/pages/editor/index?tool=${id}` });
      return;
    }

    wx.showToast({ title: `${tool ? tool.name : "该工具"}即将上线`, icon: "none" });
  },

  recordRecentTool(id) {
    const recentIds = [id].concat(getRecentToolIds().filter((item) => item !== id)).slice(0, MAX_RECENT_TOOLS);
    try {
      wx.setStorageSync(RECENT_TOOLS_STORAGE_KEY, recentIds);
    } catch (error) {
      // Storage failure should not block opening the tool.
    }
    this.setData({ recentTools: recentIds.map((toolId) => toolboxTools.find((tool) => tool.id === toolId)).filter(Boolean) });
  },

  clearRecentTools() {
    try {
      wx.removeStorageSync(RECENT_TOOLS_STORAGE_KEY);
    } catch (error) {
      // Keep the UI responsive even when storage is unavailable.
    }
    this.setData({ recentTools: [] });
  },

  showAllTools() {
    this.setData(buildCategoryView(this.data.category, true));
  },

  openDiary() {
    wx.switchTab({ url: "/pages/diary/index" });
  },

  openReferenceCard(event) {
    const type = event.currentTarget.dataset.reference;
    if (!["image", "md", "combo"].includes(type)) return;
    wx.navigateTo({ url: `/pages/card-detail/index?reference=${encodeURIComponent(type)}` });
  }
});
