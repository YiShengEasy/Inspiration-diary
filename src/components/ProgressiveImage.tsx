import { useEffect, useState } from "react";
import type { ImgHTMLAttributes } from "react";

interface ProgressiveImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  previewSrc?: string;
  src: string;
}

export default function ProgressiveImage({ previewSrc, src, className = "", onLoad, ...props }: ProgressiveImageProps) {
  const [displaySrc, setDisplaySrc] = useState(previewSrc || src);
  const [isDetailReady, setIsDetailReady] = useState(!previewSrc || previewSrc === src);

  useEffect(() => {
    setDisplaySrc(previewSrc || src);
    setIsDetailReady(!previewSrc || previewSrc === src);
    if (!src || src === previewSrc) return;

    let alive = true;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (!alive) return;
      setDisplaySrc(src);
      setIsDetailReady(true);
    };
    image.src = src;
    return () => {
      alive = false;
      image.onload = null;
    };
  }, [previewSrc, src]);

  return (
    <img
      {...props}
      src={displaySrc}
      className={`${className} transition-opacity duration-200 ${isDetailReady ? "opacity-100" : "opacity-90"}`}
      decoding="async"
      onLoad={onLoad}
    />
  );
}
