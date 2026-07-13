export const DEFAULT_ANALYSIS_MAX_EDGE = 1280;
export const DEFAULT_ANALYSIS_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_ANALYSIS_QUALITY = 0.82;

const QUALITY_STEP = 0.08;
const MIN_QUALITY = 0.26;

export type AnalysisImageFormat = "image/webp" | "image/jpeg";

export interface DecodedAnalysisImage {
  width: number;
  height: number;
  source: CanvasImageSource;
}

export interface AnalysisCanvas {
  draw(source: CanvasImageSource, width: number, height: number): void;
  encode(format: AnalysisImageFormat, quality: number): Promise<Blob | null>;
}

export interface ImageAnalysisCopyDependencies {
  createObjectURL(file: Blob): string;
  revokeObjectURL(url: string): void;
  decodeImage(url: string): Promise<DecodedAnalysisImage>;
  createCanvas(width: number, height: number): AnalysisCanvas;
}

export interface ImageAnalysisCopyOptions {
  maxEdge?: number;
  maxBytes?: number;
  initialQuality?: number;
  dependencies?: ImageAnalysisCopyDependencies;
}

export class ImageAnalysisCopyError extends Error {
  constructor(
    public readonly code:
      | "invalid_image"
      | "decode_failed"
      | "canvas_unavailable"
      | "encode_failed"
      | "size_limit_exceeded",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ImageAnalysisCopyError";
  }
}

function positiveNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ImageAnalysisCopyError("encode_failed", `${label} 必须大于 0。`);
  }
  return value;
}

export function fitAnalysisDimensions(
  width: number,
  height: number,
  maxEdge = DEFAULT_ANALYSIS_MAX_EDGE,
): { width: number; height: number } {
  positiveNumber(width, "图片宽度");
  positiveNumber(height, "图片高度");
  positiveNumber(maxEdge, "最长边限制");

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function qualitySequence(initialQuality: number): number[] {
  if (!Number.isFinite(initialQuality) || initialQuality <= 0 || initialQuality > 1) {
    throw new ImageAnalysisCopyError("encode_failed", "图片压缩质量必须在 0 到 1 之间。");
  }

  const qualities: number[] = [];
  for (let quality = initialQuality; quality >= MIN_QUALITY - 0.001; quality -= QUALITY_STEP) {
    qualities.push(Number(quality.toFixed(2)));
  }
  if (qualities.at(-1) !== MIN_QUALITY) qualities.push(MIN_QUALITY);
  return qualities;
}

function isRequestedFormat(blob: Blob, format: AnalysisImageFormat): boolean {
  const actual = blob.type.toLowerCase();
  if (format === "image/jpeg") return actual === "image/jpeg" || actual === "image/jpg";
  return actual === format;
}

async function encodeWithinLimit(
  canvas: AnalysisCanvas,
  format: AnalysisImageFormat,
  qualities: number[],
  maxBytes: number,
): Promise<{ blob?: Blob; supported: boolean }> {
  let supported = false;
  for (const quality of qualities) {
    const blob = await canvas.encode(format, quality);
    if (!blob || !isRequestedFormat(blob, format)) return { supported };
    supported = true;
    if (blob.size <= maxBytes) return { blob, supported };
  }
  return { supported };
}

function browserDependencies(): ImageAnalysisCopyDependencies {
  return {
    createObjectURL: (file) => URL.createObjectURL(file),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    decodeImage: (url) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () =>
          resolve({
            width: image.naturalWidth || image.width,
            height: image.naturalHeight || image.height,
            source: image,
          });
        image.onerror = () => reject(new Error("image decode failed"));
        image.src = url;
      }),
    createCanvas: (width, height) => {
      if (typeof document === "undefined") {
        throw new ImageAnalysisCopyError("canvas_unavailable", "当前环境不支持图片压缩。");
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new ImageAnalysisCopyError("canvas_unavailable", "无法创建图片分析画布。");
      }
      return {
        draw: (source, drawWidth, drawHeight) => {
          context.clearRect(0, 0, width, height);
          context.drawImage(source, 0, 0, drawWidth, drawHeight);
        },
        encode: (format, quality) =>
          new Promise((resolve) => canvas.toBlob(resolve, format, quality)),
      };
    },
  };
}

/**
 * Creates a bounded browser-side copy for AI/image analysis. The original file
 * remains untouched and can be uploaded separately to object storage.
 */
export async function createImageAnalysisCopy(
  file: Blob,
  options: ImageAnalysisCopyOptions = {},
): Promise<Blob> {
  if (!file.type.toLowerCase().startsWith("image/")) {
    throw new ImageAnalysisCopyError("invalid_image", "只能为图片生成分析副本。");
  }

  const maxEdge = positiveNumber(options.maxEdge ?? DEFAULT_ANALYSIS_MAX_EDGE, "最长边限制");
  const maxBytes = positiveNumber(options.maxBytes ?? DEFAULT_ANALYSIS_MAX_BYTES, "分析副本大小限制");
  const qualities = qualitySequence(options.initialQuality ?? DEFAULT_ANALYSIS_QUALITY);
  const dependencies = options.dependencies ?? browserDependencies();
  const sourceUrl = dependencies.createObjectURL(file);

  try {
    let decoded: DecodedAnalysisImage;
    try {
      decoded = await dependencies.decodeImage(sourceUrl);
    } catch (error) {
      throw new ImageAnalysisCopyError("decode_failed", "图片读取失败，无法生成分析副本。", {
        cause: error,
      });
    }

    const dimensions = fitAnalysisDimensions(decoded.width, decoded.height, maxEdge);
    let canvas: AnalysisCanvas;
    try {
      canvas = dependencies.createCanvas(dimensions.width, dimensions.height);
      canvas.draw(decoded.source, dimensions.width, dimensions.height);
    } catch (error) {
      if (error instanceof ImageAnalysisCopyError) throw error;
      throw new ImageAnalysisCopyError("canvas_unavailable", "无法创建图片分析画布。", {
        cause: error,
      });
    }

    try {
      const webp = await encodeWithinLimit(canvas, "image/webp", qualities, maxBytes);
      if (webp.blob) return webp.blob;

      const jpeg = await encodeWithinLimit(canvas, "image/jpeg", qualities, maxBytes);
      if (jpeg.blob) return jpeg.blob;

      if (webp.supported || jpeg.supported) {
        throw new ImageAnalysisCopyError(
          "size_limit_exceeded",
          `图片压缩后仍超过 ${Math.round(maxBytes / 1024 / 1024)} MiB，无法用于分析。`,
        );
      }
      throw new ImageAnalysisCopyError("encode_failed", "浏览器不支持 WebP 或 JPEG 图片编码。");
    } catch (error) {
      if (error instanceof ImageAnalysisCopyError) throw error;
      throw new ImageAnalysisCopyError("encode_failed", "图片分析副本编码失败。", { cause: error });
    }
  } finally {
    dependencies.revokeObjectURL(sourceUrl);
  }
}
