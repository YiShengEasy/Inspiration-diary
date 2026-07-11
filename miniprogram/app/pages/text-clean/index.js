const actions = [
  { id: "trim", name: "清理首尾空格", icon: "↔" },
  { id: "blank", name: "删除空行", icon: "≡" },
  { id: "dedupe", name: "删除重复行", icon: "＝" },
  { id: "sort", name: "按行排序", icon: "⇅" },
  { id: "half", name: "转半角", icon: "Aa" },
  { id: "spaces", name: "合并连续空格", icon: "·" },
  { id: "upper", name: "转大写", icon: "A" },
  { id: "lower", name: "转小写", icon: "a" },
  { id: "url", name: "提取 URL", icon: "↗" }
];

function toHalfWidth(text) {
  return text.replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/　/g, " ");
}

function processText(text, action) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (action === "trim") return lines.map((line) => line.trim()).join("\n");
  if (action === "blank") return lines.filter((line) => line.trim()).join("\n");
  if (action === "dedupe") return Array.from(new Set(lines)).join("\n");
  if (action === "sort") return lines.slice().sort((a, b) => a.localeCompare(b, "zh-CN")).join("\n");
  if (action === "half") return toHalfWidth(text);
  if (action === "spaces") return text.replace(/[ \t]+/g, " ");
  if (action === "upper") return text.toUpperCase();
  if (action === "lower") return text.toLowerCase();
  if (action === "url") {
    const urls = text.match(/https?:\/\/[^\s<>'"，。！？；：]+/gi) || [];
    return Array.from(new Set(urls)).join("\n");
  }
  return text;
}

Page({
  data: {
    actions,
    inputText: "",
    outputText: "",
    inputCount: 0,
    outputCount: 0,
    recommendedAction: ""
  },

  onLoad(options) {
    const recommendedAction = actions.some((item) => item.id === options.action) ? options.action : "";
    this.setData({ recommendedAction });
  },

  changeInput(event) {
    const inputText = event.detail.value || "";
    this.setData({ inputText, outputText: inputText, inputCount: inputText.length, outputCount: inputText.length });
  },

  runAction(event) {
    const action = event.currentTarget.dataset.action;
    const source = this.data.outputText || this.data.inputText;
    if (!source) {
      wx.showToast({ title: "请先输入或粘贴文本", icon: "none" });
      return;
    }
    const outputText = processText(source, action);
    this.setData({ outputText, outputCount: outputText.length, recommendedAction: action });
  },

  pasteText() {
    wx.getClipboardData({
      success: (result) => {
        const inputText = result.data || "";
        this.setData({ inputText, outputText: inputText, inputCount: inputText.length, outputCount: inputText.length });
      }
    });
  },

  copyResult() {
    if (!this.data.outputText) {
      wx.showToast({ title: "没有可复制的内容", icon: "none" });
      return;
    }
    wx.setClipboardData({ data: this.data.outputText });
  },

  useResult() {
    const inputText = this.data.outputText;
    this.setData({ inputText, inputCount: inputText.length });
  },

  clearText() {
    this.setData({ inputText: "", outputText: "", inputCount: 0, outputCount: 0 });
  }
});
