import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Download, Film, ImagePlus, LoaderCircle, Pause, Play, RotateCcw,
  SlidersHorizontal, Sparkles, X,
} from "lucide-react";
import { generateAiDepth } from "./aiDepth";
import { decodeImageFile } from "./fastDepth";
import { ParticleControls } from "./ParticleControls";
import { ParticleExportAnimationDialog } from "./ParticleExportAnimationDialog";
import { ParticleViewport } from "./ParticleViewport";
import type { ParticleRenderer } from "./ParticleRenderer";
import {
  buildExportAnimationTracks,
  loadExportAnimationValues,
  saveExportAnimationValues,
  sanitizeExportAnimationValues,
  type PreviewPlaybackState,
  type SavedExportAnimationValue,
} from "./exportAnimation";
import {
  DEPTH_ANIMATION_STORAGE_KEY,
  DEPTH_EXPORT_ANIMATION_FIELDS,
  type DepthExportAnimationKey,
} from "./exportAnimationFields";
import { ParticleWorkerClient } from "./particleWorkerClient";
import { particleVideoFilename } from "./particleVideoExporter";
import { DEFAULT_PARTICLE_PARAMS, getQualityProfile, normalizeParams, PARTICLE_PRESETS } from "./presets";
import type { DepthMode, DepthProgress, ParticleParams, ParticleSource, PresetId } from "./types";
import "./particle-studio.css";

type StudioStatus = "empty" | "decoding" | "fast-ready" | "ai-loading" | "ai-ready" | "error";
type Decoded = { rgba: Uint8ClampedArray; width: number; height: number };
const presetNames: Record<PresetId, string> = {
  portrait: "人像柔边",
  dust: "灰尘消散",
  nebula: "星云扩张",
  linear: "线性扫除",
  fog: "雾化飘落",
  fire: "火焰涅槃",
};

interface DepthParticleStudioProps {
  onBack: () => void;
  file: File | null;
  onFileChange: (file: File) => void;
  onExportingChange: (exporting: boolean) => void;
}

export default function DepthParticleStudio({
  onBack,
  file,
  onFileChange,
  onExportingChange,
}: DepthParticleStudioProps) {
  const [params, setParams] = useState<ParticleParams>({ ...DEFAULT_PARTICLE_PARAMS });
  const [mode, setMode] = useState<DepthMode>("fast");
  const [status, setStatus] = useState<StudioStatus>("empty");
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  const [source, setSource] = useState<ParticleSource | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [aiDepth, setAiDepth] = useState<Float32Array | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<DepthProgress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [activePreset, setActivePreset] = useState<PresetId | null>(null);
  const [reduced, setReduced] = useState(false);
  const [exporting, setExporting] = useState<"png" | "mp4" | null>(null);
  const [showExportAnimation, setShowExportAnimation] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewPlaybackState>("idle");
  const [animationConfig, setAnimationConfig] = useState<SavedExportAnimationValue<DepthExportAnimationKey>[]>(() =>
    loadExportAnimationValues(DEPTH_ANIMATION_STORAGE_KEY, DEPTH_EXPORT_ANIMATION_FIELDS));
  const [exportProgress, setExportProgress] = useState({ completed: 0, total: 150 });
  const rendererRef = useRef<ParticleRenderer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerClientRef = useRef<ParticleWorkerClient | null>(null);
  const buildSequenceRef = useRef(0);
  const exportAbortRef = useRef<AbortController | null>(null);
  const loadedFileRef = useRef<File | null>(null);
  const isMobile = useMemo(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px), (pointer: coarse)").matches, []);
  const profile = useMemo(() => getQualityProfile(isMobile, typeof devicePixelRatio === "number" ? devicePixelRatio : 1), [isMobile]);
  const supportsTransparency = useMemo(() => decoded
    ? decoded.rgba.some((value, index) => index % 4 === 3 && value < 255)
    : false, [decoded]);
  const exportAnimationValues = useMemo(() => Object.fromEntries(
    DEPTH_EXPORT_ANIMATION_FIELDS.map((field) => [field.key, params[field.key]]),
  ) as Record<DepthExportAnimationKey, number>, [params]);
  const animationTracks = useMemo(() => buildExportAnimationTracks(
    exportAnimationValues,
    animationConfig,
  ), [animationConfig, exportAnimationValues]);
  const handleRendererReady = useCallback((renderer: ParticleRenderer | null) => { rendererRef.current = renderer; }, []);

  useEffect(() => onExportingChange(Boolean(exporting) || showExportAnimation), [exporting, onExportingChange, showExportAnimation]);

  useEffect(() => {
    const client = new ParticleWorkerClient();
    workerClientRef.current = client;
    return () => {
      exportAbortRef.current?.abort();
      workerClientRef.current = null;
      client.dispose();
    };
  }, []);

  useEffect(() => {
    const client = workerClientRef.current;
    if (!client || !decoded || (mode === "ai" && !aiDepth)) return;
    const sequence = ++buildSequenceRef.current;
    const delay = source ? 150 : 0;
    setRebuilding(true);
    const timer = window.setTimeout(() => {
      void client.buildSource({
        rgba: decoded.rgba,
        width: decoded.width,
        height: decoded.height,
        params,
        maxParticles: profile.maxParticles,
        depth: mode === "ai" ? aiDepth : null,
      }).then((nextSource) => {
        if (buildSequenceRef.current === sequence) setSource(nextSource);
      }).catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (buildSequenceRef.current === sequence) setNotice(error instanceof Error ? error.message : "粒子预处理失败");
      }).finally(() => {
        if (buildSequenceRef.current === sequence) setRebuilding(false);
      });
    }, delay);
    return () => {
      window.clearTimeout(timer);
      client.cancelPending();
    };
  }, [decoded, mode, aiDepth, profile.maxParticles, params.brightnessThreshold, params.contrast,
    params.edgeStrength, params.alphaThreshold, params.saturation,
    params.depthSmoothing, params.depthLayers]);

  const runAi = useCallback(async (imageFile: File, image: Decoded) => {
    abortRef.current?.abort();
    const controller = new AbortController(); abortRef.current = controller;
    setStatus("ai-loading"); setProgress({ stage: "loading", progress: 0, message: "正在准备 AI 深度模型" }); setNotice(null);
    try {
      const depth = await generateAiDepth(imageFile, image.width, image.height, setProgress, controller.signal);
      if (controller.signal.aborted) return;
      setAiDepth(depth); setStatus("ai-ready");
    } catch (error) {
      if (controller.signal.aborted) return;
      setMode("fast"); setStatus("fast-ready"); setNotice(error instanceof Error ? error.message : "AI 深度不可用，已回退快速模式");
    } finally { if (abortRef.current === controller) abortRef.current = null; }
  }, []);

  const loadFile = useCallback(async (nextFile: File) => {
    if (!nextFile.type.match(/^image\/(jpeg|png|webp)$/)) { setNotice("请选择 JPG、PNG 或 WebP 图片"); setStatus("error"); return; }
    abortRef.current?.abort(); rendererRef.current?.resetPreview(); setStatus("decoding"); setNotice(null); setProgress(null); setAiDepth(null); setSource(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    loadedFileRef.current = nextFile;
    setPreviewUrl(URL.createObjectURL(nextFile));
    if (nextFile !== file) onFileChange(nextFile);
    try {
      const image = await decodeImageFile(nextFile, isMobile ? 768 : 1280);
      setDecoded(image); setStatus("fast-ready");
      if (mode === "ai") void runAi(nextFile, image);
    } catch (error) { setStatus("error"); setNotice(error instanceof Error ? error.message : "图片解析失败"); }
  }, [file, isMobile, mode, onFileChange, previewUrl, runAi]);

  useEffect(() => {
    if (!file || loadedFileRef.current === file) return;
    void loadFile(file);
  }, [file, loadFile]);

  useEffect(() => {
    const fixture = new URLSearchParams(window.location.search).get("particleFixture");
    if (!fixture || file) return;
    void fetch(fixture)
      .then((response) => response.blob())
      .then((blob) => loadFile(new File([blob], "particle-fixture.jpg", { type: blob.type || "image/jpeg" })));
  }, [file, loadFile]);

  useEffect(() => () => { abortRef.current?.abort(); if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const switchMode = (next: DepthMode) => { setMode(next); if (next === "fast") { abortRef.current?.abort(); setStatus(decoded ? "fast-ready" : "empty"); } else if (file && decoded) void runAi(file, decoded); };
  const applyParams = (next: ParticleParams) => {
    setActivePreset(null);
    setParams(normalizeParams(next));
  };
  const applyPreset = (id: PresetId) => {
    setActivePreset(id);
    setParams(normalizeParams({ ...PARTICLE_PRESETS[id] }));
  };
  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const exportPng = async () => {
    if (!rendererRef.current || !source) return; setExporting("png"); setNotice(null);
    try { const blob = await rendererRef.current.exportPng(2); const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13); downloadBlob(blob, `particle-3d-${stamp}.png`); }
    catch (error) { setNotice(error instanceof Error ? error.message : "导出失败"); } finally { setExporting(null); }
  };
  const exportMp4 = async () => {
    if (!rendererRef.current || !source) return;
    rendererRef.current.resetPreview();
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExporting("mp4"); setExportProgress({ completed: 0, total: 150 }); setNotice(null);
    try {
      const blob = await rendererRef.current.exportMp4({
        signal: controller.signal,
        onProgress: (completed, total) => setExportProgress({ completed, total }),
        animationTracks,
      });
      downloadBlob(blob, particleVideoFilename());
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setNotice(error instanceof Error ? error.message : "MP4 导出失败");
      }
    } finally {
      if (exportAbortRef.current === controller) exportAbortRef.current = null;
      setExporting(null);
    }
  };
  const togglePreview = () => {
    const renderer = rendererRef.current;
    if (!renderer || !source) return;
    if (previewState === "playing") renderer.pausePreview();
    else if (previewState === "paused") renderer.resumePreview();
    else renderer.startPreview(animationTracks);
  };
  const saveAnimationConfig = (next: SavedExportAnimationValue<DepthExportAnimationKey>[]) => {
    const safe = sanitizeExportAnimationValues(DEPTH_EXPORT_ANIMATION_FIELDS, next);
    rendererRef.current?.resetPreview();
    setAnimationConfig(safe);
    saveExportAnimationValues(DEPTH_ANIMATION_STORAGE_KEY, safe);
    setShowExportAnimation(false);
  };

  return <main className="particle-studio">
    <ParticleViewport source={source} params={params} profile={profile} onRendererReady={handleRendererReady}
      onPerformanceMode={setReduced} onPreviewStateChange={setPreviewState} className="particle-studio__viewport" />
    {!source && <div className="particle-studio__empty">{previewUrl && <img src={previewUrl} alt="待处理图片预览" />}<Sparkles size={34} /><h1>深度辉光粒子画廊</h1><p>上传一张图片，生成可拖拽旋转的立体粒子点云。</p><button type="button" onClick={() => fileInputRef.current?.click()}><ImagePlus size={17} />选择图片</button></div>}
    <div className="particle-studio__toolbar">
      <button type="button" onClick={onBack} title="返回"><ArrowLeft size={17} /></button>
      <button type="button" disabled={!!exporting} onClick={() => fileInputRef.current?.click()}><ImagePlus size={16} />{file ? "替换图片" : "上传图片"}</button>
      <input ref={fileInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const next = event.target.files?.[0]; if (next) void loadFile(next); event.target.value = ""; }} />
      <div className="particle-studio__modes" aria-label="深度模式"><button disabled={!!exporting} className={mode === "fast" ? "is-active" : ""} onClick={() => switchMode("fast")}>快速</button><button disabled={!!exporting} className={mode === "ai" ? "is-active" : ""} onClick={() => switchMode("ai")}>AI 精细</button></div>
      <button type="button" disabled={!source || !!exporting} onClick={() => rendererRef.current?.resetCamera()} title="复位视角"><RotateCcw size={16} /></button>
      <button type="button" disabled={!source || !!exporting} onClick={() => setShowExportAnimation(true)}><SlidersHorizontal size={16} />动画设置</button>
      <button type="button" disabled={!source || !!exporting} onClick={togglePreview}>
        {previewState === "playing" ? <Pause size={15} /> : <Play size={15} />}{previewState === "playing" ? "暂停" : previewState === "paused" ? "继续" : "播放"}
      </button>
      <button type="button" disabled={!source || !!exporting || previewState === "idle"} onClick={() => rendererRef.current?.resetPreview()}>从头开始</button>
      <button type="button" disabled={!source || !!exporting || rebuilding} onClick={() => void exportPng()}><Download size={16} />{exporting === "png" ? "导出中" : "PNG"}</button>
      <button type="button" disabled={!source || !!exporting || rebuilding} onClick={() => void exportMp4()}><Film size={16} />MP4</button>
    </div>
    <div className="particle-studio__presets">{(Object.keys(presetNames) as PresetId[]).map((id) => <button key={id} type="button" disabled={!!exporting} className={activePreset === id ? "is-active" : ""} aria-pressed={activePreset === id} onClick={() => applyPreset(id)}>{presetNames[id]}</button>)}</div>
    {source && <div className="particle-studio__hint">拖拽旋转 · 滚轮缩放 · 双击复位</div>}
    {rebuilding && source && <div className="particle-studio__rebuilding">正在重建粒子…</div>}
    {reduced && <div className="particle-studio__performance">性能保护已开启</div>}
    {(status === "decoding" || status === "ai-loading") && <div className="particle-studio__progress"><LoaderCircle className="is-spinning" size={22} /><span>{status === "decoding" ? "正在解析图片" : progress?.message}</span>{progress && <div><i style={{ width: `${Math.round(progress.progress * 100)}%` }} /></div>}</div>}
    {exporting === "mp4" && <div className="particle-studio__progress particle-studio__export-progress"><LoaderCircle className="is-spinning" size={22} /><strong>正在生成 1080p MP4</strong><span>已渲染 {exportProgress.completed} / {exportProgress.total}</span><div><i style={{ width: `${Math.round(exportProgress.completed / exportProgress.total * 100)}%` }} /></div><button type="button" onClick={() => exportAbortRef.current?.abort()}><X size={14} />取消</button></div>}
    {notice && <button type="button" className="particle-studio__notice" onClick={() => setNotice(null)}>{notice}<span>×</span></button>}
    {showExportAnimation && <ParticleExportAnimationDialog
      fields={DEPTH_EXPORT_ANIMATION_FIELDS}
      values={exportAnimationValues}
      config={animationConfig}
      onCancel={() => setShowExportAnimation(false)}
      onConfirm={saveAnimationConfig}
    />}
    <ParticleControls params={params} collapsed={collapsed} supportsTransparency={supportsTransparency} disabled={!!exporting} onChange={applyParams} onReset={() => applyParams({ ...DEFAULT_PARTICLE_PARAMS })} onToggleCollapsed={() => setCollapsed((value) => !value)} />
  </main>;
}
