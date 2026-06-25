App({
  globalData: {
    apiBaseUrl: "http://172.17.10.116:3005",
    accountState: "guest",
    user: null
  },
  onLaunch() {
    const apiBaseUrl = wx.getStorageSync("apiBaseUrl");
    if (apiBaseUrl) this.globalData.apiBaseUrl = apiBaseUrl;
  }
});
