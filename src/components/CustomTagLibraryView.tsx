import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Edit3, Library, Loader2, Plus, Search, Tags, Trash, X } from "lucide-react";
import type { CustomTagGroup } from "../types";
import { createCustomTagGroup, flattenCustomTagGroups, normalizeCustomTagGroups, normalizeTagTerm, parseTagInput } from "../lib/customTagLibrary";

interface CustomTagLibraryViewProps {
  groups: CustomTagGroup[];
  libraryEnabled: boolean;
  syncStatus: "clean" | "saving" | "error";
  onSave: (groups: CustomTagGroup[]) => Promise<void>;
  onLibraryEnabledChange: (enabled: boolean) => void;
}

export default function CustomTagLibraryView({ groups, libraryEnabled, syncStatus, onSave, onLibraryEnabledChange }: CustomTagLibraryViewProps) {
  const [draftGroups, setDraftGroups] = useState<CustomTagGroup[]>(() => normalizeCustomTagGroups(groups));
  const [selectedGroupId, setSelectedGroupId] = useState<string>(draftGroups[0]?.id || "");
  const [query, setQuery] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newTermText, setNewTermText] = useState("");
  const [groupToDelete, setGroupToDelete] = useState<CustomTagGroup | null>(null);

  useEffect(() => {
    const normalized = normalizeCustomTagGroups(groups);
    setDraftGroups(normalized);
    setSelectedGroupId((current) => {
      if (current && normalized.some((group) => group.id === current)) return current;
      return normalized[0]?.id || "";
    });
  }, [groups]);

  const selectedGroup = draftGroups.find((group) => group.id === selectedGroupId) || draftGroups[0] || null;
  const allTerms = useMemo(() => flattenCustomTagGroups(draftGroups), [draftGroups]);
  const enabledTerms = useMemo(() => flattenCustomTagGroups(draftGroups.filter((group) => group.enabled !== false)), [draftGroups]);
  const effectiveTermCount = libraryEnabled ? enabledTerms.length : 0;
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return draftGroups;
    return draftGroups.filter((group) => {
      return group.name.toLowerCase().includes(q)
        || group.terms.some((term) => term.toLowerCase().includes(q));
    });
  }, [draftGroups, query]);

  const commitGroups = async (nextGroups: CustomTagGroup[]) => {
    const normalized = normalizeCustomTagGroups(nextGroups);
    setDraftGroups(normalized);
    if (!normalized.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(normalized[0]?.id || "");
    }
    await onSave(normalized);
  };

  const handleCreateGroup = async () => {
    const name = normalizeTagTerm(newGroupName) || "新标签组";
    const nextGroup = createCustomTagGroup(name);
    setNewGroupName("");
    setSelectedGroupId(nextGroup.id);
    await commitGroups([...draftGroups, nextGroup]);
  };

  const handleRenameGroup = async (groupId: string, name: string) => {
    const nextName = normalizeTagTerm(name);
    if (!nextName) return;
    await commitGroups(draftGroups.map((group) =>
      group.id === groupId ? { ...group, name: nextName, updatedAt: Date.now() } : group,
    ));
  };

  const handleDeleteGroup = async (groupId: string) => {
    const group = draftGroups.find((item) => item.id === groupId);
    if (!group) return;
    setGroupToDelete(group);
  };

  const confirmDeleteGroup = async () => {
    if (!groupToDelete) return;
    const deleteId = groupToDelete.id;
    setGroupToDelete(null);
    await commitGroups(draftGroups.filter((item) => item.id !== deleteId));
  };

  const handleToggleGroupEnabled = async (groupId: string, enabled: boolean) => {
    await commitGroups(draftGroups.map((group) =>
      group.id === groupId ? { ...group, enabled, updatedAt: Date.now() } : group,
    ));
  };

  const handleAddTerms = async () => {
    if (!selectedGroup) return;
    const nextTerms = parseTagInput(newTermText);
    if (nextTerms.length === 0) return;

    const existing = new Set(selectedGroup.terms.map((term) => term.toLowerCase()));
    const mergedTerms = [
      ...selectedGroup.terms,
      ...nextTerms.filter((term) => {
        const key = term.toLowerCase();
        if (existing.has(key)) return false;
        existing.add(key);
        return true;
      }),
    ];

    setNewTermText("");
    await commitGroups(draftGroups.map((group) =>
      group.id === selectedGroup.id ? { ...group, terms: mergedTerms, updatedAt: Date.now() } : group,
    ));
  };

  const handleDeleteTerm = async (term: string) => {
    if (!selectedGroup) return;
    await commitGroups(draftGroups.map((group) =>
      group.id === selectedGroup.id
        ? { ...group, terms: group.terms.filter((item) => item !== term), updatedAt: Date.now() }
        : group,
    ));
  };

  const visibleTerms = selectedGroup
    ? selectedGroup.terms.filter((term) => !query.trim() || term.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  return (
    <>
    <motion.section
      key="custom-tag-library-view"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.22 }}
      className="relative mt-4 mb-8 overflow-hidden rounded-[8px] border border-stone-900/10 bg-[#fbf7ed] text-stone-900 shadow-[0_26px_70px_rgba(68,64,60,0.16)] dark:border-white/10 dark:bg-stone-950/70 dark:text-stone-100"
    >
      <div className="relative border-b border-stone-900/10 bg-white/35 px-4 py-5 dark:border-white/10 dark:bg-transparent md:px-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-stone-900/10 bg-white/50 px-3 py-1 text-[11px] font-semibold text-stone-700 shadow-sm dark:border-amber-200/20 dark:bg-amber-200/10 dark:text-amber-100">
              <Tags size={13} />
              Custom Tag Library
            </div>
            <h2 className="font-serif text-2xl font-bold italic tracking-normal text-stone-950 md:text-3xl dark:text-white">自定义标签库</h2>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-stone-600 dark:text-stone-400">
              维护你自己的设计词、材质词、风格词和情绪词。后续图片与 Markdown 识别会优先参考这些词，但不会强行套用无关标签。
            </p>
          </div>
          <div className="flex min-w-[220px] flex-col gap-2 rounded-[8px] border border-stone-900/10 bg-white/55 px-3 py-2 text-xs font-semibold text-stone-600 dark:border-white/10 dark:bg-white/[0.06] dark:text-stone-300">
            <button
              type="button"
              onClick={() => onLibraryEnabledChange(!libraryEnabled)}
              className={`flex h-10 items-center justify-between gap-3 rounded-[7px] border px-3 text-left font-bold shadow-sm transition-all active:scale-[0.98] ${
                libraryEnabled
                  ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-200/30 dark:bg-amber-200/10 dark:text-amber-100 dark:hover:bg-amber-200/15"
                  : "border-stone-900/10 bg-stone-200 text-stone-600 dark:border-white/10 dark:bg-stone-800 dark:text-stone-300"
              }`}
              aria-pressed={libraryEnabled}
              title={libraryEnabled ? "关闭标签库参与 AI 识别" : "开启标签库参与 AI 识别"}
            >
              <span className="inline-flex items-center gap-2">
                {syncStatus === "saving" ? <Loader2 size={14} className="animate-spin" /> : <span className={`h-2.5 w-2.5 rounded-full ${libraryEnabled ? "bg-emerald-500" : "bg-stone-400"}`} />}
                {libraryEnabled ? "启用中" : "已关闭"}
              </span>
              <Library size={14} />
            </button>
            <div className="font-mono text-[10px] text-stone-500 dark:text-stone-500">
              {effectiveTermCount} / {allTerms.length} 个词参与识别
            </div>
          </div>
        </div>
      </div>

      <div className="relative grid min-h-[560px] lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="border-b border-stone-900/10 bg-white/25 p-4 dark:border-white/10 dark:bg-black/20 lg:border-b-0 lg:border-r">
          <div className="mb-3">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标签或分组"
                className="h-9 w-full rounded-[6px] border border-stone-900/10 bg-white/60 pl-9 pr-8 text-sm text-stone-900 outline-none placeholder:text-stone-500 focus:border-stone-800/30 dark:border-white/10 dark:bg-white/[0.06] dark:text-stone-100 dark:placeholder:text-stone-600"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-stone-500 hover:bg-stone-900/10 hover:text-stone-900 dark:hover:bg-white/10 dark:hover:text-stone-200"
                  title="清除搜索"
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
          </div>

          <div className="mb-4 flex gap-2">
            <input
              type="text"
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              placeholder="新分组"
              className="h-9 min-w-0 flex-1 rounded-[6px] border border-stone-900/10 bg-white/60 px-3 text-sm text-stone-900 outline-none placeholder:text-stone-500 dark:border-white/10 dark:bg-white/[0.06] dark:text-stone-100"
            />
            <button
              type="button"
              onClick={handleCreateGroup}
              className="grid h-9 w-9 place-items-center rounded-[6px] border border-amber-300 bg-amber-50 text-amber-800 transition-all hover:bg-amber-100 dark:border-amber-200/30 dark:bg-amber-200/10 dark:text-amber-100"
              title="新建标签组"
            >
              <Plus size={14} />
            </button>
          </div>

          <div className="space-y-2">
            {filteredGroups.map((group) => (
              <div
                key={group.id}
                className={`flex w-full items-center gap-2 rounded-[8px] border p-2 transition-all ${
                  selectedGroup?.id === group.id
                    ? group.enabled !== false
                      ? "border-stone-900/25 bg-white/80 shadow-[0_14px_32px_rgba(68,64,60,0.12)] dark:border-amber-200/45 dark:bg-amber-200/12"
                      : "border-stone-900/10 bg-stone-200/65 opacity-80 dark:border-white/10 dark:bg-white/[0.04]"
                    : group.enabled !== false
                      ? "border-stone-900/8 bg-white/35 hover:border-stone-900/16 hover:bg-white/55 dark:border-white/8 dark:bg-white/[0.04]"
                      : "border-stone-900/5 bg-stone-200/45 opacity-70 hover:opacity-90 dark:border-white/5 dark:bg-white/[0.025]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedGroupId(group.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-bold text-stone-900 dark:text-stone-100">{group.name}</div>
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${group.enabled !== false ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200" : "bg-stone-300 text-stone-600 dark:bg-white/10 dark:text-stone-500"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${group.enabled !== false ? "bg-emerald-500" : "bg-stone-500"}`} />
                        {group.enabled !== false ? "启用" : "关闭"}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] font-mono text-stone-600 dark:text-stone-500">{group.terms.length} 个词</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleGroupEnabled(group.id, group.enabled === false)}
                  className={`inline-flex h-8 shrink-0 items-center justify-center rounded-[6px] border px-2.5 text-[11px] font-bold transition-all active:scale-95 ${
                    group.enabled !== false
                      ? "border-amber-300 bg-amber-50 text-amber-800 shadow-sm hover:bg-amber-100 dark:border-amber-200/30 dark:bg-amber-200/10 dark:text-amber-100"
                      : "border-stone-900/10 bg-stone-200 text-stone-600 hover:bg-stone-300 dark:border-white/10 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
                  }`}
                  title={group.enabled !== false ? "关闭这个标签组" : "启用这个标签组"}
                  aria-label={group.enabled !== false ? `关闭标签组 ${group.name}` : `启用标签组 ${group.name}`}
                  aria-pressed={group.enabled !== false}
                >
                  {group.enabled !== false ? "启用中" : "已关闭"}
                </button>
              </div>
            ))}
          </div>

          {draftGroups.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-stone-900/15 px-4 py-10 text-center text-sm text-stone-500 dark:border-white/12">
              先新建一个标签组。
            </div>
          ) : null}
        </aside>

        <main className="flex min-w-0 flex-col p-4 md:p-6">
          {selectedGroup ? (
            <>
              <div className="mb-5 flex flex-col gap-3 border-b border-stone-900/10 pb-4 dark:border-white/10 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <input
                    type="text"
                    value={selectedGroup.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      setDraftGroups((current) => current.map((group) =>
                        group.id === selectedGroup.id ? { ...group, name } : group,
                      ));
                    }}
                    onBlur={(event) => void handleRenameGroup(selectedGroup.id, event.target.value)}
                    className="w-full max-w-xl rounded-[6px] border border-transparent bg-transparent px-0 py-1 font-serif text-xl font-bold italic text-stone-950 outline-none focus:border-stone-900/10 focus:bg-white/60 dark:text-white dark:focus:border-white/10 dark:focus:bg-white/[0.05]"
                    aria-label="标签组名称"
                  />
                  <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    支持一次粘贴多个词，用逗号、顿号、分号或换行分隔。当前分组{selectedGroup.enabled !== false ? "会" : "不会"}参与 AI 识别。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleToggleGroupEnabled(selectedGroup.id, selectedGroup.enabled === false)}
                    className={`inline-flex h-9 items-center justify-center gap-2 rounded-[6px] border px-3 text-xs font-bold shadow-sm transition-all active:scale-95 ${
                      selectedGroup.enabled !== false
                        ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-200/30 dark:bg-amber-200/10 dark:text-amber-100"
                        : "border-stone-900/10 bg-stone-200 text-stone-600 hover:bg-stone-300 dark:border-white/10 dark:bg-stone-800 dark:text-stone-300"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${selectedGroup.enabled !== false ? "bg-emerald-500" : "bg-stone-500"}`} />
                    {selectedGroup.enabled !== false ? "启用中" : "已关闭"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteGroup(selectedGroup.id)}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-[6px] border border-red-900/15 bg-red-50 px-3 text-xs font-bold text-red-700 transition-colors hover:bg-red-100 dark:border-red-300/20 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20"
                  >
                    <Trash size={13} />
                    删除组
                  </button>
                </div>
              </div>

              <div className="mb-4 flex flex-col gap-2 sm:flex-row">
                <textarea
                  value={newTermText}
                  onChange={(event) => setNewTermText(event.target.value)}
                  placeholder="例如：侘寂、液态金属、包豪斯、松弛感、低饱和灰绿"
                  className="min-h-[72px] flex-1 resize-none rounded-[8px] border border-stone-900/10 bg-white/60 px-3 py-2 text-sm text-stone-900 outline-none placeholder:text-stone-500 focus:border-stone-800/30 dark:border-white/10 dark:bg-white/[0.06] dark:text-stone-100 dark:placeholder:text-stone-600"
                />
                <button
                  type="button"
                  onClick={handleAddTerms}
                  className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-[6px] border border-amber-300 bg-amber-50 px-4 text-sm font-bold text-amber-800 transition-all hover:bg-amber-100 dark:border-amber-200/30 dark:bg-amber-200/10 dark:text-amber-100 dark:hover:bg-amber-200/15 sm:w-32"
                >
                  <Plus size={14} />
                  添加
                </button>
              </div>

              <AnimatePresence initial={false}>
                {syncStatus === "error" ? (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="mb-4 rounded-[6px] border border-red-900/15 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-300/20 dark:bg-red-500/10 dark:text-red-200"
                  >
                    标签库保存失败，请稍后重试。
                  </motion.div>
                ) : syncStatus === "saving" ? (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="mb-4 inline-flex items-center gap-2 rounded-[6px] border border-amber-900/15 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:border-amber-300/20 dark:bg-amber-500/10 dark:text-amber-100"
                  >
                    <Loader2 size={13} className="animate-spin" />
                    正在保存标签库
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {visibleTerms.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {visibleTerms.map((term) => (
                    <span
                      key={term}
                      className="group/tag inline-flex min-h-8 items-center gap-1.5 rounded-full border border-stone-900/10 bg-white/65 px-3 py-1 text-sm font-semibold text-stone-700 shadow-sm dark:border-white/10 dark:bg-white/[0.06] dark:text-stone-200"
                    >
                      <span># {term}</span>
                      <button
                        type="button"
                        onClick={() => void handleDeleteTerm(term)}
                        className="grid h-5 w-5 place-items-center rounded-full text-stone-400 opacity-70 transition-all hover:bg-red-500/10 hover:text-red-600 group-hover/tag:opacity-100"
                        title="删除标签词"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center rounded-[8px] border border-dashed border-stone-900/15 bg-white/20 px-4 py-20 text-center dark:border-white/12 dark:bg-transparent">
                  <Tags size={34} className="mb-3 text-stone-500/45 dark:text-amber-200/35" />
                  <p className="font-serif text-sm italic text-stone-500 dark:text-stone-400">这个分组还没有标签词。</p>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center py-20 text-center text-stone-500">
              <Edit3 size={36} className="mb-3 text-stone-500/40 dark:text-amber-200/30" />
              <p className="font-serif text-sm italic">新建一个标签组，开始维护模型可参考的词库。</p>
            </div>
          )}
        </main>
      </div>
    </motion.section>
    <AnimatePresence>
      {groupToDelete ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setGroupToDelete(null)}
            className="absolute inset-0 bg-stone-900/45 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            className="relative z-10 w-full max-w-sm rounded-2xl border border-stone-200 bg-stone-100 p-6 text-center shadow-xl dark:border-stone-800 dark:bg-stone-900"
          >
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-200">
              <Trash size={24} />
            </div>
            <h3 className="text-xl font-bold text-stone-800 dark:text-stone-100">删除标签组？</h3>
            <p className="mt-2 text-sm leading-relaxed text-stone-500 dark:text-stone-400">
              「{groupToDelete.name}」中的 {groupToDelete.terms.length} 个标签词也会一并移除。
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setGroupToDelete(null)}
                className="flex-1 rounded-xl bg-stone-200 py-2.5 font-medium text-stone-600 transition hover:bg-stone-300 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteGroup()}
                className="flex-1 rounded-xl bg-red-500 py-2.5 font-medium text-white transition hover:bg-red-600"
              >
                删除
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
    </>
  );
}
