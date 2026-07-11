import { useEffect, useRef, useState } from "react";
import type { VideoHTMLAttributes } from "react";
import { Play } from "lucide-react";

interface OnDemandVideoProps extends Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> {
  src: string;
  label?: string;
}

export default function OnDemandVideo({ src, poster, label = "播放视频", className = "", ...props }: OnDemandVideoProps) {
  const [active, setActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setActive(false);
    return () => {
      const video = videoRef.current;
      if (!video) return;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);

  useEffect(() => {
    if (active) void videoRef.current?.play().catch(() => undefined);
  }, [active]);

  if (active) {
    return (
      <video
        {...props}
        ref={videoRef}
        src={src}
        poster={poster}
        className={className}
        controls
        playsInline
        preload="metadata"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setActive(true)}
      className={`group relative overflow-hidden bg-stone-950 ${className}`}
      aria-label={label}
      title={label}
    >
      {poster ? <img src={poster} alt="" className="h-full w-full object-contain" loading="lazy" decoding="async" /> : null}
      <span className="absolute inset-0 grid place-items-center bg-black/20 transition-colors group-hover:bg-black/10">
        <span className="grid h-12 w-12 place-items-center rounded-full border border-white/30 bg-black/55 text-white shadow-lg backdrop-blur-sm">
          <Play size={21} className="ml-0.5 fill-current" />
        </span>
      </span>
    </button>
  );
}
