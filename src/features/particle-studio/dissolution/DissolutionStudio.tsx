import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  Film,
  ImagePlus,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { particleVideoFilename } from "../particleVideoExporter";
import { ParticleExportAnimationDialog } from "../ParticleExportAnimationDialog";
import {
  buildExportAnimationTracks,
  loadExportAnimationValues,
  saveExportAnimationValues,
  sanitizeExportAnimationValues,
  type PreviewPlaybackState,
  type SavedExportAnimationValue,
} from "../exportAnimation";
import {
  DISSOLUTION_ANIMATION_STORAGE_KEY,
  DISSOLUTION_EXPORT_ANIMATION_FIELDS,
  type DissolutionExportAnimationKey,
} from "../exportAnimationFields";
import { DissolutionRenderer } from "./DissolutionRenderer";
import {
  DEFAULT_DISSOLUTION_PARAMS,
  DISSOLUTION_PRESETS,
  normalizeDissolutionParams,
} from "./presets";
import type { DissolutionParams, DissolutionPresetId } from "./types";
import "./dissolution-studio.css";

interface DissolutionStudioProps {
  onBack: () => void;
  file: File | null;
  onFileChange: (file: File) => void;
  onExportingChange: (exporting: boolean) => void;
}

type NumericParam = Exclude<keyof DissolutionParams, "mode" | "effect">;
type SliderConfig = {
  key: NumericParam;
  label: string;
  min: number;
  max: number;
  step: number;
  particleOnly?: boolean;
};

const sliders: SliderConfig[] = [
  { key: "invasion", label: "侵蚀进度", min: 0, max: 1, step: 0.01 },
  { key: "bandwidth", label: "过渡带宽度", min: 0.02, max: 0.7, step: 0.01 },
  { key: "scatter", label: "粒子散开量", min: 0, max: 0.12, step: 0.001, particleOnly: true },
  { key: "pointSize", label: "粒子大小", min: 0.5, max: 8, step: 0.5, particleOnly: true },
  { key: "sampleStep", label: "采样间距 (px)", min: 1, max: 8, step: 1, particleOnly: true },
  { key: "noise", label: "边界噪波", min: 0, max: 0.8, step: 0.01 },
  { key: "waveStrength", label: "水波强度", min: 0, max: 0.03, step: 0.001 },
  { key: "waveFrequency", label: "水波频率", min: 1, max: 40, step: 1 },
];

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

export default function DissolutionStudio({
  onBack,
  file,
  onFileChange,
  onExportingChange,
}: DissolutionStudioProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<DissolutionRenderer | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const loadedFileRef = useRef<File | null>(null);
  const [params, setParams] = useState<DissolutionParams>({ ...DEFAULT_DISSOLUTION_PARAMS });
  const [activePreset, setActivePreset] = useState<DissolutionPresetId | null>("dust");
  const [rendererReady, setRendererReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewPlaybackState>("idle");
  const [particleCount, setParticleCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [exporting, setExporting] = useState<"png" | "mp4" | null>(null);
  const [showExportAnimation, setShowExportAnimation] = useState(false);
  const [animationConfig, setAnimationConfig] = useState<SavedExportAnimationValue<DissolutionExportAnimationKey>[]>(() =>
    loadExportAnimationValues(DISSOLUTION_ANIMATION_STORAGE_KEY, DISSOLUTION_EXPORT_ANIMATION_FIELDS));
  const [exportProgress, setExportProgress] = useState({ completed: 0, total: 150 });

  useEffect(() => onExportingChange(Boolean(exporting) || showExportAnimation), [exporting, onExportingChange, showExportAnimation]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const renderer = new DissolutionRenderer(container, params, {
      onParticleCountChange: setParticleCount,
      onPreviewStateChange: setPreviewState,
    });
    rendererRef.current = renderer;
    setRendererReady(true);
    const handleVisibility = () => document.hidden ? renderer.pause() : renderer.resume();
    document.addEventListener("visibilitychange", handleVisibility);
    handleVisibility();
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      exportAbortRef.current?.abort();
      renderer.dispose();
      rendererRef.current = null;
      onExportingChange(false);
    };
  }, [onExportingChange]);

  useEffect(() => {
    rendererRef.current?.setParams(params);
  }, [params]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !rendererReady || !file || loadedFileRef.current === file) return;
    loadedFileRef.current = file;
    renderer.resetPreview();
    setLoading(true);
    setNotice(null);
    void renderer.setFile(file)
      .catch((error) => {
        loadedFileRef.current = null;
        setNotice(error instanceof Error ? error.message : "图片解析失败");
      })
      .finally(() => setLoading(false));
  }, [file, rendererReady]);

  const applyPreset = (id: DissolutionPresetId): void => {
    const next = normalizeDissolutionParams({ ...DISSOLUTION_PRESETS[id] });
    setActivePreset(id);
    rendererRef.current?.resetPreview();
    setParams(next);
  };

  const updateParam = (key: NumericParam, value: number): void => {
    setActivePreset(null);
    setParams((current) => normalizeDissolutionParams({ ...current, [key]: value }));
  };

  const togglePreview = (): void => {
    const renderer = rendererRef.current;
    if (!renderer || !file) return;
    if (previewState === "playing") renderer.pausePreview();
    else if (previewState === "paused") renderer.resumePreview();
    else renderer.startPreview(animationTracks);
  };

  const resetProgress = (): void => {
    rendererRef.current?.resetPreview();
  };

  const exportPng = async (): Promise<void> => {
    if (!rendererRef.current || !file) return;
    setExporting("png");
    setNotice(null);
    try {
      const blob = await rendererRef.current.exportPng();
      const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      downloadBlob(blob, `particle-dissolution-${stamp}.png`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "PNG 导出失败");
    } finally {
      setExporting(null);
    }
  };

  const exportMp4 = async (): Promise<void> => {
    if (!rendererRef.current || !file) return;
    rendererRef.current.resetPreview();
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExporting("mp4");
    setExportProgress({ completed: 0, total: 150 });
    setNotice(null);
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

  const fire = params.effect === 1;
  const visibleSliders = sliders.filter((slider) => !fire || !slider.particleOnly);
  const exportAnimationValues = useMemo(() => Object.fromEntries(
    DISSOLUTION_EXPORT_ANIMATION_FIELDS.map((field) => [field.key, params[field.key]]),
  ) as Record<DissolutionExportAnimationKey, number>, [params]);
  const animationTracks = useMemo(() => buildExportAnimationTracks(
    exportAnimationValues,
    animationConfig,
  ), [animationConfig, exportAnimationValues]);
  const saveAnimationConfig = (next: SavedExportAnimationValue<DissolutionExportAnimationKey>[]): void => {
    const safe = sanitizeExportAnimationValues(DISSOLUTION_EXPORT_ANIMATION_FIELDS, next);
    rendererRef.current?.resetPreview();
    setAnimationConfig(safe);
    saveExportAnimationValues(DISSOLUTION_ANIMATION_STORAGE_KEY, safe);
    setShowExportAnimation(false);
  };

  return <main className="dissolution-studio">
    <div ref={containerRef} className="dissolution-studio__viewport" aria-label="粒子溶解画布" />
    {!file && <div className="dissolution-studio__empty">
      <Sparkles size={34} />
      <h1>像素粒子溶解</h1>
      <p>使用独立 Demo 引擎，让原图在水波与噪声侵蚀中转化为粒子。</p>
      <button type="button" onClick={() => inputRef.current?.click()}><ImagePlus size={17} />选择图片</button>
    </div>}

    <div className="dissolution-studio__toolbar">
      <button type="button" title="返回" onClick={onBack}><ArrowLeft size={17} /></button>
      <button type="button" disabled={Boolean(exporting)} onClick={() => inputRef.current?.click()}>
        <ImagePlus size={16} />{file ? "替换图片" : "上传图片"}
      </button>
      <input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const next = event.target.files?.[0];
          if (next) {
            if (/^image\/(jpeg|png|webp)$/.test(next.type)) onFileChange(next);
            else setNotice("请选择 JPG、PNG 或 WebP 图片");
          }
          event.target.value = "";
        }} />
      <button type="button" disabled={!file || Boolean(exporting)} onClick={() => setShowExportAnimation(true)}>
        <SlidersHorizontal size={16} />动画设置
      </button>
      <button type="button" disabled={!file || Boolean(exporting)} onClick={togglePreview}>
        {previewState === "playing" ? <Pause size={15} /> : <Play size={15} />}
        {previewState === "playing" ? "暂停" : previewState === "paused" ? "继续" : "播放"}
      </button>
      <button type="button" disabled={!file || Boolean(exporting) || previewState === "idle"} onClick={resetProgress}>从头开始</button>
      <button type="button" disabled={!file || Boolean(exporting)} title="复位视角"
        onClick={() => rendererRef.current?.resetRotation()}><RotateCcw size={16} /></button>
      <button type="button" disabled={!file || Boolean(exporting) || loading} onClick={() => void exportPng()}>
        <Download size={16} />{exporting === "png" ? "导出中" : "PNG"}
      </button>
      <button type="button" disabled={!file || Boolean(exporting) || loading} onClick={() => void exportMp4()}>
        <Film size={16} />MP4
      </button>
    </div>

    <div className="dissolution-studio__presets">
      {(Object.keys(DISSOLUTION_PRESETS) as DissolutionPresetId[]).map((id) => <button key={id} type="button"
        disabled={Boolean(exporting)} className={activePreset === id ? "is-active" : ""}
        onClick={() => applyPreset(id)}>{DISSOLUTION_PRESETS[id].name}</button>)}
    </div>

    <aside className={`dissolution-controls ${collapsed ? "is-collapsed" : ""}`}>
      <button className="dissolution-controls__handle" type="button" onClick={() => setCollapsed((value) => !value)}>
        {collapsed ? "展开" : "收起"}
      </button>
      <div className="dissolution-controls__body">
        <div className="dissolution-controls__heading">
          <div><strong>粒子溶解参数</strong><small>独立 Demo Renderer</small></div>
          <span>{particleCount.toLocaleString()} 粒子</span>
        </div>
        {visibleSliders.map((slider) => {
          const label = fire && slider.key === "invasion" ? "燃烧进度"
            : fire && slider.key === "waveStrength" ? "热量扭曲"
              : fire && slider.key === "waveFrequency" ? "扭曲频率" : slider.label;
          return <label key={slider.key} className="dissolution-range">
            <span>{label}<output>{params[slider.key].toFixed(slider.step < 0.01 ? 3 : slider.step < 1 ? 2 : 0)}</output></span>
            <input type="range" disabled={Boolean(exporting)} min={slider.min} max={slider.max} step={slider.step}
              value={params[slider.key]} onChange={(event) => updateParam(slider.key, Number(event.target.value))} />
          </label>;
        })}
      </div>
    </aside>

    {file && <div className="dissolution-studio__hint">拖拽立体旋转 · 当前图片在两套引擎间共享</div>}
    {loading && <div className="dissolution-studio__progress"><LoaderCircle className="is-spinning" size={22} />正在解析像素粒子</div>}
    {exporting === "mp4" && <div className="dissolution-studio__progress dissolution-studio__export">
      <LoaderCircle className="is-spinning" size={22} />
      <strong>正在生成 1080p MP4</strong>
      <span>{exportProgress.completed} / {exportProgress.total}</span>
      <div><i style={{ width: `${Math.round(exportProgress.completed / exportProgress.total * 100)}%` }} /></div>
      <button type="button" onClick={() => exportAbortRef.current?.abort()}><X size={14} />取消</button>
    </div>}
    {notice && <button type="button" className="dissolution-studio__notice" onClick={() => setNotice(null)}>
      {notice}<span>×</span>
    </button>}
    {showExportAnimation && <ParticleExportAnimationDialog
      fields={DISSOLUTION_EXPORT_ANIMATION_FIELDS}
      values={exportAnimationValues}
      config={animationConfig}
      onCancel={() => setShowExportAnimation(false)}
      onConfirm={saveAnimationConfig}
    />}
  </main>;
}
