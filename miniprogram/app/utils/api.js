function getBaseUrl() {
  const app = getApp();
  return app.globalData.apiBaseUrl;
}

function getToken() {
  return wx.getStorageSync("miniToken") || "";
}

function resolveAssetUrl(url) {
  if (!url || typeof url !== "string") return "";

  const baseUrl = getBaseUrl();
  const absoluteUrl = url.startsWith("/") ? `${baseUrl}${url}` : url;
  if (!/^https?:\/\//.test(absoluteUrl)) return absoluteUrl;

  const baseMatch = baseUrl.match(/^(https?:\/\/)([^:/]+)(?::(\d+))?/);
  if (!baseMatch) return absoluteUrl;

  const [, protocol, host] = baseMatch;
  const resolvedUrl = absoluteUrl.replace(/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i, (match, _localHost, port = "") => {
    return `${protocol}${host}${port}`;
  });

  return resolvedUrl;
}

function downloadAsset(url) {
  const src = resolveAssetUrl(url);
  const protectedAssetPaths = [
    "/api/photos/",
    "/api/objects/",
    "/api/images/",
    "/api/videos/",
    "/api/combo-images/",
    "/api/combo-generations/"
  ];
  if (!src || !protectedAssetPaths.some((path) => src.indexOf(path) >= 0)) return Promise.resolve(src);

  return new Promise((resolve) => {
    const token = getToken();
    wx.downloadFile({
      url: src,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(res.tempFilePath);
          return;
        }
        resolve(src);
      },
      fail() {
        resolve(src);
      }
    });
  });
}

function request({ url, method = "GET", data, header = {} }) {
  return new Promise((resolve, reject) => {
    const token = getToken();

    wx.request({
      url: `${getBaseUrl()}${url}`,
      method,
      data,
      header: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...header
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }

        reject(new Error((res.data && res.data.error) || `请求失败 ${res.statusCode}`));
      },
      fail(err) {
        reject(new Error(err.errMsg || "网络请求失败"));
      }
    });
  });
}

function parseUploadBody(data) {
  if (!data) return {};

  try {
    return JSON.parse(data);
  } catch (err) {
    return { error: data };
  }
}

function uploadImage({ url, filePath, name = "image", formData = {}, header = {} }) {
  return new Promise((resolve, reject) => {
    const token = getToken();

    wx.uploadFile({
      url: `${getBaseUrl()}${url}`,
      filePath,
      name,
      formData,
      header: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...header
      },
      success(res) {
        const body = parseUploadBody(res.data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
          return;
        }

        reject(new Error(body.error || `上传失败 ${res.statusCode}`));
      },
      fail(err) {
        reject(new Error(err.errMsg || "上传失败"));
      }
    });
  });
}

function uploadDocument({ url, filePath, name = "document", formData = {} }) {
  return new Promise((resolve, reject) => {
    const token = getToken();

    wx.uploadFile({
      url: `${getBaseUrl()}${url}`,
      filePath,
      name,
      formData,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success(res) {
        const body = parseUploadBody(res.data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
          return;
        }

        reject(new Error(body.error || `文档解析失败 ${res.statusCode}`));
      },
      fail(err) {
        reject(new Error(err.errMsg || "文档上传失败"));
      }
    });
  });
}

module.exports = { request, uploadImage, uploadDocument, getToken, resolveAssetUrl, downloadAsset };
