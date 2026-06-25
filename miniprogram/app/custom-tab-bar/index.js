const tabs = [
  {
    route: "pages/diary/index",
    url: "/pages/diary/index",
    label: "灵感",
    icon: "▤"
  },
  {
    route: "pages/toolbox/index",
    url: "/pages/toolbox/index",
    label: "工具箱",
    icon: "✦"
  },
  {
    route: "pages/me/index",
    url: "/pages/me/index",
    label: "我的",
    icon: "◉"
  }
];

Component({
  data: {
    selected: 0,
    tabs
  },

  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      const item = tabs[index];
      if (!item || index === this.data.selected) return;

      wx.switchTab({ url: item.url });
    }
  }
});
