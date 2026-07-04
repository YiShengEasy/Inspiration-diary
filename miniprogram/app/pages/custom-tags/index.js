const { refreshAccountStatus } = require("../../utils/auth");
const {
  createCustomTagGroup,
  flattenCustomTagGroups,
  flattenEnabledCustomTagGroups,
  loadCustomTagLibrary,
  normalizeCustomTagGroups,
  normalizeTagTerm,
  parseTagInput,
  saveCustomTagLibrary
} = require("../../utils/customTagLibrary");

Page({
  data: {
    accountState: "guest",
    loading: false,
    saving: false,
    libraryEnabled: true,
    groups: [],
    selectedGroupId: "",
    selectedGroup: null,
    selectedTerms: [],
    newGroupName: "",
    newTermsText: "",
    totalCount: 0,
    enabledCount: 0
  },

  async onShow() {
    await this.load();
  },

  buildState(groups, enabled, selectedGroupId) {
    const normalizedGroups = normalizeCustomTagGroups(groups);
    const selectedId = normalizedGroups.some((group) => group.id === selectedGroupId)
      ? selectedGroupId
      : (normalizedGroups[0] && normalizedGroups[0].id) || "";
    const selectedGroup = normalizedGroups.find((group) => group.id === selectedId) || null;

    return {
      libraryEnabled: enabled !== false,
      groups: normalizedGroups,
      selectedGroupId: selectedId,
      selectedGroup,
      selectedTerms: selectedGroup ? selectedGroup.terms : [],
      totalCount: flattenCustomTagGroups(normalizedGroups).length,
      enabledCount: enabled !== false ? flattenEnabledCustomTagGroups(normalizedGroups).length : 0
    };
  },

  async load() {
    this.setData({ loading: true });
    try {
      const status = await refreshAccountStatus();
      const accountState = status.accountState || "guest";
      if (accountState !== "registered") {
        this.setData({ accountState });
        wx.showToast({ title: "请先完成注册", icon: "none" });
        return;
      }

      const library = await loadCustomTagLibrary();
      this.setData({
        accountState,
        ...this.buildState(library.groups, library.enabled, this.data.selectedGroupId)
      });
    } catch (err) {
      wx.showToast({ title: err.message || "标签库加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async persist(groups, enabled) {
    if (this.data.accountState !== "registered") {
      wx.showToast({ title: "请先完成注册", icon: "none" });
      return;
    }

    const normalizedGroups = normalizeCustomTagGroups(groups);
    const nextEnabled = enabled !== false;
    this.setData({
      ...this.buildState(normalizedGroups, nextEnabled, this.data.selectedGroupId),
      saving: true
    });

    try {
      await saveCustomTagLibrary({ enabled: nextEnabled, groups: normalizedGroups });
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (err) {
      wx.showToast({ title: err.message || "标签库保存失败", icon: "none" });
      await this.load();
    } finally {
      this.setData({ saving: false });
    }
  },

  toggleLibrary(event) {
    void this.persist(this.data.groups, event.detail.value);
  },

  selectGroup(event) {
    const id = event.currentTarget.dataset.id || "";
    const selectedGroup = this.data.groups.find((group) => group.id === id) || null;
    this.setData({
      selectedGroupId: id,
      selectedGroup,
      selectedTerms: selectedGroup ? selectedGroup.terms : []
    });
  },

  toggleGroup(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    const groups = this.data.groups.map((group) => (
      group.id === id ? { ...group, enabled: group.enabled === false, updatedAt: Date.now() } : group
    ));
    void this.persist(groups, this.data.libraryEnabled);
  },

  onNewGroupNameInput(event) {
    this.setData({ newGroupName: event.detail.value });
  },

  async createGroup() {
    const name = normalizeTagTerm(this.data.newGroupName) || "新标签组";
    const group = createCustomTagGroup(name);
    this.setData({ newGroupName: "" });
    await this.persist([...this.data.groups, group], this.data.libraryEnabled);
    this.setData({
      selectedGroupId: group.id,
      selectedGroup: group,
      selectedTerms: group.terms
    });
  },

  onNewTermsInput(event) {
    this.setData({ newTermsText: event.detail.value });
  },

  async addTerms() {
    const selectedGroup = this.data.groups.find((group) => group.id === this.data.selectedGroupId);
    if (!selectedGroup) {
      wx.showToast({ title: "请先新建标签组", icon: "none" });
      return;
    }

    const nextTerms = parseTagInput(this.data.newTermsText);
    if (!nextTerms.length) return;

    const existing = {};
    (selectedGroup.terms || []).forEach((term) => {
      existing[String(term).toLowerCase()] = true;
    });
    const mergedTerms = [
      ...(selectedGroup.terms || []),
      ...nextTerms.filter((term) => {
        const key = term.toLowerCase();
        if (existing[key]) return false;
        existing[key] = true;
        return true;
      })
    ];

    const groups = this.data.groups.map((group) => (
      group.id === selectedGroup.id ? { ...group, terms: mergedTerms, updatedAt: Date.now() } : group
    ));
    this.setData({ newTermsText: "" });
    await this.persist(groups, this.data.libraryEnabled);
  },

  deleteTerm(event) {
    const term = event.currentTarget.dataset.term;
    const groupId = this.data.selectedGroupId;
    if (!term || !groupId) return;

    const groups = this.data.groups.map((group) => (
      group.id === groupId
        ? { ...group, terms: (group.terms || []).filter((item) => item !== term), updatedAt: Date.now() }
        : group
    ));
    void this.persist(groups, this.data.libraryEnabled);
  },

  deleteGroup() {
    const group = this.data.groups.find((item) => item.id === this.data.selectedGroupId);
    if (!group) return;

    wx.showModal({
      title: "删除标签组？",
      content: `「${group.name}」中的 ${group.terms.length} 个标签词也会一并移除。`,
      confirmText: "删除",
      confirmColor: "#d64545",
      success: (res) => {
        if (!res.confirm) return;
        const groups = this.data.groups.filter((item) => item.id !== group.id);
        void this.persist(groups, this.data.libraryEnabled);
      }
    });
  }
});
