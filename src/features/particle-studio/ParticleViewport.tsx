import { useEffect, useRef } from "react";
import { ParticleRenderer } from "./ParticleRenderer";
import type { ParticleParams, ParticleSource, QualityProfile } from "./types";
import type { PreviewPlaybackState } from "./exportAnimation";

interface ParticleViewportProps {
  source: ParticleSource | null;
  params: ParticleParams;
  profile: QualityProfile;
  paused?: boolean;
  onRendererReady?: (renderer: ParticleRenderer | null) => void;
  onPerformanceMode?: (reduced: boolean) => void;
  onPreviewStateChange?: (state: PreviewPlaybackState) => void;
  className?: string;
}

export function ParticleViewport({
  source, params, profile, paused = false, onRendererReady, onPerformanceMode, onPreviewStateChange, className,
}: ParticleViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ParticleRenderer | null>(null);
  const performanceCallbackRef = useRef(onPerformanceMode);
  const previewCallbackRef = useRef(onPreviewStateChange);
  performanceCallbackRef.current = onPerformanceMode;
  previewCallbackRef.current = onPreviewStateChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const renderer = new ParticleRenderer(
      container,
      profile,
      (reduced) => performanceCallbackRef.current?.(reduced),
      (state) => previewCallbackRef.current?.(state),
    );
    rendererRef.current = renderer;
    onRendererReady?.(renderer);
    const handleVisibility = () => document.hidden ? renderer.pause() : renderer.resume();
    document.addEventListener("visibilitychange", handleVisibility);
    handleVisibility();
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      onRendererReady?.(null);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [profile, onRendererReady]);

  useEffect(() => {
    if (source) rendererRef.current?.setSource(source);
  }, [source]);

  useEffect(() => {
    rendererRef.current?.setParams(params);
  }, [params]);

  useEffect(() => {
    if (paused) rendererRef.current?.pause();
    else if (!document.hidden) rendererRef.current?.resume();
  }, [paused]);

  return <div ref={containerRef} className={className} aria-label="3D 粒子画布" />;
}
