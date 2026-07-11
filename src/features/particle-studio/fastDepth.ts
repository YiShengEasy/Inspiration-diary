import type { ParticleParams, ParticleSource } from "./types";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function hash01(value: number): number {
  let hash = value >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = a;
  let right = b;
  while (right !== 0) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left;
}

function centerWeightedCoordinate(value: number): number {
  const signed = value * 2 - 1;
  return 0.5 + Math.sign(signed) * Math.pow(Math.abs(signed), 1.2) * 0.5;
}

function estimateBackground(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): [number, number, number, number] {
  const patchWidth = Math.max(1, Math.min(10, Math.floor(width * 0.08)));
  const patchHeight = Math.max(1, Math.min(10, Math.floor(height * 0.08)));
  const samples: Array<[number, number, number]> = [];
  const origins = [
    [0, 0],
    [Math.max(0, width - patchWidth), 0],
    [0, Math.max(0, height - patchHeight)],
    [Math.max(0, width - patchWidth), Math.max(0, height - patchHeight)],
  ];
  origins.forEach(([originX, originY]) => {
    for (let y = 0; y < patchHeight; y += 1) {
      for (let x = 0; x < patchWidth; x += 1) {
        const offset = ((originY + y) * width + originX + x) * 4;
        samples.push([rgba[offset] / 255, rgba[offset + 1] / 255, rgba[offset + 2] / 255]);
      }
    }
  });
  const mean = samples.reduce<[number, number, number]>(
    (sum, sample) => [sum[0] + sample[0], sum[1] + sample[1], sum[2] + sample[2]],
    [0, 0, 0],
  ).map((value) => value / samples.length) as [number, number, number];
  const variance = samples.reduce((sum, sample) => sum
    + ((sample[0] - mean[0]) ** 2 + (sample[1] - mean[1]) ** 2 + (sample[2] - mean[2]) ** 2) / 3, 0)
    / samples.length;
  const confidence = clamp01(1 - variance / 0.035);
  return [mean[0], mean[1], mean[2], confidence];
}

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
  const horizontal = new Float32Array(values.length);
  const output = new Float32Array(values.length);
  const windowSize = radius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      sum += values[y * width + Math.min(width - 1, Math.max(0, offset))];
    }
    for (let x = 0; x < width; x += 1) {
      horizontal[y * width + x] = sum / windowSize;
      const removeX = Math.min(width - 1, Math.max(0, x - radius));
      const addX = Math.min(width - 1, Math.max(0, x + radius + 1));
      sum += values[y * width + addX] - values[y * width + removeX];
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      sum += horizontal[Math.min(height - 1, Math.max(0, offset)) * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = sum / windowSize;
      const removeY = Math.min(height - 1, Math.max(0, y - radius));
      const addY = Math.min(height - 1, Math.max(0, y + radius + 1));
      sum += horizontal[addY * width + x] - horizontal[removeY * width + x];
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

  // Depth is intentionally low-frequency: fine luminance detail belongs in RGB,
  // not in Z, otherwise rotated pixel rows turn into visible scan-line ribbons.
  const smoothing = clamp01(params.depthSmoothing);
  const radius = smoothing === 0
    ? 0
    : Math.min(36, Math.max(1, Math.round(Math.min(width, height) * 0.035 * smoothing)));
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
  const selected: number[] = [];
  const selectedMask = new Uint8Array(pixelCount);
  const trySelect = (index: number) => {
    if (selected.length >= target || selectedMask[index]) return;
    const alpha = rgba[index * 4 + 3] / 255;
    if (alpha < params.alphaThreshold || luminance[index] < params.brightnessThreshold) return;
    selectedMask[index] = 1;
    selected.push(index);
  };

  // Independent deterministic hashes avoid both source raster rows and the long
  // diagonal bands produced by rank-one low-discrepancy lattices. The symmetric
  // power warp allocates more candidates near the image center.
  const candidateCount = Math.min(pixelCount * 4, Math.max(64, target * 8));
  for (let candidate = 0; candidate < candidateCount && selected.length < target; candidate += 1) {
    const unitX = hash01(Math.imul(candidate + 1, 0x9e3779b1) ^ 0x68bc21eb);
    const unitY = hash01(Math.imul(candidate + 1, 0x85ebca6b) ^ 0x02e5be93);
    const x = Math.min(width - 1, Math.floor(centerWeightedCoordinate(unitX) * width));
    const y = Math.min(height - 1, Math.floor(centerWeightedCoordinate(unitY) * height));
    trySelect(y * width + x);
  }

  // Thresholded images can leave holes in the sequence. Walk every remaining pixel
  // once in a deterministic permutation so eligible particles still reach the cap.
  if (selected.length < target && pixelCount > 0) {
    let step = pixelCount === 1 ? 1 : Math.max(1, Math.floor(pixelCount * 0.6180339887498949));
    while (step < pixelCount && greatestCommonDivisor(step, pixelCount) !== 1) step += 1;
    const start = Math.floor(hash01(width * 65537 + height) * pixelCount);
    for (let offset = 0; offset < pixelCount && selected.length < target; offset += 1) {
      trySelect((start + offset * step) % pixelCount);
    }
  }

  const positions = new Float32Array(selected.length * 3);
  const colors = new Float32Array(selected.length * 3);
  const sampledDepth = new Float32Array(selected.length);
  const sampledEdge = new Float32Array(selected.length);
  const random = new Float32Array(selected.length);
  const imageRgba = new Uint8Array(pixelCount * 4);
  for (let index = 0; index < pixelCount; index += 1) {
    const input = index * 4;
    const r = rgba[input] / 255;
    const g = rgba[input + 1] / 255;
    const b = rgba[input + 2] / 255;
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    imageRgba[input] = Math.round(clamp01((gray + (r - gray) * params.saturation - 0.5) * params.contrast + 0.5) * 255);
    imageRgba[input + 1] = Math.round(clamp01((gray + (g - gray) * params.saturation - 0.5) * params.contrast + 0.5) * 255);
    imageRgba[input + 2] = Math.round(clamp01((gray + (b - gray) * params.saturation - 0.5) * params.contrast + 0.5) * 255);
    imageRgba[input + 3] = rgba[input + 3];
  }
  const aspect = width / height;
  selected.forEach((index, particleIndex) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const output = particleIndex * 3;
    // More than one source pixel of jitter is intentional. At quarter-density,
    // sub-pixel jitter still exposes the original raster rows after 3D rotation.
    const jitterX = (hash01(index ^ 0x68bc21eb) - 0.5) * 1.8;
    const jitterY = (hash01(index ^ 0x02e5be93) - 0.5) * 1.8;
    positions[output] = ((x + 0.5 + jitterX) / width - 0.5) * aspect * 2;
    positions[output + 1] = (0.5 - (y + 0.5 + jitterY) / height) * 2;
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
    background: estimateBackground(imageRgba, width, height),
    imageRgba,
    depthMap: depth,
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
