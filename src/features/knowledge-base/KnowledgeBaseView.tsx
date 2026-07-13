import { useEffect, useState } from "react";
import { getKnowledgeNode, listKnowledgeNodes } from "./api";
import type { KnowledgeNodeDetail, KnowledgeNodeSummary } from "./types";

const ENTITY_LABELS: Record<KnowledgeNodeSummary["entityType"], string> = {
  card: "灵感卡片",
  book: "灵感册",
  weekly_note: "周记",
  concept: "概念",
};

export interface KnowledgeBaseViewProps {
  onBack?: () => void;
}

export default function KnowledgeBaseView({ onBack }: KnowledgeBaseViewProps) {
  const [query, setQuery] = useState("");
  const [nodes, setNodes] = useState<KnowledgeNodeSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<KnowledgeNodeDetail | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setListLoading(true);
      setListError(null);
      void listKnowledgeNodes({ query, page: 1, pageSize: 20, signal: controller.signal })
        .then((result) => {
          setNodes(result.nodes);
          setSelectedId((current) => current && result.nodes.some((node) => node.id === current) ? current : null);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setListError(error instanceof Error ? error.message : "知识列表加载失败");
        })
        .finally(() => {
          if (!controller.signal.aborted) setListLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedNode(null);
      setDetailError(null);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    void getKnowledgeNode(selectedId, controller.signal)
      .then((result) => setSelectedNode(result.node))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDetailError(error instanceof Error ? error.message : "知识详情加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedId]);

  return (
    <main className="min-h-screen bg-[#fdfaf6] px-4 py-6 text-[#2d2319] dark:bg-[#1a1612] dark:text-[#f7ede2] sm:px-8">
      <header className="mx-auto mb-6 flex max-w-6xl items-center gap-4">
        {onBack && (
          <button type="button" onClick={onBack} className="rounded-full border border-current/20 px-4 py-2 text-sm">
            返回
          </button>
        )}
        <div>
          <h1 className="text-2xl font-semibold">知识库</h1>
          <p className="text-sm opacity-60">从灵感卡片、灵感册与周记中查找关联内容</p>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-5 md:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="rounded-3xl border border-black/10 bg-white/70 p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
          <label htmlFor="knowledge-search" className="mb-2 block text-sm font-medium">搜索知识</label>
          <input
            id="knowledge-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入标题、标签或正文关键词"
            className="w-full rounded-2xl border border-black/15 bg-transparent px-4 py-3 outline-none focus:ring-2 focus:ring-amber-500/40 dark:border-white/15"
          />

          <div className="mt-4" aria-live="polite">
            {listLoading && <p className="py-10 text-center text-sm opacity-60">正在加载知识列表…</p>}
            {!listLoading && listError && (
              <div role="alert" className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">{listError}</div>
            )}
            {!listLoading && !listError && nodes.length === 0 && (
              <div className="py-12 text-center">
                <p className="font-medium">{query.trim() ? "没有找到匹配的知识" : "知识库还是空的"}</p>
                <p className="mt-1 text-sm opacity-60">{query.trim() ? "可以尝试更短的关键词。" : "加入卡片或运行历史整理后会显示在这里。"}</p>
              </div>
            )}
            {!listLoading && !listError && nodes.length > 0 && (
              <ul className="space-y-2">
                {nodes.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(node.id)}
                      aria-pressed={selectedId === node.id}
                      className={`w-full rounded-2xl border p-4 text-left transition ${selectedId === node.id ? "border-amber-500 bg-amber-500/10" : "border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"}`}
                    >
                      <span className="text-xs opacity-50">{ENTITY_LABELS[node.entityType]}</span>
                      <strong className="mt-1 block">{node.title}</strong>
                      {node.snippet && <span className="mt-1 line-clamp-2 block text-sm opacity-65">{node.snippet}</span>}
                      {node.tags.length > 0 && <span className="mt-2 block text-xs opacity-55">{node.tags.map((tag) => `#${tag}`).join(" ")}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <aside className="rounded-3xl border border-black/10 bg-white/70 p-5 shadow-sm dark:border-white/10 dark:bg-white/5" aria-live="polite">
          {!selectedId && <p className="py-12 text-center text-sm opacity-60">选择一条知识查看详情</p>}
          {selectedId && detailLoading && <p className="py-12 text-center text-sm opacity-60">正在加载详情…</p>}
          {selectedId && !detailLoading && detailError && <div role="alert" className="text-sm text-red-700 dark:text-red-300">{detailError}</div>}
          {selectedId && !detailLoading && !detailError && selectedNode && (
            <article>
              <span className="text-xs opacity-50">{ENTITY_LABELS[selectedNode.entityType]}</span>
              <h2 className="mt-1 text-xl font-semibold">{selectedNode.title}</h2>
              {selectedNode.tags.length > 0 && <p className="mt-3 text-sm opacity-60">{selectedNode.tags.map((tag) => `#${tag}`).join(" ")}</p>}
              {selectedNode.markdown ? (
                <pre className="mt-5 max-h-[55vh] overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-6 opacity-80">{selectedNode.markdown}</pre>
              ) : (
                <p className="mt-5 text-sm opacity-55">此节点没有可显示的 Markdown 正文。</p>
              )}
            </article>
          )}
        </aside>
      </section>
    </main>
  );
}
