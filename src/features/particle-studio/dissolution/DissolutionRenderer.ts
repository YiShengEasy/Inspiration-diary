import * as THREE from "three";
import {
  exportCanvasToMp4,
  MP4_EXPORT_SECONDS,
  MP4_EXPORT_HEIGHT,
  MP4_EXPORT_WIDTH,
} from "../particleVideoExporter";
import {
  dissolutionParticleFragmentShader,
  dissolutionParticleVertexShader,
  dissolutionPlaneFragmentShader,
  dissolutionPlaneVertexShader,
} from "./shaders";
import type { DissolutionParams } from "./types";
import {
  exportAnimationProgress,
  interpolateExportParams,
  type ExportAnimationTrack,
  type PreviewPlaybackState,
} from "../exportAnimation";
import type { DissolutionExportAnimationKey } from "../exportAnimationFields";

type ImageCache = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
};

type DissolutionRendererOptions = {
  onParticleCountChange?: (count: number) => void;
  onPreviewStateChange?: (state: PreviewPlaybackState) => void;
};

const FOV = 45;
const BASE_CAMERA_Z = 1 / Math.tan((FOV / 2) * Math.PI / 180);
const seededRandom = (index: number): number => {
  const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
};

export class DissolutionRenderer {
  private readonly container: HTMLElement;
  private readonly options: DissolutionRendererOptions;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 20);
  private readonly scene = new THREE.Scene();
  private readonly group = new THREE.Group();
  private readonly resizeObserver: ResizeObserver;
  private readonly uniforms = {
    uInvasion: { value: 0.7 },
    uBandwidth: { value: 0.3 },
    uScatter: { value: 0.057 },
    uPointSize: { value: 4 },
    uNoise: { value: 0.14 },
    uTime: { value: 0 },
    uMode: { value: 0 },
    uWaveStr: { value: 0.006 },
    uWaveFreq: { value: 8 },
    uEffect: { value: 0 },
  };
  private params: DissolutionParams;
  private imageCache: ImageCache | null = null;
  private texture: THREE.CanvasTexture | null = null;
  private imageMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null;
  private points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private imageAspect = 1;
  private loadSequence = 0;
  private animationFrame = 0;
  private lastFrame = performance.now();
  private paused = false;
  private disposed = false;
  private dragActive = false;
  private dragX = 0;
  private dragY = 0;
  private rotationX = 0;
  private rotationY = 0;
  private velocityX = 0;
  private velocityY = 0;
  private preview: {
    base: DissolutionParams;
    tracks: ExportAnimationTrack<DissolutionExportAnimationKey>[];
    state: Exclude<PreviewPlaybackState, "idle">;
    elapsed: number;
    startedAt: number;
  } | null = null;

  constructor(container: HTMLElement, params: DissolutionParams, options: DissolutionRendererOptions = {}) {
    this.container = container;
    this.params = params;
    this.options = options;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = "dissolution-studio__canvas";
    this.renderer.domElement.style.touchAction = "none";
    this.container.appendChild(this.renderer.domElement);
    this.camera.position.z = BASE_CAMERA_Z;
    this.scene.add(this.group);
    this.applyParams(params, false);
    this.bindPointerEvents();
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    this.resize();
    this.animate();
  }

  async setFile(file: File): Promise<void> {
    const sequence = ++this.loadSequence;
    const bitmap = await createImageBitmap(file);
    try {
      if (this.disposed || sequence !== this.loadSequence) return;
      const mobile = window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
      const maxDimension = mobile ? 480 : 600;
      const scale = Math.min(1, maxDimension / bitmap.width, maxDimension / bitmap.height);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("当前浏览器无法读取图片像素");
      context.drawImage(bitmap, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height).data;
      if (this.disposed || sequence !== this.loadSequence) return;
      this.rebuildAll({ data, width, height, canvas });
    } finally {
      bitmap.close();
    }
  }

  setParams(params: DissolutionParams): void {
    if (this.preview) {
      this.preview = null;
      this.options.onPreviewStateChange?.("idle");
    }
    const rebuild = params.sampleStep !== this.params.sampleStep;
    this.params = params;
    this.applyParams(params, rebuild);
  }

  startPreview(tracks: ExportAnimationTrack<DissolutionExportAnimationKey>[]): void {
    if (this.preview) this.resetPreview();
    this.preview = {
      base: { ...this.params },
      tracks,
      state: "playing",
      elapsed: 0,
      startedAt: performance.now(),
    };
    this.options.onPreviewStateChange?.("playing");
  }

  pausePreview(): void {
    if (!this.preview || this.preview.state !== "playing") return;
    this.preview.elapsed = Math.min(
      MP4_EXPORT_SECONDS,
      this.preview.elapsed + (performance.now() - this.preview.startedAt) / 1000,
    );
    this.preview.state = "paused";
    this.options.onPreviewStateChange?.("paused");
  }

  resumePreview(): void {
    if (!this.preview || this.preview.state !== "paused") return;
    this.preview.startedAt = performance.now();
    this.preview.state = "playing";
    this.options.onPreviewStateChange?.("playing");
  }

  resetPreview(): void {
    if (!this.preview) return;
    this.preview = null;
    this.applyParams(this.params, false);
    this.options.onPreviewStateChange?.("idle");
  }

  resetRotation(): void {
    this.rotationX = 0;
    this.rotationY = 0;
    this.velocityX = 0;
    this.velocityY = 0;
    this.group.rotation.set(0, 0, 0);
  }

  pause(): void {
    this.paused = true;
    cancelAnimationFrame(this.animationFrame);
  }

  resume(): void {
    if (!this.paused || this.disposed) return;
    this.paused = false;
    this.lastFrame = performance.now();
    this.animate();
  }

  async exportPng(scale = 2): Promise<Blob> {
    if (!this.imageMesh) throw new Error("请先上传图片");
    const oldRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(Math.min(3, oldRatio * Math.max(1, scale)));
    this.resize();
    this.renderer.render(this.scene, this.camera);
    const blob = await new Promise<Blob | null>((resolve) => this.renderer.domElement.toBlob(resolve, "image/png"));
    this.renderer.setPixelRatio(oldRatio);
    this.resize();
    if (!blob) throw new Error("无法导出当前粒子画面");
    return blob;
  }

  async exportMp4(options: {
    onProgress?: (completed: number, total: number) => void;
    signal?: AbortSignal;
    animationTracks?: ExportAnimationTrack<DissolutionExportAnimationKey>[];
  } = {}): Promise<Blob> {
    if (!this.imageMesh) throw new Error("请先上传图片");
    const wasPaused = this.paused;
    const oldRatio = this.renderer.getPixelRatio();
    const oldTime = this.uniforms.uTime.value;
    const oldInvasion = this.uniforms.uInvasion.value;
    const originalParams = { ...this.params };
    const animationTracks = options.animationTracks ?? [];
    if (!wasPaused) this.pause();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(MP4_EXPORT_WIDTH, MP4_EXPORT_HEIGHT, false);
    this.updateCamera(MP4_EXPORT_WIDTH / MP4_EXPORT_HEIGHT);
    try {
      return await exportCanvasToMp4({
        canvas: this.renderer.domElement,
        signal: options.signal,
        onProgress: options.onProgress,
        renderFrame: (timeSeconds) => {
          this.uniforms.uTime.value = timeSeconds;
          this.applyParams(interpolateExportParams(
            originalParams,
            animationTracks,
            exportAnimationProgress(timeSeconds),
          ), false);
          this.renderer.render(this.scene, this.camera);
        },
      });
    } finally {
      this.applyParams(originalParams, false);
      this.uniforms.uTime.value = oldTime;
      this.uniforms.uInvasion.value = oldInvasion;
      this.renderer.setPixelRatio(oldRatio);
      this.resize();
      if (!wasPaused) this.resume();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadSequence += 1;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.unbindPointerEvents();
    this.clearScene();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  private applyParams(params: DissolutionParams, rebuildParticles: boolean): void {
    this.uniforms.uInvasion.value = params.invasion;
    this.uniforms.uBandwidth.value = params.bandwidth;
    this.uniforms.uScatter.value = params.scatter;
    this.uniforms.uPointSize.value = params.pointSize;
    this.uniforms.uNoise.value = params.noise;
    this.uniforms.uMode.value = params.mode;
    this.uniforms.uWaveStr.value = params.waveStrength;
    this.uniforms.uWaveFreq.value = params.waveFrequency;
    this.uniforms.uEffect.value = params.effect;
    if (this.points) this.points.visible = params.effect === 0;
    if (rebuildParticles && this.imageCache) this.rebuildParticles();
  }

  private rebuildAll(cache: ImageCache): void {
    this.clearScene();
    this.imageCache = cache;
    this.imageAspect = cache.width / cache.height;
    this.texture = new THREE.CanvasTexture(cache.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;
    const geometry = new THREE.PlaneGeometry(this.imageAspect * 2, 2);
    const material = new THREE.ShaderMaterial({
      vertexShader: dissolutionPlaneVertexShader,
      fragmentShader: dissolutionPlaneFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: { ...this.uniforms, uTex: { value: this.texture } },
    });
    this.imageMesh = new THREE.Mesh(geometry, material);
    this.imageMesh.renderOrder = 0;
    this.group.add(this.imageMesh);
    this.rebuildParticles();
    this.resize();
  }

  private rebuildParticles(): void {
    if (!this.imageCache) return;
    if (this.points) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.points = null;
    }
    const { data, width, height } = this.imageCache;
    const mobile = window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
    const step = Math.max(this.params.sampleStep, mobile ? 2 : 1);
    const positions: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];
    const random: number[] = [];
    let candidate = 0;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const offset = (y * width + x) * 4;
        const red = data[offset] / 255;
        const green = data[offset + 1] / 255;
        const blue = data[offset + 2] / 255;
        const alpha = data[offset + 3] / 255;
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        if (alpha * luminance < 0.02) continue;
        positions.push((x / width * 2 - 1) * this.imageAspect, 1 - y / height * 2, 0);
        colors.push(red, green, blue);
        uvs.push(x / width, y / height);
        random.push(seededRandom(candidate));
        candidate += 1;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute("aUV", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute("aRnd", new THREE.Float32BufferAttribute(random, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: dissolutionParticleVertexShader,
      fragmentShader: dissolutionParticleFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: this.uniforms,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.renderOrder = 1;
    this.points.frustumCulled = false;
    this.points.visible = this.params.effect === 0;
    this.group.add(this.points);
    this.options.onParticleCountChange?.(positions.length / 3);
  }

  private clearScene(): void {
    if (this.points) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.points = null;
    }
    if (this.imageMesh) {
      this.group.remove(this.imageMesh);
      this.imageMesh.geometry.dispose();
      this.imageMesh.material.dispose();
      this.imageMesh = null;
    }
    this.texture?.dispose();
    this.texture = null;
    this.imageCache = null;
  }

  private resize = (): void => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.updateCamera(width / height);
  };

  private updateCamera(viewAspect: number): void {
    this.camera.aspect = viewAspect;
    this.camera.position.z = BASE_CAMERA_Z * Math.max(1, this.imageAspect / viewAspect) * 1.04;
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    if (this.paused || this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);
    const now = performance.now();
    const delta = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    if (this.preview) {
      this.updatePreview(now);
    } else {
      this.uniforms.uTime.value += delta;
    }
    if (!this.dragActive) {
      this.velocityX *= 0.88;
      this.velocityY *= 0.88;
    }
    this.rotationX = THREE.MathUtils.clamp(this.rotationX + this.velocityX, -0.7, 0.7);
    this.rotationY = THREE.MathUtils.clamp(this.rotationY + this.velocityY, -1, 1);
    this.group.rotation.x = this.rotationX;
    this.group.rotation.y = this.rotationY;
    this.renderer.render(this.scene, this.camera);
  };

  private updatePreview(now: number): void {
    const preview = this.preview;
    if (!preview || preview.state !== "playing") return;
    const elapsed = Math.min(MP4_EXPORT_SECONDS, preview.elapsed + (now - preview.startedAt) / 1000);
    this.uniforms.uTime.value = elapsed;
    this.applyParams(interpolateExportParams(
      preview.base,
      preview.tracks,
      elapsed / MP4_EXPORT_SECONDS,
    ), false);
    if (elapsed >= MP4_EXPORT_SECONDS) {
      preview.elapsed = MP4_EXPORT_SECONDS;
      preview.state = "ended";
      this.options.onPreviewStateChange?.("ended");
    }
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.dragActive = true;
    this.dragX = event.clientX;
    this.dragY = event.clientY;
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragActive) return;
    this.velocityY += (event.clientX - this.dragX) * 0.006;
    this.velocityX += (event.clientY - this.dragY) * 0.006;
    this.dragX = event.clientX;
    this.dragY = event.clientY;
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.dragActive = false;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
  };

  private bindPointerEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
  }

  private unbindPointerEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointercancel", this.onPointerUp);
  }
}
