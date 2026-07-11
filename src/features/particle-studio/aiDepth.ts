import type { DepthProgressHandler } from "./types";

const MODEL_ID = "onnx-community/depth-anything-v2-small";

type Backend = "webgpu" | "wasm";
type ModelProgress = import("@huggingface/transformers").ProgressInfo;
type DepthImage = import("@huggingface/transformers").RawImage;
type DepthPipeline = {
  (image: Blob): Promise<{ depth: DepthImage }>;
  dispose(): Promise<void>;
};

let cachedPipeline: { backend: Backend; value: DepthPipeline } | undefined;
let pendingPipeline: { backend: Backend; value: Promise<DepthPipeline> } | undefined;

const abortError = () => new Error("AI 深度生成已取消");

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function progressValue(info: ModelProgress): number | undefined {
  return info.status === "progress" || info.status === "progress_total" ? info.progress / 100 : undefined;
}

async function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function loadPipeline(backend: Backend, onProgress: DepthProgressHandler, signal?: AbortSignal) {
  if (cachedPipeline?.backend === backend) return cachedPipeline.value;

  if (!pendingPipeline || pendingPipeline.backend !== backend) {
    const loading = import("@huggingface/transformers").then(({ env, pipeline }) => {
      env.useBrowserCache = true;
      return pipeline("depth-estimation", MODEL_ID, {
        device: backend,
        progress_callback: (info: ModelProgress) => {
          const progress = progressValue(info);
          if (progress !== undefined) {
            onProgress({ stage: "download", progress, message: "正在下载 AI 深度模型" });
          }
        },
      }) as Promise<DepthPipeline>;
    });
    pendingPipeline = { backend, value: loading };
  }

  try {
    const value = await withAbort(pendingPipeline.value, signal);
    cachedPipeline = { backend, value };
    return value;
  } catch (error) {
    if (pendingPipeline?.backend === backend) pendingPipeline = undefined;
    throw error;
  }
}

async function infer(
  backend: Backend,
  file: File,
  width: number,
  height: number,
  onProgress: DepthProgressHandler,
  signal?: AbortSignal,
) {
  onProgress({ stage: "loading", progress: 0, message: `正在加载 ${backend === "webgpu" ? "WebGPU" : "WASM"} 模型` });
  const estimator = await loadPipeline(backend, onProgress, signal);
  throwIfAborted(signal);
  onProgress({ stage: "inference", progress: 0, message: "正在分析图片深度" });
  const output = await withAbort(estimator(file), signal);
  const result = Array.isArray(output) ? output[0] : output;
  const resized = result.depth.width === width && result.depth.height === height
    ? result.depth
    : await withAbort(result.depth.resize(width, height), signal);
  throwIfAborted(signal);
  return normalizeDepthOutput(resized.data, width, height);
}

export function normalizeDepthOutput(
  values: ArrayLike<number>,
  width: number,
  height: number,
  invert = false,
): Float32Array {
  const expected = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || values.length !== expected) {
    throw new Error("AI 深度数据尺寸无效");
  }

  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < expected; index += 1) {
    const value = Number(values[index]);
    if (!Number.isFinite(value)) throw new Error("AI 深度数据包含无效数值");
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  const output = new Float32Array(expected);
  const range = max - min;
  if (range === 0) return output;
  for (let index = 0; index < expected; index += 1) {
    const normalized = (Number(values[index]) - min) / range;
    output[index] = invert ? 1 - normalized : normalized;
  }
  return output;
}

export async function generateAiDepth(
  file: File,
  width: number,
  height: number,
  onProgress: DepthProgressHandler,
  signal?: AbortSignal,
): Promise<Float32Array> {
  throwIfAborted(signal);
  const supportsWebGpu = typeof navigator !== "undefined" && "gpu" in navigator;
  const backends: Backend[] = supportsWebGpu ? ["webgpu", "wasm"] : ["wasm"];
  let lastError: unknown;

  for (const backend of backends) {
    try {
      const depth = await infer(backend, file, width, height, onProgress, signal);
      onProgress({ stage: "ready", progress: 1, message: "AI 深度分析完成" });
      return depth;
    } catch (error) {
      if (signal?.aborted) throw abortError();
      lastError = error;
      if (cachedPipeline?.backend === backend) {
        void cachedPipeline.value.dispose();
        cachedPipeline = undefined;
      }
      if (pendingPipeline?.backend === backend) pendingPipeline = undefined;
    }
  }

  const reason = lastError instanceof Error ? lastError.message : "未知错误";
  throw new Error(`AI 深度分析失败，已保留快速模式结果：${reason}`);
}
