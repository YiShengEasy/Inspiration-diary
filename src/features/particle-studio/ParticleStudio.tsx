import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, ImagePlus, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { generateAiDepth } from "./aiDepth";
import { computeFastDepth, decodeImageFile, sampleParticleSource } from "./fastDepth";
import { ParticleControls } from "./ParticleControls";
import { ParticleViewport } from "./ParticleViewport";
import type { ParticleRenderer } from "./ParticleRenderer";
import { DEFAULT_PARTICLE_PARAMS, getQualityProfile, normalizeParams, PARTICLE_PRESETS } from "./presets";
import type { DepthMode, DepthProgress, ParticleParams, PresetId } from "./types";
import "./particle-studio.css";

type StudioStatus = "empty" | "decoding" | "fast-ready" | "ai-loading" | "ai-ready" | "error";
type Decoded = { rgba: Uint8ClampedArray; width: number; height: number };
const presetNames: Record<PresetId, string> = { portrait: "人像", landscape: "风景", neon: "霓虹", mono: "黑白", reference: "参考图" };

export default function ParticleStudio({ onBack }: { onBack: () => void }) {
  const [params, setParams] = useState<ParticleParams>({ ...DEFAULT_PARTICLE_PARAMS });
  const [mode, setMode] = useState<DepthMode>("fast");
  const [status, setStatus] = useState<StudioStatus>("empty");
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  const [aiDepth, setAiDepth] = useState<Float32Array | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<DepthProgress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [exporting, setExporting] = useState(false);
  const rendererRef = useRef<ParticleRenderer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useMemo(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px), (pointer: coarse)").matches, []);
  const profile = useMemo(() => getQualityProfile(isMobile, typeof devicePixelRatio === "number" ? devicePixelRatio : 1), [isMobile]);
  const computedFastDepth = useMemo(() => decoded ? computeFastDepth(decoded.rgba, decoded.width, decoded.height, params) : null,
    [decoded, params.edgeStrength, params.depthSmoothing, params.depthLayers]);
  const selectedDepth = mode === "ai" && aiDepth ? aiDepth : computedFastDepth;
  const source = useMemo(() => decoded && selectedDepth
    ? sampleParticleSource(decoded.rgba, selectedDepth, decoded.width, decoded.height, params, profile.maxParticles)
    : null, [decoded, selectedDepth, params.brightnessThreshold, params.contrast, params.alphaThreshold,
      params.saturation, params.density, profile.maxParticles]);
  const handleRendererReady = useCallback((renderer: ParticleRenderer | null) => { rendererRef.current = renderer; }, []);

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
    abortRef.current?.abort(); setStatus("decoding"); setNotice(null); setProgress(null); setAiDepth(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(nextFile)); setFile(nextFile);
    try {
      const image = await decodeImageFile(nextFile, isMobile ? 768 : 1280);
      setDecoded(image); setStatus("fast-ready");
      if (mode === "ai") void runAi(nextFile, image);
    } catch (error) { setStatus("error"); setNotice(error instanceof Error ? error.message : "图片解析失败"); }
  }, [isMobile, mode, params, previewUrl, runAi]);

  useEffect(() => () => { abortRef.current?.abort(); if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const switchMode = (next: DepthMode) => { setMode(next); if (next === "fast") { abortRef.current?.abort(); setStatus(decoded ? "fast-ready" : "empty"); } else if (file && decoded) void runAi(file, decoded); };
  const applyParams = (next: ParticleParams) => {
    setParams(normalizeParams(next));
  };
  const exportPng = async () => {
    if (!rendererRef.current || !source) return; setExporting(true); setNotice(null);
    try { const blob = await rendererRef.current.exportPng(2); const url = URL.createObjectURL(blob); const a = document.createElement("a"); const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13); a.href = url; a.download = `particle-3d-${stamp}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0); }
    catch (error) { setNotice(error instanceof Error ? error.message : "导出失败"); } finally { setExporting(false); }
  };

  return <main className="particle-studio">
    <ParticleViewport source={source} params={params} profile={profile} onRendererReady={handleRendererReady} onPerformanceMode={setReduced} className="particle-studio__viewport" />
    {!source && <div className="particle-studio__empty">{previewUrl && <img src={previewUrl} alt="待处理图片预览" />}<Sparkles size={34} /><h1>深度辉光粒子画廊</h1><p>上传一张图片，生成可拖拽旋转的立体粒子点云。</p><button type="button" onClick={() => fileInputRef.current?.click()}><ImagePlus size={17} />选择图片</button></div>}
    <div className="particle-studio__toolbar">
      <button type="button" onClick={onBack} title="返回"><ArrowLeft size={17} /></button>
      <button type="button" onClick={() => fileInputRef.current?.click()}><ImagePlus size={16} />{file ? "替换图片" : "上传图片"}</button>
      <input ref={fileInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const next = event.target.files?.[0]; if (next) void loadFile(next); event.target.value = ""; }} />
      <div className="particle-studio__modes" aria-label="深度模式"><button className={mode === "fast" ? "is-active" : ""} onClick={() => switchMode("fast")}>快速</button><button className={mode === "ai" ? "is-active" : ""} onClick={() => switchMode("ai")}>AI 精细</button></div>
      <button type="button" disabled={!source} onClick={() => rendererRef.current?.resetCamera()} title="复位视角"><RotateCcw size={16} /></button>
      <button type="button" disabled={!source || exporting} onClick={() => void exportPng()}><Download size={16} />{exporting ? "导出中" : "PNG"}</button>
    </div>
    <div className="particle-studio__presets">{(Object.keys(presetNames) as PresetId[]).map((id) => <button key={id} type="button" onClick={() => applyParams({ ...PARTICLE_PRESETS[id] })}>{presetNames[id]}</button>)}</div>
    {source && <div className="particle-studio__hint">拖拽旋转 · 滚轮缩放 · 双击复位</div>}
    {reduced && <div className="particle-studio__performance">性能保护已开启</div>}
    {(status === "decoding" || status === "ai-loading") && <div className="particle-studio__progress"><LoaderCircle className="is-spinning" size={22} /><span>{status === "decoding" ? "正在解析图片" : progress?.message}</span>{progress && <div><i style={{ width: `${Math.round(progress.progress * 100)}%` }} /></div>}</div>}
    {notice && <button type="button" className="particle-studio__notice" onClick={() => setNotice(null)}>{notice}<span>×</span></button>}
    <ParticleControls params={params} collapsed={collapsed} onChange={applyParams} onReset={() => applyParams({ ...DEFAULT_PARTICLE_PARAMS })} onToggleCollapsed={() => setCollapsed((value) => !value)} />
  </main>;
}
