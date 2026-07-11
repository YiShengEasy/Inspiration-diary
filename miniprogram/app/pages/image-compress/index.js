function getImageInfo(src) {
  return new Promise((resolve, reject) => wx.getImageInfo({ src, success: resolve, fail: reject }));
}

function getFileSize(filePath) {
  return new Promise((resolve) => {
    wx.getFileSystemManager().getFileInfo({
      filePath,
      success: (result) => resolve(result.size || 0),
      fail: () => resolve(0)
    });
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

function formatBytes(bytes) {
  if (!bytes) return "未知大小";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

Page({
  data: {
    sourcePath: "",
    resultPath: "",
    sourceWidth: 0,
    sourceHeight: 0,
    sourceSize: 0,
    sourceSizeText: "",
    resultSize: 0,
    resultSizeText: "",
    savingRate: "",
    quality: 80,
    maxEdge: 1600,
    sizeOptions: [
      { label: "原始尺寸", value: 0 },
      { label: "最长边 1600", value: 1600 },
      { label: "最长边 1080", value: 1080 }
    ],
    processing: false
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
          const [info, sourceSize] = await Promise.all([getImageInfo(sourcePath), getFileSize(sourcePath)]);
          this.setData({
            sourcePath,
            resultPath: "",
            sourceWidth: info.width,
            sourceHeight: info.height,
            sourceSize,
            sourceSizeText: formatBytes(sourceSize),
            resultSize: 0,
            resultSizeText: "",
            savingRate: ""
          });
        } catch (error) {
          wx.showToast({ title: "图片读取失败", icon: "none" });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  changeQuality(event) {
    this.setData({ quality: Number(event.detail.value), resultPath: "" });
  },

  selectSize(event) {
    this.setData({ maxEdge: Number(event.currentTarget.dataset.value), resultPath: "" });
  },

  async compressImage() {
    if (!this.data.sourcePath || this.data.processing) return;
    this.setData({ processing: true });
    wx.showLoading({ title: "正在压缩", mask: true });
    try {
      const maxSourceEdge = Math.max(this.data.sourceWidth, this.data.sourceHeight);
      const targetEdge = this.data.maxEdge > 0 ? Math.min(this.data.maxEdge, maxSourceEdge) : maxSourceEdge;
      const scale = targetEdge / maxSourceEdge;
      const width = Math.max(1, Math.round(this.data.sourceWidth * scale));
      const height = Math.max(1, Math.round(this.data.sourceHeight * scale));

      const canvas = await new Promise((resolve, reject) => {
        wx.createSelectorQuery().in(this).select("#compressCanvas").fields({ node: true }).exec((result) => {
          const node = result && result[0] && result[0].node;
          if (node) resolve(node);
          else reject(new Error("canvas unavailable"));
        });
      });
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      const image = await loadCanvasImage(canvas, this.data.sourcePath);
      context.drawImage(image, 0, 0, width, height);

      const resultPath = await new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas,
          width,
          height,
          destWidth: width,
          destHeight: height,
          fileType: "jpg",
          quality: this.data.quality / 100,
          success: (result) => resolve(result.tempFilePath),
          fail: reject
        });
      });
      const resultSize = await getFileSize(resultPath);
      const saving = this.data.sourceSize > 0 ? Math.max(0, Math.round((1 - resultSize / this.data.sourceSize) * 100)) : 0;
      this.setData({
        resultPath,
        resultSize,
        resultSizeText: formatBytes(resultSize),
        savingRate: saving > 0 ? `体积减少 ${saving}%` : "已按当前参数导出"
      });
    } catch (error) {
      wx.showToast({ title: "压缩失败，请更换图片重试", icon: "none" });
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
      fail: () => wx.showToast({ title: "保存失败，请检查相册权限", icon: "none" })
    });
  }
});
