import type { ParticleBuildRequest, ParticleBuildResponse } from "./particleWorker";
import type { ParticleParams, ParticleSource } from "./types";

export const isLatestParticleRequest = (latestId: number, resultId: number): boolean => latestId === resultId;

type PendingRequest = {
  resolve: (source: ParticleSource) => void;
  reject: (error: Error) => void;
};

export interface BuildParticleSourceInput {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  params: ParticleParams;
  maxParticles: number;
  depth?: Float32Array | null;
}

export class ParticleWorkerClient {
  private readonly worker: Worker;
  private latestId = 0;
  private readonly pending = new Map<number, PendingRequest>();

  constructor() {
    this.worker = new Worker(new URL("./particleWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<ParticleBuildResponse>) => this.handleMessage(event.data);
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "粒子 Worker 运行失败");
      this.pending.forEach(({ reject }) => reject(error));
      this.pending.clear();
    };
  }

  buildSource(input: BuildParticleSourceInput): Promise<ParticleSource> {
    this.cancelPending();
    const id = ++this.latestId;
    const rgba = input.rgba.slice();
    const depth = input.depth?.slice();
    const request: ParticleBuildRequest = {
      id,
      rgba,
      width: input.width,
      height: input.height,
      params: input.params,
      maxParticles: input.maxParticles,
      ...(depth ? { depth } : {}),
    };
    const transfer: Transferable[] = [rgba.buffer];
    if (depth) transfer.push(depth.buffer);
    const promise = new Promise<ParticleSource>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.worker.postMessage(request, transfer);
    return promise;
  }

  cancelPending(): void {
    const error = new DOMException("粒子任务已被新请求替代", "AbortError");
    this.pending.forEach(({ reject }) => reject(error));
    this.pending.clear();
    this.latestId += 1;
  }

  dispose(): void {
    this.cancelPending();
    this.worker.terminate();
  }

  private handleMessage(response: ParticleBuildResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending || !isLatestParticleRequest(this.latestId, response.id)) return;
    this.pending.delete(response.id);
    if ("error" in response) pending.reject(new Error(response.error));
    else pending.resolve(response.source);
  }
}
