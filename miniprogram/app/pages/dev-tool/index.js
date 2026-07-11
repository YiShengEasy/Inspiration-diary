const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CryptoJS = require("../../vendor/crypto-js/core");
require("../../vendor/crypto-js/x64-core");
require("../../vendor/crypto-js/md5");
require("../../vendor/crypto-js/sha1");
require("../../vendor/crypto-js/sha256");
require("../../vendor/crypto-js/sha512");
const yaml = require("../../vendor/js-yaml/js-yaml");

const toolConfigs = {
  json: { title: "JSON 格式化", desc: "美化、压缩并校验 JSON 数据", placeholder: "粘贴 JSON 数据…", actions: [{ id: "format", label: "格式化" }, { id: "minify", label: "压缩" }] },
  base64: { title: "Base64", desc: "对文字进行 Base64 编码与解码", placeholder: "输入文字或 Base64 内容…", actions: [{ id: "encode", label: "编码" }, { id: "decode", label: "解码" }] },
  urlCodec: { title: "URL 编解码", desc: "处理 URL 参数和特殊字符", placeholder: "输入需要编码或解码的内容…", actions: [{ id: "encode", label: "编码" }, { id: "decode", label: "解码" }] },
  timestamp: { title: "时间戳", desc: "在 Unix 时间戳和日期之间转换", placeholder: "输入秒/毫秒时间戳或日期，例如 2026-07-11 12:00", actions: [{ id: "toDate", label: "转日期" }, { id: "toTimestamp", label: "转时间戳" }] },
  uuid: { title: "UUID 生成", desc: "生成 UUID v4 格式的随机标识", placeholder: "无需输入，直接点击生成", actions: [{ id: "generate", label: "生成 UUID" }] },
  jwt: { title: "JWT 解析", desc: "本地解析 Header 和 Payload，不校验签名", placeholder: "粘贴 JWT Token…", actions: [{ id: "parse", label: "解析 JWT" }] },
  hash: { title: "哈希 / 校验", desc: "计算文字的 MD5、SHA-1、SHA-256 或 SHA-512", placeholder: "输入需要计算哈希的文字…", actions: [{ id: "md5", label: "MD5" }, { id: "sha1", label: "SHA-1" }, { id: "sha256", label: "SHA-256" }, { id: "sha512", label: "SHA-512" }] },
  regex: { title: "正则测试", desc: "测试表达式并列出匹配结果", placeholder: "输入要测试的文本…", auxiliaryLabel: "正则表达式", auxiliaryPlaceholder: "例如：\\d+", actions: [{ id: "match", label: "开始匹配" }] },
  textDiff: { title: "文本 Diff", desc: "按行对比两段文本的差异", placeholder: "输入原始文本…", auxiliaryLabel: "对比文本", auxiliaryPlaceholder: "输入修改后的文本…", actions: [{ id: "diff", label: "对比差异" }] },
  jsonYaml: { title: "JSON-YAML", desc: "在 JSON 与 YAML 数据格式之间转换", placeholder: "粘贴 JSON 或 YAML 数据…", actions: [{ id: "toYaml", label: "JSON → YAML" }, { id: "toJson", label: "YAML → JSON" }] },
  radix: { title: "进制转换", desc: "识别 0b、0o、0x 前缀并转换", placeholder: "输入整数，例如 255、0xff 或 0b1010", actions: [{ id: "convert", label: "开始转换" }] },
  cron: { title: "Cron 解析", desc: "解析标准 5 段 Cron 表达式", placeholder: "输入表达式，例如 */5 9-18 * * 1-5", actions: [{ id: "parse", label: "解析表达式" }] }
};

function utf8Encode(text) {
  const bytes = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code <= 0x7f) bytes.push(code);
    else if (code <= 0x7ff) bytes.push(0xc0 | code >> 6, 0x80 | code & 0x3f);
    else if (code <= 0xffff) bytes.push(0xe0 | code >> 12, 0x80 | code >> 6 & 0x3f, 0x80 | code & 0x3f);
    else bytes.push(0xf0 | code >> 18, 0x80 | code >> 12 & 0x3f, 0x80 | code >> 6 & 0x3f, 0x80 | code & 0x3f);
  }
  return bytes;
}

function utf8Decode(bytes) {
  let result = "";
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++];
    let code = first;
    if ((first & 0xe0) === 0xc0) code = (first & 0x1f) << 6 | bytes[index++] & 0x3f;
    else if ((first & 0xf0) === 0xe0) code = (first & 0x0f) << 12 | (bytes[index++] & 0x3f) << 6 | bytes[index++] & 0x3f;
    else if ((first & 0xf8) === 0xf0) code = (first & 0x07) << 18 | (bytes[index++] & 0x3f) << 12 | (bytes[index++] & 0x3f) << 6 | bytes[index++] & 0x3f;
    result += String.fromCodePoint(code);
  }
  return result;
}

function base64Encode(text) {
  const bytes = utf8Encode(text);
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const triple = first << 16 | (second || 0) << 8 | third || 0;
    result += BASE64_CHARS[triple >> 18 & 63];
    result += BASE64_CHARS[triple >> 12 & 63];
    result += second === undefined ? "=" : BASE64_CHARS[triple >> 6 & 63];
    result += third === undefined ? "=" : BASE64_CHARS[triple & 63];
  }
  return result;
}

function base64Decode(value) {
  const clean = value.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  if (!clean || clean.length % 4 === 1) throw new Error("Base64 格式不正确");
  const padded = clean + "=".repeat((4 - clean.length % 4) % 4);
  const bytes = [];
  for (let index = 0; index < padded.length; index += 4) {
    const values = padded.slice(index, index + 4).split("").map((char) => char === "=" ? 0 : BASE64_CHARS.indexOf(char));
    if (values.some((item) => item < 0)) throw new Error("Base64 格式不正确");
    const triple = values[0] << 18 | values[1] << 12 | values[2] << 6 | values[3];
    bytes.push(triple >> 16 & 255);
    if (padded[index + 2] !== "=") bytes.push(triple >> 8 & 255);
    if (padded[index + 3] !== "=") bytes.push(triple & 255);
  }
  return utf8Decode(bytes);
}

function generateUuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === "x" ? random : random & 0x3 | 0x8).toString(16);
  });
}

function formatJson(value, spaces) {
  return JSON.stringify(JSON.parse(value), null, spaces);
}

function parseTimestamp(value, action) {
  const input = value.trim();
  if (action === "toDate") {
    const numeric = Number(input);
    if (!Number.isFinite(numeric)) throw new Error("请输入有效时间戳");
    const milliseconds = Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    if (Number.isNaN(date.getTime())) throw new Error("时间戳无效");
    return `本地：${date.toLocaleString()}\nISO：${date.toISOString()}\n秒：${Math.floor(milliseconds / 1000)}\n毫秒：${milliseconds}`;
  }
  const date = input ? new Date(input.replace(/-/g, "/")) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error("请输入有效日期");
  return `秒：${Math.floor(date.getTime() / 1000)}\n毫秒：${date.getTime()}\nISO：${date.toISOString()}`;
}

function parseJwt(value) {
  const parts = value.trim().split(".");
  if (parts.length < 2) throw new Error("JWT 格式不正确");
  return `Header\n${formatJson(base64Decode(parts[0]), 2)}\n\nPayload\n${formatJson(base64Decode(parts[1]), 2)}\n\n提示：仅解析内容，未验证签名。`;
}

function testRegex(pattern, text) {
  if (!pattern) throw new Error("请输入正则表达式");
  const regex = new RegExp(pattern, "g");
  const matches = [];
  let match;
  while ((match = regex.exec(text)) && matches.length < 200) {
    matches.push(`[${match.index}] ${match[0]}`);
    if (match[0] === "") regex.lastIndex += 1;
  }
  return matches.length ? `匹配 ${matches.length} 项\n\n${matches.join("\n")}` : "没有匹配结果";
}

function diffLines(original, changed) {
  const left = original.replace(/\r\n?/g, "\n").split("\n");
  const right = changed.replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    if (left[index] === right[index]) output.push(`  ${left[index] || ""}`);
    else {
      if (left[index] !== undefined) output.push(`- ${left[index]}`);
      if (right[index] !== undefined) output.push(`+ ${right[index]}`);
    }
  }
  return output.join("\n");
}

function convertRadix(value) {
  const input = value.trim().toLowerCase();
  let base = 10;
  if (/^-?0x[0-9a-f]+$/.test(input)) base = 16;
  else if (/^-?0b[01]+$/.test(input)) base = 2;
  else if (/^-?0o[0-7]+$/.test(input)) base = 8;
  const normalized = input.replace(/^(-?)0[xbo]/, "$1");
  const number = parseInt(normalized, base);
  if (!Number.isSafeInteger(number)) throw new Error("请输入安全范围内的整数");
  return `二进制：${number.toString(2)}\n八进制：${number.toString(8)}\n十进制：${number}\n十六进制：${number.toString(16).toUpperCase()}`;
}

function hashText(value, algorithm) {
  const algorithms = { md5: CryptoJS.MD5, sha1: CryptoJS.SHA1, sha256: CryptoJS.SHA256, sha512: CryptoJS.SHA512 };
  if (!algorithms[algorithm]) throw new Error("不支持该哈希算法");
  return algorithms[algorithm](value).toString(CryptoJS.enc.Hex);
}

function convertJsonYaml(value, action) {
  if (action === "toYaml") return yaml.dump(JSON.parse(value), { noRefs: true, lineWidth: 100 });
  return JSON.stringify(yaml.load(value), null, 2);
}

function describeCronField(value, label, unit) {
  if (value === "*") return `${label}：每${unit}`;
  const step = value.match(/^\*\/(\d+)$/);
  if (step) return `${label}：每 ${step[1]} ${unit}`;
  if (value.includes(",")) return `${label}：在 ${value.split(",").join("、")}`;
  if (value.includes("-")) return `${label}：从 ${value.replace("-", " 到 ")}`;
  return `${label}：${value}`;
}

function parseCron(value) {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("请输入标准 5 段 Cron 表达式");
  if (parts.some((part) => !/^[\d*/?,\-]+$/.test(part))) throw new Error("表达式包含不支持的字符");
  const labels = [
    describeCronField(parts[0], "分钟", "分钟"),
    describeCronField(parts[1], "小时", "小时"),
    describeCronField(parts[2], "日期", "天"),
    describeCronField(parts[3], "月份", "月"),
    describeCronField(parts[4], "星期", "周")
  ];
  return `表达式：${parts.join(" ")}\n\n${labels.join("\n")}\n\n说明：星期通常使用 0-6，0 代表星期日；具体执行规则以目标系统为准。`;
}

Page({
  data: {
    tool: "json",
    config: toolConfigs.json,
    input: "",
    auxiliary: "",
    output: "",
    error: ""
  },

  onLoad(options) {
    const tool = toolConfigs[options.tool] ? options.tool : "json";
    const config = toolConfigs[tool];
    this.setData({ tool, config });
    wx.setNavigationBarTitle({ title: config.title });
  },

  changeInput(event) { this.setData({ input: event.detail.value || "", error: "" }); },
  changeAuxiliary(event) { this.setData({ auxiliary: event.detail.value || "", error: "" }); },
  pasteInput() { wx.getClipboardData({ success: (result) => this.setData({ input: result.data || "", error: "" }) }); },
  clearAll() { this.setData({ input: "", auxiliary: "", output: "", error: "" }); },

  runAction(event) {
    const action = event.currentTarget.dataset.action;
    const { tool, input, auxiliary } = this.data;
    try {
      let output = "";
      if (tool === "json") output = formatJson(input, action === "format" ? 2 : 0);
      else if (tool === "base64") output = action === "encode" ? base64Encode(input) : base64Decode(input);
      else if (tool === "urlCodec") output = action === "encode" ? encodeURIComponent(input) : decodeURIComponent(input);
      else if (tool === "timestamp") output = parseTimestamp(input, action);
      else if (tool === "uuid") output = generateUuid();
      else if (tool === "jwt") output = parseJwt(input);
      else if (tool === "hash") output = hashText(input, action);
      else if (tool === "regex") output = testRegex(auxiliary, input);
      else if (tool === "textDiff") output = diffLines(input, auxiliary);
      else if (tool === "jsonYaml") output = convertJsonYaml(input, action);
      else if (tool === "radix") output = convertRadix(input);
      else if (tool === "cron") output = parseCron(input);
      this.setData({ output, error: "" });
    } catch (error) {
      this.setData({ output: "", error: error.message || "处理失败，请检查输入" });
    }
  },

  copyOutput() {
    if (!this.data.output) return wx.showToast({ title: "没有可复制的结果", icon: "none" });
    wx.setClipboardData({ data: this.data.output });
  }
});
