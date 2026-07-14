import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { BookOpen, FileText, Image, Layers3, Lightbulb, Network, Video, X } from "lucide-react";

import {
  acceptKnowledgeCandidate,
  createKnowledgeLink,
  dismissKnowledgeCandidate,
  generateKnowledgeAiSuggestions,
  getKnowledgeCandidates,
  getKnowledgeGraph,
  getKnowledgeNode,
  listKnowledgeExplorerNodes,
  runKnowledgeBackfill,
  updateKnowledgeNode,
} from "./api";
import KnowledgeGraphPanel from "./KnowledgeGraphPanel";
import KnowledgeList from "./KnowledgeList";
import KnowledgeTree from "./KnowledgeTree";
import type {
  KnowledgeAiSuggestion,
  KnowledgeCandidate,
  KnowledgeExplorerNode,
  KnowledgeExplorerSource,
  KnowledgeGraphResponse,
  KnowledgeNodeDetail,
  KnowledgeRelationType,
} from "./types";

const RELATION_OPTIONS: Array<{ value: KnowledgeRelationType; label: string }> = [
  { value: "related", label: "相关" },
  { value: "references", label: "引用" },
  { value: "derived_from", label: "衍生" },
  { value: "belongs_to", label: "归属" },
  { value: "supports", label: "支持" },
  { value: "contrasts", label: "对照" },
  { value: "mentions", label: "提及" },
];

const RELATION_LABELS = Object.fromEntries(RELATION_OPTIONS.map((option) => [option.value, option.label])) as Record<KnowledgeRelationType, string>;

const KIND_LABELS = {
  image: "图片",
  markdown: "文字笔记",
  combo: "组合灵感",
  video: "视频",
  book: "灵感册",
  weekly_note: "周记",
  concept: "概念",
} as const;

export interface KnowledgeBaseViewProps {
  onBack?: () => void;
  aiHeaders?: Record<string, string>;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function InspectorPreview({ item }: { item?: KnowledgeExplorerNode }) {
  if (!item) return null;
  const urls = item.preview.thumbnailUrls;
  if (urls.length > 0) {
    return (
      <div className={`mt-4 grid max-h-56 overflow-hidden rounded-2xl bg-black/5 ${urls.length > 1 ? "grid-cols-2" : ""}`}>
        {urls.map((url) => <img key={url} src={url} alt="" className="h-full max-h-56 w-full object-cover" />)}
      </div>
    );
  }
  const Icon = item.preview.kind === "markdown" || item.preview.kind === "weekly_note" ? FileText
    : item.preview.kind === "combo" ? Layers3
      : item.preview.kind === "video" ? Video
        : item.preview.kind === "book" ? BookOpen
          : item.preview.kind === "concept" ? Lightbulb : Image;
  return <div className="mt-4 grid h-32 place-items-center rounded-2xl bg-black/5 dark:bg-white/5"><Icon size={34} className="opacity-35" /></div>;
}

export default function KnowledgeBaseView({ onBack, aiHeaders = {} }: KnowledgeBaseViewProps) {
  const [source, setSource] = useState<KnowledgeExplorerSource>({ kind: "all", label: "全部知识" });
  const [query, setQuery] = useState("");
  const [nodes, setNodes] = useState<KnowledgeExplorerNode[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<KnowledgeNodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<KnowledgeCandidate[]>([]);
  const [graph, setGraph] = useState<KnowledgeGraphResponse | null>(null);
  const [graphDepth, setGraphDepth] = useState<1 | 2>(2);
  const [graphOpen, setGraphOpen] = useState(false);
  const [relationTargetId, setRelationTargetId] = useState("");
  const [relationType, setRelationType] = useState<KnowledgeRelationType>("related");
  const [relationContext, setRelationContext] = useState("");
  const [relationStatus, setRelationStatus] = useState<string | null>(null);
  const [relationBusy, setRelationBusy] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<KnowledgeAiSuggestion[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editMarkdown, setEditMarkdown] = useState("");
  const [editProperties, setEditProperties] = useState("{}");
  const [editStatus, setEditStatus] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  const selectedExplorerNode = useMemo(() => nodes.find((node) => node.id === selectedId), [nodes, selectedId]);

  const loadPage = useCallback(async (cursor: string | null, append: boolean, signal?: AbortSignal) => {
    const input = {
      query,
      cursor,
      pageSize: 30,
      signal,
      ...(source.kind === "folder" ? { folderId: source.id }
        : source.kind === "unfiled" ? { unfiled: true }
          : source.kind === "contentType" ? { contentType: source.contentType }
            : source.kind === "entityType" ? { entityType: source.entityType }
              : {}),
    };
    const result = await listKnowledgeExplorerNodes(input);
    setNodes((current) => append ? [...current, ...result.nodes.filter((node) => !current.some((item) => item.id === node.id))] : result.nodes);
    setNextCursor(result.nextCursor);
    if (!append) setSelectedId((current) => current && result.nodes.some((node) => node.id === current) ? current : null);
  }, [query, source]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setListLoading(true);
      setListError(null);
      void loadPage(null, false, controller.signal)
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setListError(errorText(error, "知识列表加载失败"));
        })
        .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadPage, refreshVersion]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedNode(null);
      setCandidates([]);
      setDetailError(null);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    void Promise.all([getKnowledgeNode(selectedId, controller.signal), getKnowledgeCandidates(selectedId)])
      .then(([detailResult, candidateResult]) => {
        setSelectedNode(detailResult.node);
        setCandidates(candidateResult.candidates.slice(0, 3));
        setRelationTargetId("");
        setRelationContext("");
        setRelationStatus(null);
        setAiSuggestions([]);
        setAiStatus(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDetailError(errorText(error, "知识详情加载失败"));
      })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) { setGraph(null); return; }
    void getKnowledgeGraph(selectedId, graphDepth).then(setGraph).catch(() => setGraph(null));
  }, [graphDepth, selectedId]);

  useEffect(() => {
    if (!selectedNode) { setEditing(false); return; }
    setEditTitle(selectedNode.title);
    setEditTags(selectedNode.tags.join("，"));
    setEditMarkdown(selectedNode.markdown ?? "");
    setEditProperties(JSON.stringify(selectedNode.properties, null, 2));
    setEditStatus(null);
    setEditing(false);
  }, [selectedNode]);

  async function refreshRelations(nodeId: string) {
    const [candidateResult, graphResult] = await Promise.all([
      getKnowledgeCandidates(nodeId),
      getKnowledgeGraph(nodeId, graphDepth),
    ]);
    setCandidates(candidateResult.candidates.slice(0, 3));
    setGraph(graphResult);
  }

  async function acceptCandidate(targetId: string) {
    if (!selectedId) return;
    setRelationBusy(true);
    try {
      await acceptKnowledgeCandidate(selectedId, targetId);
      await refreshRelations(selectedId);
      setRelationStatus("已建立关系");
    } catch (error) {
      setRelationStatus(errorText(error, "关系建立失败"));
    } finally { setRelationBusy(false); }
  }

  async function dismissCandidate(targetId: string) {
    if (!selectedId) return;
    setRelationBusy(true);
    try {
      await dismissKnowledgeCandidate(selectedId, targetId);
      await refreshRelations(selectedId);
      setRelationStatus("已忽略建议");
    } catch (error) {
      setRelationStatus(errorText(error, "建议忽略失败"));
    } finally { setRelationBusy(false); }
  }

  async function createManualRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !relationTargetId.trim()) return;
    setRelationBusy(true);
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
    } catch (error) {
      setRelationStatus(errorText(error, "手工关系添加失败"));
    } finally { setRelationBusy(false); }
  }

  async function generateAiSuggestions() {
    if (!selectedId) return;
    setAiBusy(true);
    setAiStatus(null);
    try {
      const result = await generateKnowledgeAiSuggestions(selectedId, aiHeaders);
      const unique = Array.from(new Map(result.suggestions.map((item) => [item.targetNodeId, item])).values()).slice(0, 3);
      setAiSuggestions(unique);
      setAiStatus(unique.length > 0 ? "AI 已生成待确认建议，不会自动写入知识库。" : "AI 没有找到足够可靠的关系建议。");
    } catch (error) {
      setAiStatus(errorText(error, "AI 建议生成失败"));
    } finally { setAiBusy(false); }
  }

  function targetTitle(targetNodeId: string): string {
    return graph?.nodes.find((node) => node.id === targetNodeId)?.title
      ?? candidates.find((candidate) => candidate.node.id === targetNodeId)?.node.title
      ?? "未知目标";
  }

  async function saveNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedNode) return;
    setEditBusy(true);
    try {
      const properties = JSON.parse(editProperties || "{}") as unknown;
      if (!properties || typeof properties !== "object" || Array.isArray(properties)) throw new Error("属性 JSON 必须是对象");
      const result = await updateKnowledgeNode(selectedNode.id, {
        revision: selectedNode.revision,
        title: editTitle.trim(),
        tags: editTags.split(/[,，、;；\n]/u).map((tag) => tag.trim()).filter(Boolean),
        markdown: editMarkdown,
        properties: properties as KnowledgeNodeDetail["properties"],
      });
      setSelectedNode(result.node);
      setNodes((current) => current.map((node) => node.id === result.node.id ? { ...node, ...result.node } : node));
      setEditing(false);
      setEditStatus("已保存知识内容");
    } catch (error) {
      setEditStatus(errorText(error, "知识保存失败"));
    } finally { setEditBusy(false); }
  }

  async function backfillHistory() {
    setBackfillBusy(true);
    setBackfillStatus("正在整理历史内容…");
    try {
      let cursor: string | null = null;
      let processed = 0;
      let created = 0;
      let updated = 0;
      for (let batch = 0; batch < 50; batch += 1) {
        const result = await runKnowledgeBackfill(cursor);
        processed += result.processed;
        created += result.created;
        updated += result.updated;
        cursor = result.nextCursor;
        if (result.done) break;
      }
      setBackfillStatus(`回填完成：处理 ${processed} 条，新增 ${created}，更新 ${updated}`);
      setRefreshVersion((value) => value + 1);
    } catch (error) {
      setBackfillStatus(errorText(error, "历史回填失败"));
    } finally { setBackfillBusy(false); }
  }

  return (
    <main className="h-screen overflow-hidden bg-[#f8f4ee] text-[#302820] dark:bg-[#171310] dark:text-[#f7ede2]">
      <header className="flex h-16 items-center gap-3 border-b border-black/10 bg-[#fdfaf6] px-4 dark:border-white/10 dark:bg-[#1d1815]">
        {onBack && <button type="button" onClick={onBack} className="rounded-full border border-current/15 px-3 py-1.5 text-sm">返回</button>}
        <div><h1 className="text-lg font-semibold">知识库</h1><p className="text-[11px] opacity-50">目录、内容和关系在同一个工作区整理</p></div>
        <button type="button" disabled={backfillBusy} onClick={() => void backfillHistory()} className="ml-auto rounded-full border border-current/15 px-3 py-1.5 text-xs disabled:opacity-40">{backfillBusy ? "整理中…" : "历史回填"}</button>
      </header>
      {backfillStatus && <div className="absolute right-4 top-[70px] z-30 rounded-xl border border-black/10 bg-white px-3 py-2 text-xs shadow-lg dark:border-white/10 dark:bg-[#29211c]">{backfillStatus}</div>}

      <section className="grid h-[calc(100vh-4rem)] min-h-0 grid-cols-1 md:grid-cols-[220px_minmax(280px,380px)_minmax(340px,1fr)]">
        <div className="hidden min-h-0 md:block"><KnowledgeTree selected={source} onSelect={(next) => { setSource(next); setSelectedId(null); }} /></div>

        <section className="flex min-h-0 flex-col border-r border-black/10 bg-[#fdfaf6] dark:border-white/10 dark:bg-[#1d1815]">
          <div className="border-b border-black/10 p-3 dark:border-white/10">
            <div className="flex items-center justify-between gap-2"><h2 className="truncate text-sm font-semibold">{source.label}</h2><span className="text-[10px] opacity-45">{nodes.length}{nextCursor ? "+" : ""} 条</span></div>
            <label htmlFor="knowledge-search" className="sr-only">搜索知识</label>
            <input id="knowledge-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前知识范围" className="mt-2 w-full rounded-xl border border-black/10 bg-black/[0.025] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500/30 dark:border-white/10 dark:bg-white/5" />
          </div>
          <KnowledgeList nodes={nodes} selectedId={selectedId} loading={listLoading} error={listError} nextCursor={nextCursor} onSelect={setSelectedId} onLoadMore={() => {
            if (!nextCursor || listLoading) return;
            setListLoading(true);
            void loadPage(nextCursor, true).catch((error) => setListError(errorText(error, "加载更多失败"))).finally(() => setListLoading(false));
          }} />
        </section>

        <aside aria-label="知识详情" className="min-h-0 overflow-auto bg-[#fdfaf6] p-5 dark:bg-[#1d1815]">
          {!selectedId && <div className="grid h-full min-h-64 place-items-center text-center"><div><Layers3 className="mx-auto mb-3 opacity-20" size={36} /><p className="text-sm opacity-55">从目录内容中选择一条知识</p></div></div>}
          {selectedId && detailLoading && <p className="py-16 text-center text-sm opacity-55">正在加载详情…</p>}
          {selectedId && !detailLoading && detailError && <div role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{detailError}</div>}
          {selectedNode && !detailLoading && !detailError && (
            <article className="mx-auto max-w-2xl">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] text-amber-800 dark:text-amber-200">{selectedExplorerNode ? KIND_LABELS[selectedExplorerNode.preview.kind] : selectedNode.entityType}</span>
                  <h2 className="mt-2 text-xl font-semibold leading-tight">{selectedNode.title}</h2>
                  {selectedExplorerNode?.folders.length ? <p className="mt-1 text-xs opacity-45">{selectedExplorerNode.folders.map((folder) => folder.name).join(" / ")}</p> : <p className="mt-1 text-xs opacity-45">未归档</p>}
                </div>
                <button type="button" onClick={() => setEditing((value) => !value)} className="rounded-full border border-current/15 px-3 py-1 text-xs">{editing ? "取消" : "编辑"}</button>
              </div>
              <InspectorPreview item={selectedExplorerNode} />

              {editing ? (
                <form className="mt-4 space-y-3" onSubmit={(event) => void saveNode(event)}>
                  <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} className="w-full rounded-xl border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/15" />
                  <input value={editTags} onChange={(event) => setEditTags(event.target.value)} placeholder="标签，用逗号分隔" className="w-full rounded-xl border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/15" />
                  <textarea value={editMarkdown} onChange={(event) => setEditMarkdown(event.target.value)} rows={8} className="w-full rounded-xl border border-black/15 bg-transparent px-3 py-2 text-sm leading-6 dark:border-white/15" />
                  <details><summary className="cursor-pointer text-xs opacity-60">高级属性</summary><textarea value={editProperties} onChange={(event) => setEditProperties(event.target.value)} rows={5} className="mt-2 w-full rounded-xl border border-black/15 bg-transparent px-3 py-2 font-mono text-xs dark:border-white/15" /></details>
                  <button type="submit" disabled={editBusy || !editTitle.trim()} className="rounded-full bg-[#302820] px-4 py-2 text-sm text-white disabled:opacity-40">{editBusy ? "保存中…" : "保存"}</button>
                </form>
              ) : selectedNode.markdown ? <pre className="mt-5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/[0.025] p-3 font-sans text-sm leading-6 opacity-80 dark:bg-white/5">{selectedNode.markdown}</pre> : null}
              {selectedNode.tags.length > 0 && <p className="mt-3 text-xs opacity-55">{selectedNode.tags.map((tag) => `#${tag}`).join(" ")}</p>}
              {editStatus && <p className="mt-2 text-xs opacity-60">{editStatus}</p>}

              <section className="mt-6 border-t border-black/10 pt-5 dark:border-white/10">
                <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">待确认关系</h3><span className="text-[10px] opacity-45">最多显示 3 条</span></div>
                {candidates.length === 0 ? <p className="mt-2 text-sm opacity-50">暂无可靠的候选关系。</p> : (
                  <ul className="mt-3 space-y-2">
                    {candidates.map((candidate) => (
                      <li key={candidate.node.id} className="rounded-xl border border-black/10 p-3 dark:border-white/10">
                        <div className="flex gap-3">
                          {candidate.node.preview?.thumbnailUrls[0] ? <img src={candidate.node.preview.thumbnailUrls[0]} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <div className="grid h-12 w-12 place-items-center rounded-lg bg-black/5"><FileText size={18} className="opacity-35" /></div>}
                          <div className="min-w-0 flex-1"><strong className="block truncate text-sm">{candidate.node.title}</strong><span className="text-[10px] opacity-50">{candidate.node.preview ? KIND_LABELS[candidate.node.preview.kind] : candidate.node.entityType}{candidate.node.folders?.length ? ` · ${candidate.node.folders.map((folder) => folder.name).join(" / ")}` : ""}</span><p className="mt-1 text-xs opacity-60">匹配 {Math.round(candidate.score * 100)}%{candidate.evidence.sharedTags.length ? ` · 共同标签：${candidate.evidence.sharedTags.join("、")}` : ""}</p></div>
                          <div className="flex shrink-0 flex-col gap-1"><button type="button" disabled={relationBusy} onClick={() => void acceptCandidate(candidate.node.id)} className="rounded-full border border-emerald-500/40 px-2 py-1 text-[10px] text-emerald-700">建立</button><button type="button" disabled={relationBusy} onClick={() => void dismissCandidate(candidate.node.id)} className="rounded-full border border-current/15 px-2 py-1 text-[10px] opacity-60">忽略</button></div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {relationStatus && <p className="mt-2 text-xs opacity-60">{relationStatus}</p>}
              </section>

              <section className="mt-6 border-t border-black/10 pt-5 dark:border-white/10">
                <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">AI 关系建议</h3><button type="button" disabled={aiBusy} onClick={() => void generateAiSuggestions()} className="rounded-full border border-current/15 px-3 py-1 text-xs disabled:opacity-40">{aiBusy ? "生成中…" : "手动生成"}</button></div>
                {aiStatus && <p className="mt-2 text-xs opacity-60">{aiStatus}</p>}
                {aiSuggestions.length > 0 && <ul className="mt-3 space-y-2">{aiSuggestions.map((suggestion) => <li key={`${suggestion.targetNodeId}:${suggestion.relationType}`} className="rounded-xl border border-black/10 p-3 text-sm dark:border-white/10"><div className="flex justify-between gap-3"><div><strong>{targetTitle(suggestion.targetNodeId)}</strong><p className="mt-1 text-xs opacity-55">建议“{RELATION_LABELS[suggestion.relationType]}” · 置信度 {Math.round(suggestion.confidence * 100)}%</p><p className="mt-1 text-xs opacity-65">{suggestion.reason}</p></div><button type="button" onClick={() => { setRelationTargetId(suggestion.targetNodeId); setRelationType(suggestion.relationType); setRelationContext(suggestion.reason); }} className="shrink-0 rounded-full border border-amber-500/40 px-2 py-1 text-[10px]">填入表单</button></div></li>)}</ul>}
              </section>

              <section className="mt-6 border-t border-black/10 pt-5 dark:border-white/10">
                <details open={Boolean(relationTargetId)}><summary className="cursor-pointer text-sm font-semibold">手工关系</summary><form className="mt-3 space-y-2" onSubmit={(event) => void createManualRelation(event)}><input value={relationTargetId} onChange={(event) => setRelationTargetId(event.target.value)} placeholder="目标节点 ID" className="w-full rounded-xl border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/15" /><div className="flex gap-2"><select value={relationType} onChange={(event) => setRelationType(event.target.value as KnowledgeRelationType)} className="min-w-0 flex-1 rounded-xl border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/15">{RELATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><button type="submit" disabled={relationBusy || !relationTargetId.trim()} className="rounded-full bg-[#302820] px-4 py-2 text-sm text-white disabled:opacity-40">添加</button></div><input value={relationContext} onChange={(event) => setRelationContext(event.target.value)} placeholder="关系说明，可选" className="w-full rounded-xl border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/15" /></form></details>
              </section>

              <section className="mt-6 border-t border-black/10 pt-5 dark:border-white/10">
                <div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold">局部图谱</h3><p className="mt-1 text-xs opacity-50">{graph ? `${graph.nodes.length} 个节点 · ${graph.edges.length} 条关系` : "暂无关系"}</p></div><button type="button" disabled={!graph || graph.nodes.length <= 1} onClick={() => setGraphOpen(true)} className="flex items-center gap-2 rounded-full border border-current/15 px-3 py-1.5 text-xs disabled:opacity-35"><Network size={14} />打开图谱</button></div>
              </section>
            </article>
          )}
        </aside>
      </section>

      {graphOpen && graph && selectedNode && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="局部知识图谱">
          <div className="flex h-[min(820px,92vh)] w-[min(1180px,96vw)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#211b17]">
            <div className="flex items-center border-b border-black/10 px-4 py-3 dark:border-white/10"><div><strong>{selectedNode.title}</strong><p className="text-xs opacity-50">点击其他知识可切换中心</p></div><button type="button" onClick={() => setGraphOpen(false)} className="ml-auto rounded-full p-2 hover:bg-black/5" aria-label="关闭图谱"><X size={18} /></button></div>
            <div className="min-h-0 flex-1"><KnowledgeGraphPanel graph={graph} depth={graphDepth} onDepthChange={setGraphDepth} onSelectNode={(nodeId) => { setSelectedId(nodeId); setGraphOpen(false); }} /></div>
          </div>
        </div>
      )}
    </main>
  );
}
