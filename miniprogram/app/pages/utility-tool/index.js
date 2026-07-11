const toolConfigs = {
  password: { title: "随机密码", desc: "生成日常账号使用的随机密码" },
  dateCalc: { title: "日期计算", desc: "计算两个日期之间的间隔" },
  unitConvert: { title: "单位换算", desc: "长度、重量和温度快速换算" },
  random: { title: "随机数", desc: "在指定整数范围内随机生成" }
};

const charsets = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  number: "0123456789",
  symbol: "!@#$%^&*_-+="
};

const unitGroups = {
  length: {
    label: "长度",
    units: [
      { label: "毫米 mm", value: "mm", factor: 0.001 },
      { label: "厘米 cm", value: "cm", factor: 0.01 },
      { label: "米 m", value: "m", factor: 1 },
      { label: "千米 km", value: "km", factor: 1000 },
      { label: "英寸 in", value: "in", factor: 0.0254 },
      { label: "英尺 ft", value: "ft", factor: 0.3048 }
    ]
  },
  weight: {
    label: "重量",
    units: [
      { label: "克 g", value: "g", factor: 0.001 },
      { label: "千克 kg", value: "kg", factor: 1 },
      { label: "吨 t", value: "t", factor: 1000 },
      { label: "磅 lb", value: "lb", factor: 0.45359237 },
      { label: "盎司 oz", value: "oz", factor: 0.028349523125 }
    ]
  },
  temperature: {
    label: "温度",
    units: [
      { label: "摄氏度 ℃", value: "c" },
      { label: "华氏度 ℉", value: "f" },
      { label: "开尔文 K", value: "k" }
    ]
  }
};

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function randomInteger(max) {
  return Math.floor(Math.random() * max);
}

function generatePassword(length, options) {
  const selected = Object.keys(options).filter((key) => options[key] && charsets[key]);
  if (!selected.length) throw new Error("请至少选择一种字符");
  let result = selected.map((key) => charsets[key][randomInteger(charsets[key].length)]).join("");
  const pool = selected.map((key) => charsets[key]).join("");
  while (result.length < length) result += pool[randomInteger(pool.length)];
  return result.split("").sort(() => Math.random() - 0.5).join("");
}

function convertTemperature(value, from, to) {
  let celsius = value;
  if (from === "f") celsius = (value - 32) * 5 / 9;
  if (from === "k") celsius = value - 273.15;
  if (to === "f") return celsius * 9 / 5 + 32;
  if (to === "k") return celsius + 273.15;
  return celsius;
}

function convertUnit(group, value, from, to) {
  if (!Number.isFinite(value)) throw new Error("请输入有效数值");
  if (group === "temperature") return convertTemperature(value, from, to);
  const units = unitGroups[group].units;
  const fromUnit = units.find((item) => item.value === from);
  const toUnit = units.find((item) => item.value === to);
  return value * fromUnit.factor / toUnit.factor;
}

Page({
  data: {
    tool: "password",
    config: toolConfigs.password,
    passwordLength: 16,
    passwordOptions: { lower: true, upper: true, number: true, symbol: true },
    passwordResult: "",
    today: formatDate(new Date()),
    startDate: formatDate(new Date()),
    endDate: formatDate(new Date(Date.now() + 7 * 86400000)),
    dateResult: "",
    unitGroup: "length",
    unitGroupLabel: unitGroups.length.label,
    unitGroupOptions: Object.keys(unitGroups).map((value) => ({ value, label: unitGroups[value].label })),
    unitOptions: unitGroups.length.units,
    fromUnitIndex: 2,
    toUnitIndex: 3,
    unitInput: "1",
    unitResult: "",
    randomMin: "1",
    randomMax: "100",
    randomCount: "1",
    randomResult: ""
  },

  onLoad(options) {
    const tool = toolConfigs[options.tool] ? options.tool : "password";
    const config = toolConfigs[tool];
    this.setData({ tool, config });
    wx.setNavigationBarTitle({ title: config.title });
  },

  changePasswordLength(event) { this.setData({ passwordLength: Number(event.detail.value) }); },
  togglePasswordOption(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [`passwordOptions.${key}`]: !this.data.passwordOptions[key] });
  },
  generatePassword() {
    try {
      this.setData({ passwordResult: generatePassword(this.data.passwordLength, this.data.passwordOptions) });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  changeStartDate(event) { this.setData({ startDate: event.detail.value, dateResult: "" }); },
  changeEndDate(event) { this.setData({ endDate: event.detail.value, dateResult: "" }); },
  calculateDate() {
    const start = new Date(`${this.data.startDate}T00:00:00`);
    const end = new Date(`${this.data.endDate}T00:00:00`);
    const difference = end.getTime() - start.getTime();
    const days = Math.round(Math.abs(difference) / 86400000);
    const direction = difference === 0 ? "同一天" : difference > 0 ? "结束日期晚于开始日期" : "结束日期早于开始日期";
    this.setData({ dateResult: `${days} 天\n${direction}\n约 ${(days / 7).toFixed(1)} 周` });
  },

  changeUnitGroup(event) {
    const unitGroup = this.data.unitGroupOptions[Number(event.detail.value)].value;
    this.setData({ unitGroup, unitGroupLabel: unitGroups[unitGroup].label, unitOptions: unitGroups[unitGroup].units, fromUnitIndex: 0, toUnitIndex: 1, unitResult: "" });
  },
  changeFromUnit(event) { this.setData({ fromUnitIndex: Number(event.detail.value), unitResult: "" }); },
  changeToUnit(event) { this.setData({ toUnitIndex: Number(event.detail.value), unitResult: "" }); },
  changeUnitInput(event) { this.setData({ unitInput: event.detail.value, unitResult: "" }); },
  convertUnit() {
    try {
      const from = this.data.unitOptions[this.data.fromUnitIndex];
      const to = this.data.unitOptions[this.data.toUnitIndex];
      const result = convertUnit(this.data.unitGroup, Number(this.data.unitInput), from.value, to.value);
      const formatted = Number(result.toPrecision(12)).toString();
      this.setData({ unitResult: `${this.data.unitInput} ${from.label} =\n${formatted} ${to.label}` });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  changeRandomMin(event) { this.setData({ randomMin: event.detail.value }); },
  changeRandomMax(event) { this.setData({ randomMax: event.detail.value }); },
  changeRandomCount(event) { this.setData({ randomCount: event.detail.value }); },
  generateRandom() {
    const min = Math.ceil(Number(this.data.randomMin));
    const max = Math.floor(Number(this.data.randomMax));
    const count = Math.min(100, Math.max(1, Math.floor(Number(this.data.randomCount)) || 1));
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return wx.showToast({ title: "请检查随机范围", icon: "none" });
    const values = Array.from({ length: count }, () => min + randomInteger(max - min + 1));
    this.setData({ randomResult: values.join(count > 10 ? "\n" : "、") });
  },

  copyResult(event) {
    const key = event.currentTarget.dataset.key;
    const value = this.data[key];
    if (!value) return wx.showToast({ title: "没有可复制的结果", icon: "none" });
    wx.setClipboardData({ data: value });
  }
});
