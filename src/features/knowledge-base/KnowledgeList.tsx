import { BookOpen, FileText, Image, Layers3, Lightbulb, Video } from "lucide-react";

import type { KnowledgeExplorerNode } from "./types";

const TYPE_LABELS = {
  image: "图片",
  markdown: "文字笔记",
  combo: "组合灵感",
  video: "视频",
  book: "灵感册",
  weekly_note: "周记",
  concept: "概念",
} as const;

function Preview({ node }: { node: KnowledgeExplorerNode }) {
  const urls = node.preview.thumbnailUrls;
  if (urls.length > 0) {
    return (
      <div className={`grid h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-black/5 ${urls.length > 1 ? "grid-cols-2" : ""}`}>
        {urls.slice(0, 4).map((url) => (
          <img key={url} src={url} alt="" loading="lazy" width={56} height={56} className="h-full min-h-0 w-full object-cover" />
        ))}
      </div>
    );
  }
  const Icon = node.preview.kind === "markdown" || node.preview.kind === "weekly_note" ? FileText
    : node.preview.kind === "combo" ? Layers3
      : node.preview.kind === "video" ? Video
        : node.preview.kind === "book" ? BookOpen
          : node.preview.kind === "concept" ? Lightbulb : Image;
  return <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-black/5 dark:bg-white/10"><Icon size={22} className="opacity-55" /></div>;
}

export default function KnowledgeList({
  nodes,
  selectedId,
  loading,
  error,
  nextCursor,
  onSelect,
  onLoadMore,
}: {
  nodes: KnowledgeExplorerNode[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  nextCursor: string | null;
  onSelect(nodeId: string): void;
  onLoadMore(): void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto" aria-live="polite">
      {loading && nodes.length === 0 && <p className="py-12 text-center text-sm opacity-55">正在加载知识…</p>}
      {error && <div role="alert" className="m-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</div>}
      {!loading && !error && nodes.length === 0 && <p className="py-12 text-center text-sm opacity-55">这里还没有知识内容</p>}
      <ul role="list" aria-label="当前目录内容" className="divide-y divide-black/5 dark:divide-white/5">
        {nodes.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              aria-pressed={selectedId === node.id}
              className={`flex w-full gap-3 px-3 py-3 text-left transition ${selectedId === node.id ? "bg-amber-500/10 ring-1 ring-inset ring-amber-500/40" : "hover:bg-black/[0.035] dark:hover:bg-white/5"}`}
            >
              <Preview node={node} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <strong className="truncate text-sm">{node.title}</strong>
                  <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[10px] opacity-60 dark:bg-white/10">{TYPE_LABELS[node.preview.kind]}</span>
                </span>
                {node.snippet && <span className="mt-1 line-clamp-2 block text-xs leading-5 opacity-55">{node.snippet}</span>}
                <span className="mt-1.5 block truncate text-[10px] opacity-45">
                  {node.folders.length > 0 ? node.folders.map((folder) => folder.name).join(" / ") : "未归档"}
                  {node.tags.length > 0 ? ` · ${node.tags.slice(0, 3).map((tag) => `#${tag}`).join(" ")}` : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {nextCursor && (
        <div className="p-3 text-center">
          <button type="button" disabled={loading} onClick={onLoadMore} className="rounded-full border border-current/15 px-4 py-2 text-xs disabled:opacity-40">
            {loading ? "加载中…" : "加载更多"}
          </button>
        </div>
      )}
    </div>
  );
}
