import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, FileText, Folder, FolderPlus, Image, Layers3, Lightbulb, Video } from "lucide-react";

import { createKnowledgeFolder, listKnowledgeFolders } from "./api";
import type { KnowledgeExplorerSource, KnowledgeFolder } from "./types";

interface KnowledgeTreeProps {
  selected: KnowledgeExplorerSource;
  onSelect(source: KnowledgeExplorerSource): void;
}

function sourceKey(source: KnowledgeExplorerSource): string {
  if (source.kind === "folder") return `folder:${source.id}`;
  if (source.kind === "contentType") return `content:${source.contentType}`;
  if (source.kind === "entityType") return `entity:${source.entityType}`;
  return source.kind;
}

function FolderBranch({ folder, selected, onSelect }: {
  folder: KnowledgeFolder;
  selected: KnowledgeExplorerSource;
  onSelect(source: KnowledgeExplorerSource): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<KnowledgeFolder[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (!folder.hasChildren) return;
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) {
      setLoading(true);
      try {
        const result = await listKnowledgeFolders({ parentId: folder.id });
        setChildren(result.folders);
      } finally {
        setLoading(false);
      }
    }
  }

  const active = sourceKey(selected) === `folder:${folder.id}`;
  return (
    <li role="treeitem" aria-expanded={folder.hasChildren ? expanded : undefined}>
      <div className={`group flex items-center rounded-lg ${active ? "bg-white/15 text-white" : "hover:bg-white/10"}`}>
        <button
          type="button"
          onClick={() => void toggle()}
          aria-label={expanded ? `收起 ${folder.name}` : `展开 ${folder.name}`}
          className="grid h-8 w-7 shrink-0 place-items-center opacity-70"
        >
          {folder.hasChildren ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span className="w-3" />}
        </button>
        <button
          type="button"
          onClick={() => onSelect({ kind: "folder", id: folder.id, label: folder.name })}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left text-sm"
        >
          {folder.sourceType === "inspiration_book" ? <BookOpen size={15} /> : <Folder size={15} />}
          <span className="truncate">{folder.name}</span>
          <span className="ml-auto text-[10px] opacity-55">{folder.nodeCount}</span>
        </button>
      </div>
      {expanded && (
        <ul role="group" className="ml-4 border-l border-white/10 pl-1">
          {loading && <li className="px-3 py-2 text-xs opacity-50">加载中…</li>}
          {children?.map((child) => (
            <FolderBranch key={child.id} folder={child} selected={selected} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

const SMART_ITEMS: Array<{ source: KnowledgeExplorerSource; icon: typeof Image }> = [
  { source: { kind: "contentType", contentType: "image", label: "图片" }, icon: Image },
  { source: { kind: "contentType", contentType: "md", label: "文字笔记" }, icon: FileText },
  { source: { kind: "contentType", contentType: "combo", label: "组合灵感" }, icon: Layers3 },
  { source: { kind: "contentType", contentType: "video", label: "视频" }, icon: Video },
  { source: { kind: "entityType", entityType: "book", label: "灵感册节点" }, icon: BookOpen },
  { source: { kind: "entityType", entityType: "concept", label: "概念" }, icon: Lightbulb },
];

export default function KnowledgeTree({ selected, onSelect }: KnowledgeTreeProps) {
  const [folders, setFolders] = useState<KnowledgeFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const result = await listKnowledgeFolders();
      setFolders(result.folders);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "目录加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, []);

  async function submitFolder() {
    const name = newName.trim();
    if (!name) return;
    try {
      await createKnowledgeFolder({ name });
      setCreating(false);
      setNewName("");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "目录创建失败");
    }
  }

  return (
    <nav aria-label="知识目录" className="flex h-full min-h-0 flex-col bg-[#302820] text-[#f6eee5]">
      <div className="flex items-center justify-between px-3 pb-2 pt-4">
        <span className="text-xs font-semibold tracking-[0.18em] opacity-65">知识空间</span>
        <button type="button" onClick={() => setCreating((value) => !value)} className="rounded-lg p-1.5 hover:bg-white/10" aria-label="新建知识文件夹">
          <FolderPlus size={16} />
        </button>
      </div>
      {creating && (
        <div className="mx-3 mb-2 flex gap-1">
          <input
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void submitFolder(); }}
            placeholder="文件夹名称"
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/10 px-2 py-1.5 text-xs outline-none"
          />
          <button type="button" onClick={() => void submitFolder()} className="rounded-lg bg-white px-2 text-xs text-[#302820]">添加</button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-4">
        <ul role="tree" aria-label="知识目录" className="space-y-0.5">
          <li role="treeitem">
            <button
              type="button"
              onClick={() => onSelect({ kind: "all", label: "全部知识" })}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${selected.kind === "all" ? "bg-white/15" : "hover:bg-white/10"}`}
            >
              <Layers3 size={15} />全部知识
            </button>
          </li>
          {loading && <li className="px-3 py-2 text-xs opacity-50">目录加载中…</li>}
          {error && <li className="px-3 py-2 text-xs text-rose-200">{error}</li>}
          {folders.map((folder) => <FolderBranch key={folder.id} folder={folder} selected={selected} onSelect={onSelect} />)}
          <li role="treeitem">
            <button
              type="button"
              onClick={() => onSelect({ kind: "unfiled", label: "未归档" })}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${selected.kind === "unfiled" ? "bg-white/15" : "hover:bg-white/10"}`}
            >
              <Folder size={15} />未归档
            </button>
          </li>
        </ul>
        <div className="mb-1 mt-5 px-3 text-[10px] font-semibold tracking-[0.18em] opacity-45">智能筛选</div>
        <ul className="space-y-0.5">
          {SMART_ITEMS.map(({ source, icon: Icon }) => (
            <li key={sourceKey(source)}>
              <button
                type="button"
                onClick={() => onSelect(source)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${sourceKey(selected) === sourceKey(source) ? "bg-white/15" : "hover:bg-white/10"}`}
              >
                <Icon size={15} />{source.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
