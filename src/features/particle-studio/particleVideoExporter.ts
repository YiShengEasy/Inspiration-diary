import {
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
} from "mediabunny";

export const MP4_EXPORT_WIDTH = 1920;
export const MP4_EXPORT_HEIGHT = 1080;
export const MP4_EXPORT_FPS = 30;
export const MP4_EXPORT_SECONDS = 5;
export const MP4_EXPORT_FRAME_COUNT = MP4_EXPORT_FPS * MP4_EXPORT_SECONDS;

export const mp4FrameTimestamp = (frame: number, fps = MP4_EXPORT_FPS): number => frame / fps;

export const particleVideoFilename = (date = new Date()): string => {
  const stamp = date.toISOString().slice(0, 10).replaceAll("-", "");
  return `particle-live-${stamp}.mp4`;
};

export interface CanvasMp4ExportOptions {
  canvas: HTMLCanvasElement;
  renderFrame: (timeSeconds: number) => void;
  onProgress?: (completedFrames: number, totalFrames: number) => void;
  signal?: AbortSignal;
}

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException("MP4 导出已取消", "AbortError");
};

export async function exportCanvasToMp4(options: CanvasMp4ExportOptions): Promise<Blob> {
  const format = new Mp4OutputFormat();
  const bitrate = 10_000_000;
  const codec = await getFirstEncodableVideoCodec(["avc"], {
    width: MP4_EXPORT_WIDTH,
    height: MP4_EXPORT_HEIGHT,
    bitrate,
  });
  if (codec !== "avc") throw new Error("当前浏览器不支持 H.264 WebCodecs 编码，请使用最新版 Chrome、Edge 或 Safari");

  const target = new BufferTarget();
  const output = new Output({ format, target });
  const source = new CanvasSource(options.canvas, {
    codec,
    bitrate,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source);
  try {
    throwIfAborted(options.signal);
    await output.start();
    for (let frame = 0; frame < MP4_EXPORT_FRAME_COUNT; frame += 1) {
      throwIfAborted(options.signal);
      const timestamp = mp4FrameTimestamp(frame);
      options.renderFrame(timestamp);
      await source.add(timestamp, 1 / MP4_EXPORT_FPS, { keyFrame: frame % (MP4_EXPORT_FPS * 2) === 0 });
      options.onProgress?.(frame + 1, MP4_EXPORT_FRAME_COUNT);
      if ((frame + 1) % 4 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    await output.finalize();
    if (!target.buffer) throw new Error("MP4 编码完成但未产生文件数据");
    return new Blob([target.buffer], { type: "video/mp4" });
  } catch (error) {
    if (output.state === "started") await output.cancel();
    throw error;
  }
}
