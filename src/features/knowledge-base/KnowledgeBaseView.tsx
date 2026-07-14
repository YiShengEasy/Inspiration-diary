import { useEffect, useState, type FormEvent } from "react";
import {
  acceptKnowledgeCandidate,
  createKnowledgeLink,
  dismissKnowledgeCandidate,
  getKnowledgeCandidates,
  getKnowledgeGraph,
  getKnowledgeNode,
  listKnowledgeNodes,
} from "./api";
import type {
  KnowledgeCandidate,
  KnowledgeGraphResponse,
  KnowledgeNodeDetail,
  KnowledgeNodeSummary,
  KnowledgeRelationType,
} from "./types";

const ENTITY_LABELS: Record<KnowledgeNodeSummary["entityType"], string> = {
  card: "灵感卡片",
  book: "灵感册",
  weekly_note: "周记",
  concept: "概念",
};

const RELATION_OPTIONS: Array<{ value: KnowledgeRelationType; label: string }> = [
  { value: "related", label: "相关" },
  { value: "references", label: "引用" },
  { value: "derived_from", label: "衍生" },
  { value: "belongs_to", label: "归属" },
  { value: "supports", label: "支持" },
  { value: "contrasts", label: "对照" },
  { value: "mentions", label: "提及" },
];

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
  const [candidates, setCandidates] = useState<KnowledgeCandidate[]>([]);
  const [graph, setGraph] = useState<KnowledgeGraphResponse | null>(null);
  const [relationTargetId, setRelationTargetId] = useState("");
  const [relationType, setRelationType] = useState<KnowledgeRelationType>("related");
  const [relationContext, setRelationContext] = useState("");
  const [relationStatus, setRelationStatus] = useState<string | null>(null);
  const [relationBusy, setRelationBusy] = useState(false);

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
    void Promise.all([
      getKnowledgeNode(selectedId, controller.signal),
      getKnowledgeCandidates(selectedId),
      getKnowledgeGraph(selectedId, 2),
    ])
      .then(([detailResult, candidateResult, graphResult]) => {
        setSelectedNode(detailResult.node);
        setCandidates(candidateResult.candidates);
        setGraph(graphResult);
        setRelationTargetId("");
        setRelationContext("");
        setRelationStatus(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDetailError(error instanceof Error ? error.message : "知识详情加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedId]);

  async function refreshRelations(nodeId: string) {
    const [candidateResult, graphResult] = await Promise.all([
      getKnowledgeCandidates(nodeId),
      getKnowledgeGraph(nodeId, 2),
    ]);
    setCandidates(candidateResult.candidates);
    setGraph(graphResult);
  }

  async function handleAcceptCandidate(targetId: string) {
    if (!selectedId) return;
    setRelationBusy(true);
    setRelationStatus(null);
    try {
      await acceptKnowledgeCandidate(selectedId, targetId);
      await refreshRelations(selectedId);
      setRelationStatus("已建立候选关系");
    } catch (error: unknown) {
      setRelationStatus(error instanceof Error ? error.message : "候选关系建立失败");
    } finally {
      setRelationBusy(false);
    }
  }

  async function handleDismissCandidate(targetId: string) {
    if (!selectedId) return;
    setRelationBusy(true);
    setRelationStatus(null);
    try {
      await dismissKnowledgeCandidate(selectedId, targetId);
      await refreshRelations(selectedId);
      setRelationStatus("已忽略候选关系");
    } catch (error: unknown) {
      setRelationStatus(error instanceof Error ? error.message : "候选关系忽略失败");
    } finally {
      setRelationBusy(false);
    }
  }

  async function handleCreateManualRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !relationTargetId.trim()) return;
    setRelationBusy(true);
    setRelationStatus(null);
    try {
      await createKnowledgeLink({
        sourceNodeId: selectedId,
        targetNodeId: relationTargetId.trim(),
        relationType,
        context: relationContext.trim() || undefined,
      });
      await refreshRelations(selectedId);
      setRelationTargetId("");
      setRelationContext("");
      setRelationStatus("已添加手工关系");
    } catch (error: unknown) {
      setRelationStatus(error instanceof Error ? error.message : "手工关系添加失败");
    } finally {
      setRelationBusy(false);
    }
  }

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

              <section className="mt-6 border-t border-black/10 pt-5 dark:border-white/10">
                <h3 className="text-sm font-semibold">候选关系</h3>
                {candidates.length === 0 ? (
                  <p className="mt-2 text-sm opacity-55">暂时没有可确认的候选关系。</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {candidates.map((candidate) => (
                      <li key={candidate.node.id} className="rounded-2xl border border-black/10 p-3 text-sm dark:border-white/10">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <strong className="block">{candidate.node.title}</strong>
                            <span className="text-xs opacity-55">匹配度 {Math.round(candidate.score * 100)}%</span>
                            {candidate.evidence.sharedTags.length > 0 && (
                              <span className="mt-1 block text-xs opacity-60">
                                共同标签：{candidate.evidence.sharedTags.join("、")}
                              </span>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              disabled={relationBusy}
                              onClick={() => void handleAcceptCandidate(candidate.node.id)}
                              className="rounded-full border border-emerald-500/40 px-3 py-1 text-xs text-emerald-700 disabled:opacity-40 dark:text-emerald-300"
                            >
                              建立
                            </button>
                            <button
                              type="button"
                              disabled={relationBusy}
                              onClick={() => void handleDismissCandidate(candidate.node.id)}
                              className="rounded-full border border-black/15 px-3 py-1 text-xs opacity-70 disabled:opacity-40 dark:border-white/15"
                            >
                              忽略
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="mt-6 border-t border-black/10 pt-5 dark:border-white/10">
                <h3 className="text-sm font-semibold">手工关系</h3>
                <form className="mt-3 space-y-2" onSubmit={(event) => void handleCreateManualRelation(event)}>
                  <input
                    value={relationTargetId}
                    onChange={(event) => setRelationTargetId(event.target.value)}
                    placeholder="目标节点 ID"
                    className="w-full rounded-2xl border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500/40 dark:border-white/15"
                  />
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <select
                      value={relationType}
                      onChange={(event) => setRelationType(event.target.value as KnowledgeRelationType)}
                      className="rounded-2xl border border-black/15 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/15"
                    >
                      {RELATION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={relationBusy || !relationTargetId.trim()}
                      className="rounded-full bg-[#2d2319] px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-[#f7ede2] dark:text-[#1a1612]"
                    >
                      添加
                    </button>
                  </div>
                  <input
                    value={relationContext}
                    onChange={(event) => setRelationContext(event.target.value)}
                    placeholder="备注，可选"
                    className="w-full rounded-2xl border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500/40 dark:border-white/15"
                  />
                </form>
                {relationStatus && <p className="mt-2 text-xs opacity-65">{relationStatus}</p>}
              </section>

              <section className="mt-6 border-t border-black/10 pt-5 dark:border-white/10">
                <h3 className="text-sm font-semibold">局部图谱</h3>
                {!graph || graph.nodes.length <= 1 ? (
                  <p className="mt-2 text-sm opacity-55">暂无已建立关系。</p>
                ) : (
                  <div className="mt-3 space-y-3 text-sm">
                    <div className="flex flex-wrap gap-2">
                      {graph.nodes.map((node) => (
                        <span
                          key={node.id}
                          className={`rounded-full border px-3 py-1 ${node.distance === 0 ? "border-amber-500 bg-amber-500/10" : "border-black/10 dark:border-white/10"}`}
                        >
                          {node.title}
                        </span>
                      ))}
                    </div>
                    {graph.edges.length > 0 && (
                      <ul className="space-y-1 text-xs opacity-65">
                        {graph.edges.map((edge) => (
                          <li key={edge.id}>
                            {edge.sourceNodeId === selectedNode.id ? "当前节点" : edge.sourceNodeId}
                            {" → "}
                            {edge.targetNodeId === selectedNode.id ? "当前节点" : edge.targetNodeId}
                            {" · "}
                            {edge.relationType}
                            {edge.suggested ? " · 候选" : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    {graph.truncated && <p className="text-xs opacity-55">图谱已按当前视图上限截断。</p>}
                  </div>
                )}
              </section>
            </article>
          )}
        </aside>
      </section>
    </main>
  );
}
