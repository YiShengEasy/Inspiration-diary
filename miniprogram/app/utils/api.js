function getBaseUrl() {
  const app = getApp();
  return app.globalData.apiBaseUrl;
}

function getToken() {
  return wx.getStorageSync("miniToken") || "";
}

function resolveAssetUrl(url) {
  if (!url || typeof url !== "string") return "";
  if (!/^https?:\/\//.test(url)) return url;

  const baseUrl = getBaseUrl();
  const baseMatch = baseUrl.match(/^(https?:\/\/)([^:/]+)(?::(\d+))?/);
  if (!baseMatch) return url;

  const [, protocol, host] = baseMatch;
  return url.replace(/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i, (match, _localHost, port = "") => {
    return `${protocol}${host}${port}`;
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

function uploadImage({ url, filePath, name = "image", formData = {} }) {
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

        reject(new Error(body.error || `上传失败 ${res.statusCode}`));
      },
      fail(err) {
        reject(new Error(err.errMsg || "上传失败"));
      }
    });
  });
}

module.exports = { request, uploadImage, getToken, resolveAssetUrl };
