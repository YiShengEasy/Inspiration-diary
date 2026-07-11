const TILE_SIZE = 900;

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

function exportCanvas(canvas) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      width: TILE_SIZE,
      height: TILE_SIZE,
      destWidth: TILE_SIZE,
      destHeight: TILE_SIZE,
      fileType: "jpg",
      quality: 0.94,
      success: (result) => resolve(result.tempFilePath),
      fail: reject
    });
  });
}

function saveImage(filePath) {
  return new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject }));
}

Page({
  data: {
    sourcePath: "",
    sourceWidth: 0,
    sourceHeight: 0,
    tiles: [],
    processing: false,
    saving: false
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
        try {
          const info = await getImageInfo(sourcePath);
          this.setData({ sourcePath, sourceWidth: info.width, sourceHeight: info.height, tiles: [] });
        } catch (error) {
          wx.showToast({ title: "图片读取失败", icon: "none" });
        }
      }
    });
  },

  async generateTiles() {
    if (!this.data.sourcePath || this.data.processing) return;
    this.setData({ processing: true });
    wx.showLoading({ title: "正在切图", mask: true });
    try {
      const canvas = await new Promise((resolve, reject) => {
        wx.createSelectorQuery().in(this).select("#gridCanvas").fields({ node: true }).exec((result) => {
          const node = result && result[0] && result[0].node;
          if (node) resolve(node);
          else reject(new Error("canvas unavailable"));
        });
      });
      canvas.width = TILE_SIZE;
      canvas.height = TILE_SIZE;
      const image = await loadCanvasImage(canvas, this.data.sourcePath);
      const sourceSize = Math.min(this.data.sourceWidth, this.data.sourceHeight);
      const sourceX = (this.data.sourceWidth - sourceSize) / 2;
      const sourceY = (this.data.sourceHeight - sourceSize) / 2;
      const cell = sourceSize / 3;
      const tiles = [];

      for (let row = 0; row < 3; row += 1) {
        for (let column = 0; column < 3; column += 1) {
          const context = canvas.getContext("2d");
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
          context.drawImage(image, sourceX + column * cell, sourceY + row * cell, cell, cell, 0, 0, TILE_SIZE, TILE_SIZE);
          const path = await exportCanvas(canvas);
          tiles.push({ id: `${row}-${column}`, path, order: row * 3 + column + 1 });
        }
      }
      this.setData({ tiles });
    } catch (error) {
      wx.showToast({ title: "切图失败，请更换图片重试", icon: "none" });
    } finally {
      wx.hideLoading();
      this.setData({ processing: false });
    }
  },

  previewTile(event) {
    const current = event.currentTarget.dataset.path;
    wx.previewImage({ current, urls: this.data.tiles.map((item) => item.path) });
  },

  async saveAllTiles() {
    if (this.data.tiles.length !== 9 || this.data.saving) return;
    this.setData({ saving: true });
    wx.showLoading({ title: "保存 0/9", mask: true });
    try {
      for (let index = 0; index < this.data.tiles.length; index += 1) {
        wx.showLoading({ title: `保存 ${index + 1}/9`, mask: true });
        await saveImage(this.data.tiles[index].path);
      }
      wx.showToast({ title: "九张图片已保存", icon: "success" });
    } catch (error) {
      wx.showToast({ title: "保存中断，请检查相册权限", icon: "none" });
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }
  }
});
