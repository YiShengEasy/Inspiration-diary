function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderInline(value) {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  return text;
}

function renderMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let inCode = false;
  let codeLines = [];
  let listType = "";

  function closeList() {
    if (listType) html.push(`</${listType}>`);
    listType = "";
  }

  for (const line of lines) {
    if (/^```/.test(line)) {
      closeList();
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const quote = line.match(/^>\s?(.*)$/);

    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
    } else if (unordered) {
      if (listType !== "ul") { closeList(); listType = "ul"; html.push("<ul>"); }
      html.push(`<li>${renderInline(unordered[1])}</li>`);
    } else if (ordered) {
      if (listType !== "ol") { closeList(); listType = "ol"; html.push("<ol>"); }
      html.push(`<li>${renderInline(ordered[1])}</li>`);
    } else if (quote) {
      closeList();
      html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
    } else if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      closeList();
      html.push("<hr>");
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      html.push(`<p>${renderInline(line)}</p>`);
    }
  }
  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  closeList();
  return html.join("");
}

const initialMarkdown = "# 灵感标题\n\n记录今天值得留下的想法。\n\n- 图片与文字一起整理\n- 使用 **重点文字** 强调信息\n- 支持 `行内代码` 和链接\n\n> 灵感来自持续记录。";

Page({
  data: {
    mode: "edit",
    markdown: initialMarkdown,
    previewHtml: renderMarkdown(initialMarkdown)
  },

  switchMode(event) {
    this.setData({ mode: event.currentTarget.dataset.mode });
  },

  changeMarkdown(event) {
    const markdown = event.detail.value || "";
    this.setData({ markdown, previewHtml: renderMarkdown(markdown) });
  },

  pasteMarkdown() {
    wx.getClipboardData({
      success: (result) => {
        const markdown = result.data || "";
        this.setData({ markdown, previewHtml: renderMarkdown(markdown) });
      }
    });
  },

  clearMarkdown() {
    this.setData({ markdown: "", previewHtml: "" });
  },

  copyMarkdown() {
    wx.setClipboardData({ data: this.data.markdown || "" });
  },

  copyHtml() {
    if (!this.data.previewHtml) return wx.showToast({ title: "没有可复制的内容", icon: "none" });
    wx.setClipboardData({ data: this.data.previewHtml });
  }
});
