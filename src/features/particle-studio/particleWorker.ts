import { computeFastDepth, sampleParticleSource } from "./fastDepth";
import type { ParticleParams, ParticleSource } from "./types";

export interface ParticleBuildRequest {
  id: number;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  params: ParticleParams;
  maxParticles: number;
  depth?: Float32Array;
}

export type ParticleBuildResponse =
  | { id: number; source: ParticleSource }
  | { id: number; error: string };

const transferableSourceBuffers = (source: ParticleSource): ArrayBuffer[] => {
  const buffers = [
    source.imageRgba.buffer,
    source.depthMap.buffer,
    source.contentMap.buffer,
    source.boundaryMap.buffer,
    source.colors.buffer,
    source.positions.buffer,
    source.depth.buffer,
    source.edge.buffer,
    source.content.buffer,
    source.boundary.buffer,
    source.random.buffer,
  ];
  return [...new Set(buffers)] as ArrayBuffer[];
};

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<ParticleBuildRequest>) => void) | null;
  postMessage: (message: ParticleBuildResponse, transfer?: Transferable[]) => void;
};

workerScope.onmessage = (event) => {
  const request = event.data;
  try {
    const depth = request.depth
      ?? computeFastDepth(request.rgba, request.width, request.height, request.params);
    const source = sampleParticleSource(
      request.rgba,
      depth,
      request.width,
      request.height,
      request.params,
      request.maxParticles,
    );
    workerScope.postMessage({ id: request.id, source }, transferableSourceBuffers(source));
  } catch (error) {
    workerScope.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : "粒子预处理失败",
    });
  }
};
