const qrcode = require("../../vendor/qrcode-generator/qrcode");
qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];

const CANVAS_SIZE = 900;
const QUIET_ZONE = 54;

Page({
  data: {
    mode: "generate",
    content: "",
    resultPath: "",
    scanResult: "",
    generating: false
  },

  switchMode(event) {
    this.setData({ mode: event.currentTarget.dataset.mode });
  },

  changeContent(event) {
    this.setData({ content: event.detail.value || "", resultPath: "" });
  },

  pasteContent() {
    wx.getClipboardData({
      success: (result) => this.setData({ content: result.data || "", resultPath: "" })
    });
  },

  clearContent() {
    this.setData({ content: "", resultPath: "" });
  },

  async generateCode() {
    const content = this.data.content.trim();
    if (!content) {
      wx.showToast({ title: "请输入二维码内容", icon: "none" });
      return;
    }
    if (this.data.generating) return;
    this.setData({ generating: true });
    wx.showLoading({ title: "正在生成", mask: true });
    try {
      const code = qrcode(0, "M");
      code.addData(content, "Byte");
      code.make();
      const moduleCount = code.getModuleCount();
      const drawSize = CANVAS_SIZE - QUIET_ZONE * 2;
      const cellSize = drawSize / moduleCount;
      const canvas = await new Promise((resolve, reject) => {
        wx.createSelectorQuery().in(this).select("#qrCanvas").fields({ node: true }).exec((result) => {
          const node = result && result[0] && result[0].node;
          if (node) resolve(node);
          else reject(new Error("canvas unavailable"));
        });
      });
      canvas.width = CANVAS_SIZE;
      canvas.height = CANVAS_SIZE;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      context.fillStyle = "#111111";
      for (let row = 0; row < moduleCount; row += 1) {
        for (let column = 0; column < moduleCount; column += 1) {
          if (!code.isDark(row, column)) continue;
          const left = QUIET_ZONE + Math.floor(column * cellSize);
          const top = QUIET_ZONE + Math.floor(row * cellSize);
          const right = QUIET_ZONE + Math.ceil((column + 1) * cellSize);
          const bottom = QUIET_ZONE + Math.ceil((row + 1) * cellSize);
          context.fillRect(left, top, right - left, bottom - top);
        }
      }
      const resultPath = await new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas,
          width: CANVAS_SIZE,
          height: CANVAS_SIZE,
          destWidth: CANVAS_SIZE,
          destHeight: CANVAS_SIZE,
          fileType: "png",
          success: (result) => resolve(result.tempFilePath),
          fail: reject
        });
      });
      this.setData({ resultPath });
    } catch (error) {
      const tooLong = /code length overflow/i.test(error && error.message ? error.message : "");
      wx.showToast({ title: tooLong ? "内容过长，请精简后重试" : "二维码生成失败", icon: "none" });
    } finally {
      wx.hideLoading();
      this.setData({ generating: false });
    }
  },

  saveCode() {
    if (!this.data.resultPath) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.resultPath,
      success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
      fail: () => wx.showToast({ title: "保存失败，请检查相册权限", icon: "none" })
    });
  },

  scanCode() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ["qrCode"],
      success: (result) => this.setData({ scanResult: result.result || "" }),
      fail: (error) => {
        if (!error || !/cancel/.test(error.errMsg || "")) wx.showToast({ title: "未识别到二维码", icon: "none" });
      }
    });
  },

  copyScanResult() {
    if (!this.data.scanResult) return;
    wx.setClipboardData({ data: this.data.scanResult });
  },

  useScanResult() {
    if (!this.data.scanResult) return;
    this.setData({ mode: "generate", content: this.data.scanResult, resultPath: "" });
  }
});
