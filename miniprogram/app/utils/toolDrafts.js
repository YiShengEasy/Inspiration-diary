const TOOL_DRAFTS_KEY = "toolDrafts";
const MAX_TOOL_DRAFTS = 60;

function readToolDrafts() {
  const drafts = wx.getStorageSync(TOOL_DRAFTS_KEY);
  return Array.isArray(drafts) ? drafts : [];
}

function writeToolDrafts(drafts) {
  wx.setStorageSync(TOOL_DRAFTS_KEY, drafts.slice(0, MAX_TOOL_DRAFTS));
}

function saveFileToLocal(filePath) {
  return new Promise((resolve) => {
    if (!filePath || typeof wx.saveFile !== "function") {
      resolve(filePath);
      return;
    }

    wx.saveFile({
      tempFilePath: filePath,
      success: (res) => resolve(res.savedFilePath || filePath),
      fail: () => resolve(filePath)
    });
  });
}

function labelForTool(toolId) {
  const labels = {
    crop: "图片编辑",
    pixel: "拼豆图纸",
    filter: "滤镜风格",
    watermark: "水印图片",
    film: "胶片图片",
    colorPick: "图片取色",
    palette: "色卡配色",
    gradient: "渐变色卡",
    contrast: "对比度检测",
    rgbhex: "颜色转换",
    ai: "AI 风格"
  };
  return labels[toolId] || "工具草稿";
}

async function saveToolDraft({ toolId, title, filePath, note = "" }) {
  const localPath = await saveFileToLocal(filePath);
  const draft = {
    id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    toolId: toolId || "tool",
    title: title || labelForTool(toolId),
    filePath: localPath || filePath || "",
    note,
    createdAt: Date.now()
  };
  writeToolDrafts([draft, ...readToolDrafts().filter((item) => item && item.id !== draft.id)]);
  return draft;
}

function removeToolDraft(id) {
  if (!id) return;
  writeToolDrafts(readToolDrafts().filter((item) => item && item.id !== id));
}

module.exports = {
  readToolDrafts,
  saveToolDraft,
  removeToolDraft
};
