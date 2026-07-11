const MAX_IMAGES = 9;
const MAX_OUTPUT_WIDTH = 1500;
const MAX_OUTPUT_HEIGHT = 12000;

function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({ src, success: resolve, fail: reject });
  });
}

function loadCanvasImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function canvasToFile(canvas, width, height) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      x: 0,
      y: 0,
      width,
      height,
      destWidth: width,
      destHeight: height,
      fileType: "jpg",
      quality: 0.92,
      success: (result) => resolve(result.tempFilePath),
      fail: reject
    });
  });
}

Page({
  data: {
    images: [],
    processing: false,
    resultPath: "",
    resultWidth: 0,
    resultHeight: 0,
    resultMeta: "",
    maxImages: MAX_IMAGES
  },

  chooseImages() {
    const remain = MAX_IMAGES - this.data.images.length;
    if (remain <= 0) {
      wx.showToast({ title: `最多选择 ${MAX_IMAGES} 张图片`, icon: "none" });
      return;
    }

    wx.chooseMedia({
      count: remain,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["original"],
      success: async (result) => {
        const paths = (result.tempFiles || []).map((item) => item.tempFilePath).filter(Boolean);
        if (!paths.length) return;
        wx.showLoading({ title: "读取图片" });
        try {
          const additions = await Promise.all(paths.map(async (src, index) => {
            const info = await getImageInfo(src);
            return {
              id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
              src,
              width: info.width,
              height: info.height
            };
          }));
          this.setData({ images: this.data.images.concat(additions), resultPath: "" });
        } catch (error) {
          wx.showToast({ title: "部分图片读取失败", icon: "none" });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  removeImage(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;
    const images = this.data.images.slice();
    images.splice(index, 1);
    this.setData({ images, resultPath: "" });
  },

  moveImage(event) {
    const index = Number(event.currentTarget.dataset.index);
    const direction = Number(event.currentTarget.dataset.direction);
    const target = index + direction;
    if (!Number.isInteger(index) || target < 0 || target >= this.data.images.length) return;
    const images = this.data.images.slice();
    const current = images[index];
    images[index] = images[target];
    images[target] = current;
    this.setData({ images, resultPath: "" });
  },

  clearImages() {
    this.setData({ images: [], resultPath: "", resultWidth: 0, resultHeight: 0, resultMeta: "" });
  },

  async generateLongImage() {
    if (this.data.images.length < 2) {
      wx.showToast({ title: "请至少选择 2 张图片", icon: "none" });
      return;
    }
    if (this.data.processing) return;

    this.setData({ processing: true });
    wx.showLoading({ title: "正在拼接", mask: true });
    try {
      const images = this.data.images;
      const widest = Math.max(...images.map((item) => item.width));
      let outputWidth = Math.min(widest, MAX_OUTPUT_WIDTH);
      let outputHeight = images.reduce((sum, item) => sum + Math.round(item.height * outputWidth / item.width), 0);

      if (outputHeight > MAX_OUTPUT_HEIGHT) {
        outputWidth = Math.max(320, Math.floor(outputWidth * MAX_OUTPUT_HEIGHT / outputHeight));
        outputHeight = images.reduce((sum, item) => sum + Math.round(item.height * outputWidth / item.width), 0);
      }

      const query = wx.createSelectorQuery().in(this);
      const canvas = await new Promise((resolve, reject) => {
        query.select("#stitchCanvas").fields({ node: true }).exec((result) => {
          const node = result && result[0] && result[0].node;
          if (node) resolve(node);
          else reject(new Error("canvas unavailable"));
        });
      });

      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, outputWidth, outputHeight);

      let y = 0;
      for (const item of images) {
        const drawHeight = Math.round(item.height * outputWidth / item.width);
        const canvasImage = await loadCanvasImage(canvas, item.src);
        context.drawImage(canvasImage, 0, y, outputWidth, drawHeight);
        y += drawHeight;
      }

      const resultPath = await canvasToFile(canvas, outputWidth, outputHeight);
      this.setData({
        resultPath,
        resultWidth: outputWidth,
        resultHeight: outputHeight,
        resultMeta: `${images.length} 张 · ${outputWidth} × ${outputHeight}px`
      });
    } catch (error) {
      wx.showToast({ title: "拼接失败，请减少图片后重试", icon: "none" });
    } finally {
      wx.hideLoading();
      this.setData({ processing: false });
    }
  },

  saveResult() {
    if (!this.data.resultPath) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.resultPath,
      success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
      fail: (error) => {
        const denied = error && /auth deny|auth denied/.test(error.errMsg || "");
        wx.showToast({ title: denied ? "请在设置中允许保存相册" : "保存失败", icon: "none" });
      }
    });
  }
});
