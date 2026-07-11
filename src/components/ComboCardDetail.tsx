import { ChevronDown, Clipboard, Download, Image as ImageIcon, Loader2, Plus, Save, Trash, Upload } from "lucide-react";
import type { ClipboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { ComboCardDetail as ComboDetail, ComboGeneration, ComboImage, ComboImageRole, ImageCard } from "../types";
import { authFetch } from "../lib/authClient";
import {
  createComboGeneration,
  deleteComboGeneration,
  loadComboCardDetail,
  updateComboGeneration,
  uploadComboImage,
} from "../lib/dbClient";
import OnDemandVideo from "./OnDemandVideo";

const roleLabels: Record<ComboImageRole, string> = {
  character: "人物",
  scene: "场景",
  story: "故事",
  other: "其他",
};

const roleOptions: Array<{ value: ComboImageRole; label: string }> = [
  { value: "character", label: "人物图" },
  { value: "scene", label: "场景图" },
  { value: "story", label: "故事图" },
  { value: "other", label: "其他角色" },
];

function RoleSelect({
  value,
  onChange,
  className = "",
}: {
  value: ComboImageRole;
  onChange: (value: ComboImageRole) => void;
  className?: string;
}) {
  return (
    <span className={`relative inline-flex min-w-[104px] ${className}`}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as ComboImageRole)}
        className="h-9 w-full appearance-none rounded-[6px] border border-stone-900/10 bg-[#fffaf0] py-0 pl-3 pr-9 text-xs font-bold text-stone-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] outline-none transition-colors hover:border-stone-900/18 focus:border-[#8b916f]/70 focus:bg-white dark:border-white/10 dark:bg-white/[0.07] dark:text-stone-100 dark:hover:border-white/18 dark:focus:border-amber-200/40"
      >
        {roleOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full bg-stone-900/[0.045] text-stone-500 dark:bg-white/[0.08] dark:text-stone-300">
        <ChevronDown size={13} strokeWidth={2.2} />
      </span>
    </span>
  );
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function sanitizeDownloadName(name: string) {
  return name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 120) || "combo-asset";
}

async function updateComboImageRole(params: { cardId: string; imageId: string; role: ComboImageRole; sortOrder: number }) {
  const res = await authFetch(`/api/db/cards/${encodeURIComponent(params.cardId)}/combo/images/${encodeURIComponent(params.imageId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: params.role, sortOrder: params.sortOrder }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `参考图角色更新失败：${res.statusText}`);
  return data as { image: ComboImage };
}

async function deleteComboImage(cardId: string, imageId: string) {
  const res = await authFetch(`/api/db/cards/${encodeURIComponent(cardId)}/combo/images/${encodeURIComponent(imageId)}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `参考图删除失败：${res.statusText}`);
}

export function ComboCardDetailView({
  card,
  onCardChanged,
}: {
  card: ImageCard;
  onCardChanged: (card: ImageCard) => void;
}) {
  const [detail, setDetail] = useState<ComboDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [role, setRole] = useState<ComboImageRole>("character");
  const [promptNote, setPromptNote] = useState("");
  const [dirtyGenerations, setDirtyGenerations] = useState<Record<string, boolean>>({});
  const [savingGenerationId, setSavingGenerationId] = useState("");
  const [generationSaveStatus, setGenerationSaveStatus] = useState<Record<string, "clean" | "dirty" | "saving" | "error">>({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  function shouldIgnorePasteTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    const tagName = target.tagName.toLowerCase();
    return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
  }

  async function uploadImageFiles(files: File[]) {
    if (files.length === 0) return;
    setSaving(true);
    setError("");
    try {
      const baseOrder = detail?.images.length || 0;
      for (let index = 0; index < files.length; index += 1) {
        await uploadComboImage({ cardId: card.id, file: files[index], role, sortOrder: baseOrder + index });
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "参考图上传失败");
    } finally {
      setSaving(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const next = await loadComboCardDetail(card.id);
      setDetail(next);
      onCardChanged(next.card);
      setDirtyGenerations({});
      setSavingGenerationId("");
      setGenerationSaveStatus({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "组合详情加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [card.id]);

  async function handleImages(files: FileList | null) {
    await uploadImageFiles(Array.from(files || []));
  }

  async function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    if (saving || shouldIgnorePasteTarget(event.target)) return;
    const pastedImages = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (pastedImages.length === 0) {
      setError("剪贴板中没有可上传图片。");
      return;
    }
    event.preventDefault();
    await uploadImageFiles(pastedImages);
  }

  async function handleRoleChange(image: ComboImage, nextRole: ComboImageRole) {
    setDetail((current) => current ? {
      ...current,
      images: current.images.map((item) => item.id === image.id ? { ...item, role: nextRole } : item),
    } : current);
    setError("");
    try {
      const result = await updateComboImageRole({ cardId: card.id, imageId: image.id, role: nextRole, sortOrder: image.sortOrder });
      setDetail((current) => current ? {
        ...current,
        images: current.images.map((item) => item.id === image.id ? result.image : item),
      } : current);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "参考图角色更新失败");
      await refresh();
    }
  }

  async function handleDeleteImage(image: ComboImage) {
    if (!window.confirm(`删除参考图「${image.originalName || roleLabels[image.role]}」？`)) return;
    setSaving(true);
    setError("");
    try {
      await deleteComboImage(card.id, image.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "参考图删除失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleVideo(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setSaving(true);
    setError("");
    try {
      await createComboGeneration({
        cardId: card.id,
        file,
        promptNote,
        sortOrder: detail?.generations.length || 0,
      });
      setPromptNote("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成记录保存失败");
    } finally {
      setSaving(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  async function saveGeneration(generation: ComboGeneration) {
    setSaving(true);
    setSavingGenerationId(generation.id);
    setGenerationSaveStatus((current) => ({ ...current, [generation.id]: "saving" }));
    setError("");
    try {
      const result = await updateComboGeneration({
        cardId: card.id,
        generationId: generation.id,
        promptNote: generation.promptNote,
        sortOrder: generation.sortOrder,
      });
      setDetail((current) => current ? {
        ...current,
        generations: current.generations.map((item) => item.id === generation.id ? result.generation : item),
      } : current);
      setDirtyGenerations((current) => ({ ...current, [generation.id]: false }));
      setGenerationSaveStatus((current) => ({ ...current, [generation.id]: "clean" }));
    } catch (err) {
      setGenerationSaveStatus((current) => ({ ...current, [generation.id]: "error" }));
      setError(err instanceof Error ? err.message : "生成记录更新失败");
    } finally {
      setSaving(false);
      setSavingGenerationId("");
    }
  }

  async function handleDeleteGeneration(generation: ComboGeneration) {
    if (!window.confirm("删除这条生成记录和对应视频？")) return;
    setSaving(true);
    setError("");
    try {
      await deleteComboGeneration(card.id, generation.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成记录删除失败");
    } finally {
      setSaving(false);
    }
  }

  async function downloadAsset(url: string, filename: string) {
    const response = await authFetch(url);
    if (!response.ok) {
      setError("下载失败，请稍后重试。");
      return;
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = sanitizeDownloadName(filename);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }

  const images = detail?.images || [];
  const generations = detail?.generations || [];

  return (
    <div
      ref={rootRef}
      className="custom-scrollbar flex h-full min-h-0 flex-col gap-5 overflow-y-auto bg-[#fbf7ed] p-4 text-stone-800 outline-none dark:bg-stone-950 dark:text-stone-100 md:p-5"
      onClick={(event) => {
        if (!shouldIgnorePasteTarget(event.target)) rootRef.current?.focus();
      }}
      onPaste={(event) => void handlePaste(event)}
      tabIndex={0}
    >
      <div className="flex flex-col gap-3 border-b border-dashed border-stone-900/15 pb-4 dark:border-white/10 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-stone-900 px-2.5 py-1 text-[10px] font-bold text-[#fbf7ed] dark:bg-amber-200 dark:text-stone-950">
            <ImageIcon size={12} />
            组合卡片
          </div>
          <h3 className="font-serif text-xl font-bold italic text-stone-950 dark:text-white">参考图与视频生成记录</h3>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            {images.length} 张参考图 / {generations.length} 条视频记录
          </p>
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-stone-400 dark:text-stone-500">
            <Clipboard size={11} />
            点击空白处后可直接粘贴图片，按当前角色入组。
          </p>
        </div>
        {loading || saving ? (
          <div className="inline-flex items-center gap-2 rounded-[6px] bg-white/65 px-3 py-2 text-xs font-semibold text-stone-600 dark:bg-white/[0.07] dark:text-stone-300">
            <Loader2 size={14} className="animate-spin" />
            {saving ? "保存中" : "加载中"}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-[6px] border border-red-900/15 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:border-red-300/20 dark:bg-red-500/10 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h4 className="font-serif text-sm font-bold italic text-stone-700 dark:text-stone-200">参考图片</h4>
          <div className="flex flex-wrap items-center gap-2">
            <RoleSelect
              value={role}
              onChange={setRole}
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-[6px] bg-stone-900 px-3 text-xs font-bold text-[#fbf7ed] transition-colors hover:bg-stone-800 disabled:cursor-wait disabled:opacity-60 dark:bg-amber-200 dark:text-stone-950"
            >
              <Upload size={13} />
              上传参考图
            </button>
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
            multiple
            hidden
            onChange={(event) => void handleImages(event.target.files)}
          />
        </div>

        {images.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {images.map((image) => (
              <div key={image.id} className="overflow-hidden rounded-[8px] border border-stone-900/10 bg-white/75 shadow-sm dark:border-white/10 dark:bg-white/[0.055]">
                <img src={image.imageUrl} alt={image.originalName} className="aspect-square w-full bg-stone-100 object-cover dark:bg-stone-900" loading="lazy" decoding="async" />
                <div className="space-y-2 p-2">
                  <RoleSelect
                    value={image.role}
                    onChange={(nextRole) => void handleRoleChange(image, nextRole)}
                    className="w-full"
                  />
                  <div>
                    <div className="truncate text-[11px] font-bold text-stone-800 dark:text-stone-100">{image.originalName || roleLabels[image.role]}</div>
                    <div className="mt-0.5 text-[10px] font-mono text-stone-500">{formatBytes(image.sizeBytes)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => void downloadAsset(image.originalImageUrl || image.imageUrl, image.originalName || `${image.id}.jpg`)}
                      className="grid h-7 place-items-center rounded-[6px] bg-stone-900/[0.06] text-stone-600 hover:bg-stone-900/[0.10] dark:bg-white/[0.08] dark:text-stone-300"
                      title="下载参考图"
                    >
                      <Download size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteImage(image)}
                      className="grid h-7 place-items-center rounded-[6px] bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-200"
                      title="删除参考图"
                    >
                      <Trash size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[8px] border border-dashed border-stone-900/15 bg-white/35 px-4 py-8 text-center text-xs text-stone-500 dark:border-white/12 dark:bg-white/[0.025] dark:text-stone-500">
            还没有参考图。上传人物、场景或故事参考图后，卡片封面会自动使用第一张人物图。
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h4 className="font-serif text-sm font-bold italic text-stone-700 dark:text-stone-200">生成记录</h4>
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            disabled={saving || !promptNote.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-[6px] bg-stone-900 px-3 text-xs font-bold text-[#fbf7ed] transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-amber-200 dark:text-stone-950"
          >
            <Plus size={13} />
            添加视频记录
          </button>
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
            hidden
            onChange={(event) => void handleVideo(event.target.files)}
          />
        </div>
        <textarea
          value={promptNote}
          onChange={(event) => setPromptNote(event.target.value)}
          placeholder="先写这一版视频的提示词或备注，再上传对应视频。"
          className="min-h-[96px] w-full resize-y rounded-[8px] border border-stone-900/10 bg-white/75 px-3 py-2.5 text-sm leading-relaxed text-stone-800 shadow-inner outline-none placeholder:text-stone-400 focus:border-stone-800/30 dark:border-white/10 dark:bg-white/[0.055] dark:text-stone-100 dark:placeholder:text-stone-600 dark:focus:border-amber-200/35"
        />

        {generations.length > 0 ? (
          <div className="space-y-3">
            {generations.map((generation) => (
              <div key={generation.id} className="rounded-[8px] border border-stone-900/10 bg-white/75 p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.055]">
                <OnDemandVideo
                  src={generation.videoUrl}
                  poster={generation.posterUrl || undefined}
                  label={`播放${generation.originalName || "视频记录"}`}
                  className="mb-3 aspect-video max-h-[360px] w-full rounded-[6px] bg-stone-950 object-contain"
                />
                <textarea
                  value={generation.promptNote}
                  onChange={(event) => {
                    const nextPrompt = event.target.value;
                    setDetail((current) => current ? {
                      ...current,
                      generations: current.generations.map((item) => item.id === generation.id ? { ...item, promptNote: nextPrompt } : item),
                    } : current);
                    setDirtyGenerations((current) => ({ ...current, [generation.id]: true }));
                    setGenerationSaveStatus((current) => ({ ...current, [generation.id]: "dirty" }));
                  }}
                  placeholder="这一条视频的提示词或备注"
                  className="min-h-[84px] w-full resize-y rounded-[6px] border border-stone-900/10 bg-[#fbf7ed] px-3 py-2 text-sm leading-relaxed text-stone-800 outline-none focus:border-stone-800/30 dark:border-white/10 dark:bg-stone-900 dark:text-stone-100"
                />
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-[10px] font-mono text-stone-500">
                    <div className="truncate">{generation.originalName || "视频记录"} · {formatBytes(generation.sizeBytes)}</div>
                    <div className={`mt-1 font-semibold ${
                      generationSaveStatus[generation.id] === "error"
                        ? "text-red-600 dark:text-red-300"
                        : dirtyGenerations[generation.id]
                          ? "text-amber-700 dark:text-amber-300"
                          : generationSaveStatus[generation.id] === "saving"
                            ? "text-[#6f7557] dark:text-amber-200"
                            : "text-stone-400 dark:text-stone-500"
                    }`}>
                      {generationSaveStatus[generation.id] === "saving"
                        ? "提示词保存中..."
                        : generationSaveStatus[generation.id] === "error"
                          ? "提示词保存失败"
                          : dirtyGenerations[generation.id]
                            ? "提示词未保存"
                            : "提示词已保存"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void downloadAsset(generation.videoUrl, generation.originalName || `${generation.id}.mp4`)}
                      className="inline-flex h-8 items-center gap-1 rounded-[6px] bg-stone-900/[0.06] px-2.5 text-xs font-semibold text-stone-600 hover:bg-stone-900/[0.10] dark:bg-white/[0.08] dark:text-stone-300"
                    >
                      <Download size={12} />
                      下载
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveGeneration(generation)}
                      disabled={saving || !dirtyGenerations[generation.id]}
                      className="inline-flex h-8 items-center gap-1 rounded-[6px] border border-[#8b916f]/25 bg-[#dfe5c9] px-2.5 text-xs font-bold text-stone-800 shadow-sm transition-colors hover:bg-[#d4dbbc] disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-200/20 dark:bg-amber-200 dark:text-stone-950"
                    >
                      {savingGenerationId === generation.id ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                      保存提示词
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteGeneration(generation)}
                      className="inline-flex h-8 items-center gap-1 rounded-[6px] bg-red-500/10 px-2.5 text-xs font-bold text-red-700 hover:bg-red-500/20 dark:text-red-200"
                    >
                      <Trash size={12} />
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[8px] border border-dashed border-stone-900/15 bg-white/35 px-4 py-8 text-center text-xs text-stone-500 dark:border-white/12 dark:bg-white/[0.025] dark:text-stone-500">
            暂无生成记录。每条记录会把一段提示词和一个视频绑定在一起。
          </div>
        )}
      </section>
    </div>
  );
}
