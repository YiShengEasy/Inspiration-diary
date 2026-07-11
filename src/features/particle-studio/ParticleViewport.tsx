import { useEffect, useRef } from "react";
import { ParticleRenderer } from "./ParticleRenderer";
import type { ParticleParams, ParticleSource, QualityProfile } from "./types";

interface ParticleViewportProps {
  source: ParticleSource | null;
  imageUrl?: string | null;
  params: ParticleParams;
  profile: QualityProfile;
  paused?: boolean;
  onRendererReady?: (renderer: ParticleRenderer | null) => void;
  onPerformanceMode?: (reduced: boolean) => void;
  className?: string;
}

export function ParticleViewport({
  source, imageUrl = null, params, profile, paused = false, onRendererReady, onPerformanceMode, className,
}: ParticleViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ParticleRenderer | null>(null);
  const performanceCallbackRef = useRef(onPerformanceMode);
  performanceCallbackRef.current = onPerformanceMode;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const renderer = new ParticleRenderer(container, profile, (reduced) => performanceCallbackRef.current?.(reduced));
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
    void rendererRef.current?.setImageTexture(imageUrl, source ? source.width / source.height : 1);
  }, [imageUrl, source?.width, source?.height]);

  useEffect(() => {
    rendererRef.current?.setParams(params);
  }, [params]);

  useEffect(() => {
    if (paused) rendererRef.current?.pause();
    else if (!document.hidden) rendererRef.current?.resume();
  }, [paused]);

  return <div ref={containerRef} className={className} aria-label="3D 粒子画布" />;
}
