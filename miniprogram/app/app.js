const DEFAULT_API_BASE_URL = "http://192.168.13.106:3005";
const STALE_DEFAULT_API_BASE_URLS = [
  "http://172.17.10.116:3005"
];

App({
  globalData: {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    accountState: "guest",
    user: null
  },
  onLaunch() {
    const apiBaseUrl = wx.getStorageSync("apiBaseUrl");
    if (apiBaseUrl && !STALE_DEFAULT_API_BASE_URLS.includes(apiBaseUrl)) {
      this.globalData.apiBaseUrl = apiBaseUrl;
      return;
    }
    wx.setStorageSync("apiBaseUrl", DEFAULT_API_BASE_URL);
  }
});
