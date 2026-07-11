import type { ParticleParams, ParticleSource } from "./types";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function computeLuminance(rgba: Uint8ClampedArray, pixelCount: number): Float32Array {
  const luminance = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    luminance[index] = (0.2126 * rgba[offset] + 0.7152 * rgba[offset + 1] + 0.0722 * rgba[offset + 2]) / 255;
  }
  return luminance;
}

function computeEdges(luminance: Float32Array, width: number, height: number): Float32Array {
  const edges = new Float32Array(luminance.length);
  if (width < 3 || height < 3) return edges;

  const at = (x: number, y: number) => luminance[
    Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))
  ];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gx = -at(x - 1, y - 1) + at(x + 1, y - 1)
        - 2 * at(x - 1, y) + 2 * at(x + 1, y)
        - at(x - 1, y + 1) + at(x + 1, y + 1);
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)
        + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      edges[y * width + x] = clamp01(Math.hypot(gx, gy) / 4);
    }
  }
  return edges;
}

function boxBlur(values: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius <= 0 || width < 2 || height < 2) return values;
  const output = new Float32Array(values.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let oy = -radius; oy <= radius; oy += 1) {
        const sy = Math.min(height - 1, Math.max(0, y + oy));
        for (let ox = -radius; ox <= radius; ox += 1) {
          const sx = Math.min(width - 1, Math.max(0, x + ox));
          sum += values[sy * width + sx];
          count += 1;
        }
      }
      output[y * width + x] = sum / count;
    }
  }
  return output;
}

export function computeFastDepth(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  params: ParticleParams,
): Float32Array {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) {
    throw new Error("Invalid RGBA image dimensions");
  }

  const luminance = computeLuminance(rgba, width * height);
  const edges = computeEdges(luminance, width, height);

  const combined = new Float32Array(luminance.length);
  const edgeMix = clamp01(params.edgeStrength);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const edge = width >= 3 && height >= 3 ? edges[y * width + x] : luminance[y * width + x];
      combined[y * width + x] = clamp01(luminance[y * width + x] * (1 - edgeMix) + edge * edgeMix);
    }
  }

  // Avoid erasing useful variation in very small images; larger images use up to a 3 px box radius.
  const radius = Math.min(3, Math.floor(clamp01(params.depthSmoothing) * 4));
  const smoothed = width > radius * 2 && height > radius * 2
    ? boxBlur(combined, width, height, radius)
    : combined;
  const layers = Math.max(2, Math.round(params.depthLayers));
  for (let index = 0; index < smoothed.length; index += 1) {
    smoothed[index] = Math.round(clamp01(smoothed[index]) * (layers - 1)) / (layers - 1);
  }
  return smoothed;
}

export function sampleParticleSource(
  rgba: Uint8ClampedArray,
  depth: Float32Array,
  width: number,
  height: number,
  params: ParticleParams,
  maxParticles: number,
): ParticleSource {
  const pixelCount = width * height;
  if (rgba.length < pixelCount * 4 || depth.length < pixelCount) throw new Error("Invalid particle source data");
  const luminance = computeLuminance(rgba, pixelCount);
  const edges = computeEdges(luminance, width, height);
  const target = Math.max(1, Math.min(maxParticles, Math.floor(pixelCount * clamp01(params.density))));
  const stride = Math.max(1, Math.ceil(Math.sqrt(pixelCount / target)));
  const selected: number[] = [];
  for (let y = 0; y < height && selected.length < target; y += stride) {
    for (let x = 0; x < width && selected.length < target; x += stride) {
      const index = y * width + x;
      const offset = index * 4;
      const alpha = rgba[offset + 3] / 255;
      if (alpha >= params.alphaThreshold && luminance[index] >= params.brightnessThreshold) selected.push(index);
    }
  }

  const positions = new Float32Array(selected.length * 3);
  const colors = new Float32Array(selected.length * 3);
  const sampledDepth = new Float32Array(selected.length);
  const sampledEdge = new Float32Array(selected.length);
  const random = new Float32Array(selected.length);
  const aspect = width / height;
  selected.forEach((index, particleIndex) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const output = particleIndex * 3;
    positions[output] = ((x + 0.5) / width - 0.5) * aspect * 2;
    positions[output + 1] = (0.5 - (y + 0.5) / height) * 2;
    positions[output + 2] = 0;
    const input = index * 4;
    const r = rgba[input] / 255;
    const g = rgba[input + 1] / 255;
    const b = rgba[input + 2] / 255;
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    colors[output] = clamp01((gray + (r - gray) * params.saturation - 0.5) * params.contrast + 0.5);
    colors[output + 1] = clamp01((gray + (g - gray) * params.saturation - 0.5) * params.contrast + 0.5);
    colors[output + 2] = clamp01((gray + (b - gray) * params.saturation - 0.5) * params.contrast + 0.5);
    sampledDepth[particleIndex] = depth[index];
    sampledEdge[particleIndex] = edges[index];
    random[particleIndex] = ((index * 16807) % 2147483647) / 2147483647;
  });

  return {
    width,
    height,
    colors,
    positions,
    depth: sampledDepth,
    edge: sampledEdge,
    random,
    particleCount: selected.length,
  };
}

export async function decodeImageFile(
  file: File,
  maxDimension: number,
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  if (!file.type.startsWith("image/")) throw new Error("请选择有效的图片文件");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前浏览器无法读取图片像素");
    context.drawImage(bitmap, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    return { rgba: imageData.data, width, height };
  } finally {
    bitmap.close();
  }
}
