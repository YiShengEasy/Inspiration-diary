const tools = [
  {
    id: "crop",
    name: "图片裁剪",
    category: "常用",
    desc: "比例、自由裁切",
    accent: "green",
    iconKey: "crop",
    iconText: "⌗",
    local: true
  },
  {
    id: "colorPick",
    name: "图片取色",
    category: "色彩",
    desc: "提取主色和辅助色",
    accent: "lime",
    iconKey: "palette",
    iconText: "◎",
    local: false
  },
  {
    id: "pixel",
    name: "像素风",
    category: "风格",
    desc: "本地风格转化",
    accent: "lime",
    iconKey: "grid",
    iconText: "▦",
    local: true
  },
  {
    id: "filter",
    name: "滤镜风格",
    category: "风格",
    desc: "胶片、漫画、低饱和",
    accent: "mint",
    iconKey: "palette",
    iconText: "◐",
    local: true
  },
  {
    id: "palette",
    name: "色卡配色",
    category: "色彩",
    desc: "生成灵感色卡",
    accent: "color",
    iconKey: "sparkles",
    iconText: "✦",
    local: false
  },
  {
    id: "gradient",
    name: "渐变色卡",
    category: "色彩",
    desc: "封面渐变方案",
    accent: "color",
    iconKey: "droplets",
    iconText: "⌁",
    local: false
  },
  {
    id: "contrast",
    name: "对比度检测",
    category: "色彩",
    desc: "检查文字可读性",
    accent: "plain",
    iconKey: "check",
    iconText: "✓",
    local: false
  },
  {
    id: "rgbhex",
    name: "RGB 转 HEX",
    category: "色彩",
    desc: "颜色格式转换",
    accent: "plain",
    iconKey: "file",
    iconText: "#",
    local: false
  },
  {
    id: "watermark",
    name: "加水印",
    category: "常用",
    desc: "文字和日期印记",
    accent: "ink",
    iconKey: "pen",
    iconText: "T",
    local: true
  },
  {
    id: "film",
    name: "胶片感",
    category: "风格",
    desc: "暖色颗粒",
    accent: "soft",
    iconKey: "droplets",
    iconText: "◌",
    local: true
  },
  {
    id: "ai",
    name: "AI 高级风格",
    category: "AI",
    desc: "登录后开放",
    accent: "locked",
    iconKey: "sparkles",
    iconText: "✦",
    locked: true,
    local: false
  },
  {
    id: "more",
    name: "所有工具",
    category: "更多",
    desc: "扩展入口",
    accent: "plain",
    iconKey: "layers",
    iconText: "▤",
    local: false
  }
];

module.exports = { tools };
