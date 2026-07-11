import type { ParticleParams, ParticleSource } from "./types";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (value: number, min: number, max: number) => {
  if (max <= min) return value >= max ? 1 : 0;
  const normalized = clamp01((value - min) / (max - min));
  return normalized * normalized * (3 - 2 * normalized);
};

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

function computeLuminance(rgba: Uint8Array | Uint8ClampedArray, pixelCount: number): Float32Array {
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

function retainSubstantialComponents(
  values: Float32Array,
  width: number,
  height: number,
  threshold: number,
): Float32Array {
  const labels = new Int32Array(values.length);
  labels.fill(-1);
  const queue = new Int32Array(values.length);
  const sizes: number[] = [];
  let component = 0;
  let largest = 0;
  for (let start = 0; start < values.length; start += 1) {
    if (labels[start] !== -1 || values[start] < threshold) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = component;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (labels[neighbor] !== -1 || values[neighbor] < threshold) continue;
          labels[neighbor] = component;
          queue[tail++] = neighbor;
        }
      }
    }
    sizes[component] = tail;
    largest = Math.max(largest, tail);
    component += 1;
  }
  const absoluteFloor = Math.min(24, Math.max(1, Math.floor(values.length * 0.0005)));
  const minimumSize = Math.max(absoluteFloor, Math.floor(largest * 0.055));
  const gate = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const label = labels[index];
    if (label >= 0 && sizes[label] >= minimumSize) gate[index] = 1;
  }
  return gate;
}

export function computeContentMask(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  background: [number, number, number, number],
  params: ParticleParams,
): Float32Array {
  const pixelCount = width * height;
  if (rgba.length < pixelCount * 4 || width <= 0 || height <= 0) {
    throw new Error("Invalid content-mask source data");
  }
  const luminance = computeLuminance(rgba, pixelCount);
  const edges = computeEdges(luminance, width, height);
  const raw = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const alpha = rgba[offset + 3] / 255;
    const alphaPresence = smoothstep(alpha, params.alphaThreshold, Math.min(1, params.alphaThreshold + 0.08));
    const backgroundDistance = Math.hypot(
      rgba[offset] / 255 - background[0],
      rgba[offset + 1] / 255 - background[1],
      rgba[offset + 2] / 255 - background[2],
    ) / Math.sqrt(3);
    const separatedFromBackground = smoothstep(backgroundDistance, 0.035, 0.18);
    const x = index % width;
    const y = Math.floor(index / width);
    const normalizedX = ((x + 0.5) / width - 0.5) * 2;
    const normalizedY = ((y + 0.5) / height - 0.5) * 2;
    const centerAttention = 1 - smoothstep(Math.hypot(normalizedX, normalizedY), 0.48, 1.22);
    const brightnessPresence = smoothstep(
      luminance[index],
      params.brightnessThreshold * 0.5,
      Math.max(0.14, params.brightnessThreshold + 0.1),
    );
    const backgroundAware = (
      separatedFromBackground * background[3]
      + centerAttention * (1 - background[3])
    ) * (0.1 + centerAttention * 0.9);
    const brightnessWeight = 0.06 + (1 - background[3]) * 0.24;
    raw[index] = alphaPresence * clamp01(
      backgroundAware * 0.86
      + brightnessPresence * brightnessWeight
      + edges[index] * params.edgeStrength * 0.2,
    );
  }

  const minDimension = Math.min(width, height);
  const innerRadius = Math.min(12, Math.max(1, Math.round(minDimension * 0.006)));
  const outerRadius = Math.min(30, Math.max(2, Math.round(minDimension * 0.022)));
  const initialInner = boxBlur(raw, width, height, innerRadius);
  const componentGate = retainSubstantialComponents(initialInner, width, height, 0.18);
  const filteredRaw = new Float32Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) filteredRaw[index] = raw[index] * componentGate[index];
  const inner = boxBlur(filteredRaw, width, height, innerRadius);
  const outer = boxBlur(filteredRaw, width, height, outerRadius);
  const content = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const denseNeighborhood = smoothstep(inner[index], 0.055, 0.26);
    content[index] = clamp01(Math.max(
      filteredRaw[index] * denseNeighborhood,
      inner[index] * 0.94,
      Math.sqrt(outer[index]) * 0.52,
    ));
  }
  return content;
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
  const background = estimateBackground(imageRgba, width, height);
  const contentMap = computeContentMask(imageRgba, width, height, background, params);
  const boundaryMap = computeEdges(contentMap, width, height);
  for (let index = 0; index < boundaryMap.length; index += 1) {
    boundaryMap[index] = clamp01(boundaryMap[index] * 8);
  }
  const luminance = computeLuminance(imageRgba, pixelCount);
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
  const sampledContent = new Float32Array(selected.length);
  const sampledBoundary = new Float32Array(selected.length);
  const random = new Float32Array(selected.length);
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
    colors[output] = imageRgba[input] / 255;
    colors[output + 1] = imageRgba[input + 1] / 255;
    colors[output + 2] = imageRgba[input + 2] / 255;
    sampledDepth[particleIndex] = depth[index];
    sampledEdge[particleIndex] = edges[index];
    sampledContent[particleIndex] = contentMap[index];
    sampledBoundary[particleIndex] = boundaryMap[index];
    random[particleIndex] = ((index * 16807) % 2147483647) / 2147483647;
  });

  return {
    width,
    height,
    background,
    imageRgba,
    depthMap: depth,
    contentMap,
    boundaryMap,
    colors,
    positions,
    depth: sampledDepth,
    edge: sampledEdge,
    content: sampledContent,
    boundary: sampledBoundary,
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
