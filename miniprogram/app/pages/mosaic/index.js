const MAX_OUTPUT_EDGE = 1500;

function getImageInfo(src) {
  return new Promise((resolve, reject) => wx.getImageInfo({ src, success: resolve, fail: reject }));
}

function loadCanvasImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

Page({
  data: {
    sourcePath: "",
    canvasHeight: 420,
    brushSize: 32,
    brushOptions: [
      { label: "小", value: 20 },
      { label: "中", value: 32 },
      { label: "大", value: 48 }
    ],
    resultPath: "",
    drawing: false,
    exporting: false
  },

  onUnload() {
    this.canvas = null;
    this.context = null;
    this.canvasRect = null;
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["original"],
      success: async (result) => {
        const sourcePath = result.tempFiles && result.tempFiles[0] && result.tempFiles[0].tempFilePath;
        if (!sourcePath) return;
        wx.showLoading({ title: "读取图片" });
        try {
          const info = await getImageInfo(sourcePath);
          const system = wx.getSystemInfoSync();
          const displayWidth = system.windowWidth - 31 / 750 * system.windowWidth * 2;
          const canvasHeight = Math.min(system.windowHeight * 0.58, Math.max(240, displayWidth * info.height / info.width));
          this.setData({ sourcePath, canvasHeight, resultPath: "" }, () => this.prepareCanvas(info));
        } catch (error) {
          wx.showToast({ title: "图片读取失败", icon: "none" });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  async prepareCanvas(info) {
    try {
      const query = wx.createSelectorQuery().in(this);
      const canvasData = await new Promise((resolve, reject) => {
        query.select("#mosaicCanvas").fields({ node: true, size: true }).exec((result) => {
          if (result && result[0] && result[0].node) resolve(result[0]);
          else reject(new Error("canvas unavailable"));
        });
      });
      const canvas = canvasData.node;
      const sourceMaxEdge = Math.max(info.width, info.height);
      const scale = Math.min(1, MAX_OUTPUT_EDGE / sourceMaxEdge);
      canvas.width = Math.max(1, Math.round(info.width * scale));
      canvas.height = Math.max(1, Math.round(info.height * scale));
      const context = canvas.getContext("2d");
      const image = await loadCanvasImage(canvas, this.data.sourcePath);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      this.canvas = canvas;
      this.context = context;
      this.lastPoint = null;
      this.updateCanvasRect();
    } catch (error) {
      wx.showToast({ title: "画布初始化失败", icon: "none" });
    }
  },

  updateCanvasRect() {
    wx.createSelectorQuery().in(this).select("#mosaicCanvas").boundingClientRect((rect) => {
      this.canvasRect = rect;
    }).exec();
  },

  selectBrush(event) {
    this.setData({ brushSize: Number(event.currentTarget.dataset.value) });
  },

  startDraw(event) {
    if (!this.context || !this.canvasRect) return;
    this.lastPoint = null;
    this.setData({ drawing: true, resultPath: "" });
    this.drawMosaic(event);
  },

  moveDraw(event) {
    if (!this.data.drawing) return;
    this.drawMosaic(event);
  },

  endDraw() {
    this.lastPoint = null;
    this.setData({ drawing: false });
  },

  drawMosaic(event) {
    const touch = event.touches && event.touches[0];
    const rect = this.canvasRect;
    if (!touch || !rect || !rect.width || !rect.height) return;
    const clientX = touch.clientX === undefined ? touch.x : touch.clientX;
    const clientY = touch.clientY === undefined ? touch.y : touch.clientY;
    const displayX = clientX - rect.left;
    const displayY = clientY - rect.top;
    if (displayX < 0 || displayY < 0 || displayX > rect.width || displayY > rect.height) return;

    if (this.lastPoint) {
      const distance = Math.hypot(displayX - this.lastPoint.x, displayY - this.lastPoint.y);
      if (distance < 5) return;
    }
    this.lastPoint = { x: displayX, y: displayY };

    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const centerX = displayX * scaleX;
    const centerY = displayY * scaleY;
    const radiusX = this.data.brushSize * scaleX;
    const radiusY = this.data.brushSize * scaleY;
    const block = Math.max(10, Math.round(9 * Math.max(scaleX, scaleY)));
    const left = Math.max(0, Math.floor((centerX - radiusX) / block) * block);
    const top = Math.max(0, Math.floor((centerY - radiusY) / block) * block);
    const right = Math.min(this.canvas.width, centerX + radiusX);
    const bottom = Math.min(this.canvas.height, centerY + radiusY);

    for (let y = top; y < bottom; y += block) {
      for (let x = left; x < right; x += block) {
        const dx = (x + block / 2 - centerX) / radiusX;
        const dy = (y + block / 2 - centerY) / radiusY;
        if (dx * dx + dy * dy > 1) continue;
        const sampleX = Math.min(this.canvas.width - 1, Math.max(0, Math.round(x + block / 2)));
        const sampleY = Math.min(this.canvas.height - 1, Math.max(0, Math.round(y + block / 2)));
        const pixel = this.context.getImageData(sampleX, sampleY, 1, 1).data;
        this.context.fillStyle = `rgba(${pixel[0]},${pixel[1]},${pixel[2]},${pixel[3] / 255})`;
        this.context.fillRect(x, y, block + 1, block + 1);
      }
    }
  },

  restoreImage() {
    if (!this.data.sourcePath) return;
    getImageInfo(this.data.sourcePath).then((info) => {
      this.setData({ resultPath: "" }, () => this.prepareCanvas(info));
    });
  },

  async exportImage() {
    if (!this.canvas || this.data.exporting) return;
    this.setData({ exporting: true });
    wx.showLoading({ title: "正在导出", mask: true });
    try {
      const resultPath = await new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas: this.canvas,
          width: this.canvas.width,
          height: this.canvas.height,
          destWidth: this.canvas.width,
          destHeight: this.canvas.height,
          fileType: "jpg",
          quality: 0.94,
          success: (result) => resolve(result.tempFilePath),
          fail: reject
        });
      });
      this.setData({ resultPath });
    } catch (error) {
      wx.showToast({ title: "导出失败", icon: "none" });
    } finally {
      wx.hideLoading();
      this.setData({ exporting: false });
    }
  },

  saveResult() {
    if (!this.data.resultPath) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.resultPath,
      success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
      fail: () => wx.showToast({ title: "保存失败，请检查相册权限", icon: "none" })
    });
  }
});
