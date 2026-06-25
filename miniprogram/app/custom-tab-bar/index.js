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

  lifetimes: {
    attached() {
      this.syncSelected();
    }
  },

  pageLifetimes: {
    show() {
      this.syncSelected();
    }
  },

  methods: {
    syncSelected() {
      const pages = getCurrentPages();
      const route = pages[pages.length - 1]?.route || tabs[0].route;
      const selected = Math.max(0, tabs.findIndex((item) => item.route === route));
      this.setData({ selected });
    },

    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      const item = tabs[index];
      if (!item || index === this.data.selected) return;

      this.setData({ selected: index });
      wx.switchTab({ url: item.url });
    }
  }
});
