import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { ParticleParams, ParticleSource, QualityProfile } from "./types";
import {
  imageSurfaceFragmentShader,
  imageSurfaceVertexShader,
  particleFragmentShader,
  particleVertexShader,
} from "./shaders";
import {
  exportCanvasToMp4,
  MP4_EXPORT_HEIGHT,
  MP4_EXPORT_WIDTH,
} from "./particleVideoExporter";
import { dissolveDirectionToUniform, effectModeToUniform } from "./effectModes";

const EXPORT_SCALE_LIMIT = 3;
type ImageSurface = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function hash2d(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise(x: number, y: number): number {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const fractionX = x - cellX;
  const fractionY = y - cellY;
  const smoothX = fractionX * fractionX * (3 - 2 * fractionX);
  const smoothY = fractionY * fractionY * (3 - 2 * fractionY);
  const top = THREE.MathUtils.lerp(hash2d(cellX, cellY), hash2d(cellX + 1, cellY), smoothX);
  const bottom = THREE.MathUtils.lerp(hash2d(cellX, cellY + 1), hash2d(cellX + 1, cellY + 1), smoothX);
  return THREE.MathUtils.lerp(top, bottom, smoothY);
}

function createImageSurface(source: ParticleSource): ImageSurface {
  const aspect = source.width / source.height;
  const segmentsX = Math.min(160, Math.max(40, Math.round(source.width / 8)));
  const segmentsY = Math.min(160, Math.max(40, Math.round(source.height / 8)));
  const geometry = new THREE.PlaneGeometry(aspect * 2, 2, segmentsX, segmentsY);
  const imageTexture = new THREE.DataTexture(
    source.imageRgba,
    source.width,
    source.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  imageTexture.colorSpace = THREE.SRGBColorSpace;
  imageTexture.flipY = true;
  imageTexture.needsUpdate = true;

  const depthBytes = new Uint8Array(source.depthMap.length);
  for (let index = 0; index < source.depthMap.length; index += 1) {
    depthBytes[index] = Math.round(clamp01(source.depthMap[index]) * 255);
  }
  const depthTexture = new THREE.DataTexture(
    depthBytes,
    source.width,
    source.height,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  depthTexture.flipY = true;
  depthTexture.needsUpdate = true;

  const contentBytes = new Uint8Array(source.contentMap.length);
  for (let index = 0; index < source.contentMap.length; index += 1) {
    contentBytes[index] = Math.round(clamp01(source.contentMap[index]) * 255);
  }
  const contentTexture = new THREE.DataTexture(
    contentBytes,
    source.width,
    source.height,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  contentTexture.flipY = true;
  contentTexture.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    vertexShader: imageSurfaceVertexShader,
    fragmentShader: imageSurfaceFragmentShader,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    uniforms: {
      uImage: { value: imageTexture },
      uDepthMap: { value: depthTexture },
      uContentMask: { value: contentTexture },
      uDepthStrength: { value: 1.6 },
      uBrightnessThreshold: { value: 0.04 },
      uAlphaThreshold: { value: 0.05 },
      uTime: { value: 0 },
      uLoopDuration: { value: 5 },
      uProgress: { value: 0 },
      uExit: { value: 0 },
      uWaveStrength: { value: 0.026 },
      uWaveScale: { value: 2.6 },
      uWaveSpeed: { value: 0.35 },
      uInvasionRange: { value: 0.38 },
      uEdgeSoftness: { value: 0.24 },
      uIrregularity: { value: 0.32 },
      uNoiseScale: { value: 3.4 },
      uEffectMode: { value: 0 },
      uDissolveDirection: { value: 0 },
      uDissolveProgress: { value: 0.46 },
      uDissolveBandwidth: { value: 0.24 },
    },
  });
  const surface = new THREE.Mesh(geometry, material);
  surface.renderOrder = 0;
  surface.frustumCulled = false;
  return surface;
}

function disposeImageSurface(surface: ImageSurface): void {
  (surface.material.uniforms.uImage.value as THREE.Texture).dispose();
  (surface.material.uniforms.uDepthMap.value as THREE.Texture).dispose();
  (surface.material.uniforms.uContentMask.value as THREE.Texture).dispose();
  surface.geometry.dispose();
  surface.material.dispose();
}

function createDissolveParticleGeometry(source: ParticleSource): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const depth: number[] = [];
  const random: number[] = [];
  const scale: number[] = [];
  const opacity: number[] = [];
  const dissolve: number[] = [];
  const edge: number[] = [];
  const content: number[] = [];
  const boundary: number[] = [];
  const uvs: number[] = [];
  const aspect = source.width / source.height;
  const candidateStep = Math.max(1, Math.floor(source.particleCount / 60_000));

  for (let index = 0; index < source.particleCount; index += candidateStep) {
    const offset = index * 3;
    const seed = source.random[index];
    const luminance = source.colors[offset] * 0.2126
      + source.colors[offset + 1] * 0.7152
      + source.colors[offset + 2] * 0.0722;
    const contentWeight = source.content[index] ?? 0;
    const boundaryWeight = source.boundary[index] ?? 0;
    const edgeWeight = source.edge[index] ?? 0;
    const dissolveWeight = clamp01(1 - contentWeight);
    const selectionNoise = hash2d(index * 0.73 + 5.1, index * 1.37 - 9.4);
    const keepChance = clamp01(
      0.3
      + boundaryWeight * 0.58
      + edgeWeight * 0.42
      + contentWeight * 0.3,
    );
    if (contentWeight < 0.012 && edgeWeight < 0.04 && boundaryWeight < 0.03) continue;
    if (selectionNoise > keepChance) continue;

    const jitterAmount = 0.002 + dissolveWeight * 0.018;
    const jitterX = (Math.sin(seed * 928.31) - 0.5) * jitterAmount;
    const jitterY = (Math.sin(seed * 417.17 + 1.7) - 0.5) * jitterAmount;
    positions.push(
      source.positions[offset] + jitterX,
      source.positions[offset + 1] + jitterY,
      source.positions[offset + 2],
    );
    colors.push(
      source.colors[offset],
      source.colors[offset + 1],
      source.colors[offset + 2],
    );
    depth.push(source.depth[index]);
    random.push(seed);
    scale.push(
      ((0.7 + seed * 0.18) * (1 - dissolveWeight)
        + (seed > 0.982 ? 1.2 + seed * 0.62 : 0.48 + seed * 0.36) * dissolveWeight)
      * (1 + edgeWeight * 0.42),
    );
    opacity.push(Math.min(1, 0.6 + boundaryWeight * 0.42 + luminance * 0.12 + edgeWeight * 0.28));
    dissolve.push(dissolveWeight);
    edge.push(edgeWeight);
    content.push(contentWeight);
    boundary.push(boundaryWeight);
    uvs.push(
      clamp01(source.positions[offset] / (aspect * 2) + 0.5),
      clamp01(source.positions[offset + 1] / 2 + 0.5),
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("aDepth", new THREE.Float32BufferAttribute(depth, 1));
  geometry.setAttribute("aRandom", new THREE.Float32BufferAttribute(random, 1));
  geometry.setAttribute("aScale", new THREE.Float32BufferAttribute(scale, 1));
  geometry.setAttribute("aOpacity", new THREE.Float32BufferAttribute(opacity, 1));
  geometry.setAttribute("aDissolve", new THREE.Float32BufferAttribute(dissolve, 1));
  geometry.setAttribute("aEdge", new THREE.Float32BufferAttribute(edge, 1));
  geometry.setAttribute("aContent", new THREE.Float32BufferAttribute(content, 1));
  geometry.setAttribute("aBoundary", new THREE.Float32BufferAttribute(boundary, 1));
  geometry.setAttribute("aUv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

export class ParticleRenderer {
  private readonly container: HTMLElement;
  private readonly profile: QualityProfile;
  private readonly onPerformanceMode?: (reduced: boolean) => void;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly scene = new THREE.Scene();
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly particleMaterial: THREE.ShaderMaterial;
  private imageSurface: ImageSurface | null = null;
  private exitingSurface: ImageSurface | null = null;
  private particlePoints: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private exitingPoints: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private exitStartedAt = 0;
  private params: ParticleParams | null = null;
  private animationFrame = 0;
  private paused = false;
  private disposed = false;
  private startTime = performance.now();
  private lastFrame = this.startTime;
  private slowFrames = 0;
  private reduced = false;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, profile: QualityProfile, onPerformanceMode?: (reduced: boolean) => void) {
    this.container = container;
    this.profile = profile;
    this.onPerformanceMode = onPerformanceMode;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(profile.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
    this.camera.position.set(0, 0, 5.2);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 10;

    this.particleMaterial = new THREE.ShaderMaterial({
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uDepthStrength: { value: 2.4 }, uScatter: { value: 0.18 }, uDrift: { value: 0.12 },
        uTime: { value: 0 }, uLoopDuration: { value: 5 }, uProgress: { value: 0 }, uExit: { value: 0 },
        uPointSize: { value: 2.1 }, uDensity: { value: 0.78 },
        uWaveStrength: { value: 0.026 }, uWaveScale: { value: 2.6 }, uWaveSpeed: { value: 0.5 },
        uInvasionRange: { value: 0.38 }, uEdgeSoftness: { value: 0.24 }, uIrregularity: { value: 0.32 },
        uNoiseScale: { value: 3.4 }, uOuterDispersion: { value: 0.7 }, uColorRetention: { value: 0.82 },
        uInnerCrossStrength: { value: 0.72 },
        uEffectMode: { value: 0 }, uDissolveDirection: { value: 0 },
        uDissolveProgress: { value: 0.46 }, uDissolveBandwidth: { value: 0.24 },
      },
    });

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.15, 0.65, 0.08);
    this.composer.addPass(this.bloomPass);

    this.renderer.domElement.addEventListener("dblclick", this.resetCamera);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    this.resize();
    this.animate();
  }

  setSource(source: ParticleSource): void {
    this.beginCurrentExit();
    this.imageSurface = createImageSurface(source);
    this.scene.add(this.imageSurface);
    const geometry = createDissolveParticleGeometry(source);
    this.particlePoints = new THREE.Points(geometry, this.particleMaterial);
    this.particlePoints.frustumCulled = false;
    this.particlePoints.renderOrder = 1;
    this.scene.add(this.particlePoints);
    this.startTime = performance.now();
    this.particleMaterial.uniforms.uProgress.value = 0;
    this.particleMaterial.uniforms.uExit.value = 0;
    if (this.params) this.applySurfaceParams(this.imageSurface, this.params);
  }

  setParams(params: ParticleParams): void {
    this.params = params;
    this.scene.background = new THREE.Color(params.backgroundColor);
    this.particleMaterial.uniforms.uDepthStrength.value = params.depthStrength;
    this.particleMaterial.uniforms.uScatter.value = params.scatter;
    this.particleMaterial.uniforms.uDrift.value = params.driftSpeed;
    this.particleMaterial.uniforms.uPointSize.value = params.particleSize * this.profile.pixelRatio * 1.15;
    this.particleMaterial.uniforms.uDensity.value = params.density;
    this.particleMaterial.uniforms.uWaveStrength.value = params.waveStrength;
    this.particleMaterial.uniforms.uWaveScale.value = params.waveScale;
    this.particleMaterial.uniforms.uWaveSpeed.value = params.waveSpeed;
    this.particleMaterial.uniforms.uInvasionRange.value = params.invasionRange;
    this.particleMaterial.uniforms.uEdgeSoftness.value = params.edgeSoftness;
    this.particleMaterial.uniforms.uIrregularity.value = params.irregularity;
    this.particleMaterial.uniforms.uNoiseScale.value = params.noiseScale;
    this.particleMaterial.uniforms.uOuterDispersion.value = params.outerDispersion;
    this.particleMaterial.uniforms.uColorRetention.value = params.colorRetention;
    this.particleMaterial.uniforms.uInnerCrossStrength.value = params.innerCrossStrength;
    this.particleMaterial.uniforms.uEffectMode.value = effectModeToUniform(params.effectMode);
    this.particleMaterial.uniforms.uDissolveDirection.value = dissolveDirectionToUniform(params.dissolveDirection);
    this.particleMaterial.uniforms.uDissolveProgress.value = params.dissolveProgress;
    this.particleMaterial.uniforms.uDissolveBandwidth.value = params.dissolveBandwidth;
    if (this.imageSurface) this.applySurfaceParams(this.imageSurface, params);
    this.bloomPass.strength = params.bloomStrength * (this.reduced ? 0.55 : 1);
    this.bloomPass.radius = params.bloomRadius;
    this.bloomPass.threshold = params.bloomThreshold;
    this.controls.autoRotate = params.autoRotate;
    this.controls.autoRotateSpeed = params.rotationSpeed * 2;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(direction, params.cameraDistance);
    this.controls.update();
  }

  resetCamera = (): void => {
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, 0, this.params?.cameraDistance ?? 5.2);
    this.camera.up.set(0, 1, 0);
    this.controls.update();
  };

  resize = (): void => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width * this.profile.bloomScale, height * this.profile.bloomScale);
  };

  async exportPng(scale = 1): Promise<Blob> {
    const safeScale = Math.min(EXPORT_SCALE_LIMIT, Math.max(1, scale));
    const oldRatio = this.renderer.getPixelRatio();
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(oldRatio * safeScale);
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width * safeScale, height * safeScale);
    this.composer.render();
    const blob = await new Promise<Blob | null>((resolve) => this.renderer.domElement.toBlob(resolve, "image/png"));
    this.renderer.setPixelRatio(oldRatio);
    this.resize();
    if (!blob) throw new Error("无法导出当前粒子画面");
    return blob;
  }

  async exportMp4(options: {
    onProgress?: (completedFrames: number, totalFrames: number) => void;
    signal?: AbortSignal;
  } = {}): Promise<Blob> {
    if (!this.imageSurface || !this.particlePoints) throw new Error("请先上传图片并等待粒子生成完成");
    const wasPaused = this.paused;
    const previewTime = this.particleMaterial.uniforms.uTime.value as number;
    const oldRatio = this.renderer.getPixelRatio();
    const oldAspect = this.camera.aspect;
    const oldPosition = this.camera.position.clone();
    const oldQuaternion = this.camera.quaternion.clone();
    const oldTarget = this.controls.target.clone();
    const controlsEnabled = this.controls.enabled;
    const autoRotate = this.controls.autoRotate;
    if (!wasPaused) this.pause();
    this.removeExitingContent();
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(MP4_EXPORT_WIDTH, MP4_EXPORT_HEIGHT, false);
    this.composer.setSize(MP4_EXPORT_WIDTH, MP4_EXPORT_HEIGHT);
    this.camera.aspect = MP4_EXPORT_WIDTH / MP4_EXPORT_HEIGHT;
    this.camera.updateProjectionMatrix();
    try {
      return await exportCanvasToMp4({
        canvas: this.renderer.domElement,
        renderFrame: (timeSeconds) => {
          this.setAnimationTime(timeSeconds, 1);
          this.composer.render();
        },
        onProgress: options.onProgress,
        signal: options.signal,
      });
    } finally {
      this.renderer.setPixelRatio(oldRatio);
      this.camera.aspect = oldAspect;
      this.camera.position.copy(oldPosition);
      this.camera.quaternion.copy(oldQuaternion);
      this.controls.target.copy(oldTarget);
      this.controls.enabled = controlsEnabled;
      this.controls.autoRotate = autoRotate;
      this.camera.updateProjectionMatrix();
      this.setAnimationTime(previewTime, 1);
      this.startTime = performance.now() - previewTime * 1000;
      this.resize();
      if (!wasPaused) this.resume();
    }
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("dblclick", this.resetCamera);
    this.controls.dispose();
    this.removePoints();
    this.particleMaterial.dispose();
    this.bloomPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  private removePoints(): void {
    if (this.imageSurface) {
      this.scene.remove(this.imageSurface);
      disposeImageSurface(this.imageSurface);
      this.imageSurface = null;
    }
    if (this.particlePoints) {
      this.scene.remove(this.particlePoints);
      this.particlePoints.geometry.dispose();
      this.particlePoints = null;
    }
    this.removeExitingContent();
  }

  private beginCurrentExit(): void {
    this.removeExitingContent();
    if (this.imageSurface) {
      this.imageSurface.material.uniforms.uProgress.value = 1;
      this.imageSurface.material.uniforms.uExit.value = 0;
      this.exitingSurface = this.imageSurface;
      this.imageSurface = null;
    }
    if (this.particlePoints) {
      const exitingMaterial = this.particleMaterial.clone();
      exitingMaterial.uniforms.uProgress.value = 1;
      exitingMaterial.uniforms.uExit.value = 0;
      this.particlePoints.material = exitingMaterial;
      this.exitingPoints = this.particlePoints;
      this.particlePoints = null;
    }
    if (!this.exitingSurface && !this.exitingPoints) return;
    this.exitStartedAt = performance.now();
  }

  private removeExitingContent(): void {
    if (this.exitingSurface) {
      this.scene.remove(this.exitingSurface);
      disposeImageSurface(this.exitingSurface);
      this.exitingSurface = null;
    }
    if (this.exitingPoints) {
      this.scene.remove(this.exitingPoints);
      this.exitingPoints.geometry.dispose();
      this.exitingPoints.material.dispose();
      this.exitingPoints = null;
    }
  }

  private applySurfaceParams(surface: ImageSurface, params: ParticleParams): void {
    surface.material.uniforms.uDepthStrength.value = params.depthStrength;
    surface.material.uniforms.uBrightnessThreshold.value = params.brightnessThreshold;
    surface.material.uniforms.uAlphaThreshold.value = params.alphaThreshold;
    surface.material.uniforms.uWaveStrength.value = params.waveStrength;
    surface.material.uniforms.uWaveScale.value = params.waveScale;
    surface.material.uniforms.uWaveSpeed.value = params.waveSpeed;
    surface.material.uniforms.uInvasionRange.value = params.invasionRange;
    surface.material.uniforms.uEdgeSoftness.value = params.edgeSoftness;
    surface.material.uniforms.uIrregularity.value = params.irregularity;
    surface.material.uniforms.uNoiseScale.value = params.noiseScale;
    surface.material.uniforms.uEffectMode.value = effectModeToUniform(params.effectMode);
    surface.material.uniforms.uDissolveDirection.value = dissolveDirectionToUniform(params.dissolveDirection);
    surface.material.uniforms.uDissolveProgress.value = params.dissolveProgress;
    surface.material.uniforms.uDissolveBandwidth.value = params.dissolveBandwidth;
  }

  private setAnimationTime(seconds: number, progress: number): void {
    this.particleMaterial.uniforms.uTime.value = seconds;
    this.particleMaterial.uniforms.uProgress.value = progress;
    if (this.imageSurface) {
      this.imageSurface.material.uniforms.uTime.value = seconds;
      this.imageSurface.material.uniforms.uProgress.value = progress;
    }
  }

  private animate = (): void => {
    if (this.paused || this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);
    const now = performance.now();
    const delta = now - this.lastFrame;
    this.lastFrame = now;
    const elapsed = (now - this.startTime) / 1000;
    this.setAnimationTime(elapsed, Math.min(1, elapsed / 1.1));
    if (this.exitingPoints || this.exitingSurface) {
      const exitProgress = Math.min(1, (now - this.exitStartedAt) / 850);
      if (this.exitingPoints) {
        this.exitingPoints.material.uniforms.uTime.value = (now - this.exitStartedAt) / 1000;
        this.exitingPoints.material.uniforms.uExit.value = exitProgress;
      }
      if (this.exitingSurface) {
        this.exitingSurface.material.uniforms.uTime.value = (now - this.exitStartedAt) / 1000;
        this.exitingSurface.material.uniforms.uExit.value = exitProgress;
      }
      if (exitProgress >= 1) this.removeExitingContent();
    }
    this.controls.update();
    this.composer.render();
    this.trackPerformance(delta);
  };

  private trackPerformance(deltaMs: number): void {
    if (deltaMs > 1000 / 30) this.slowFrames += 1;
    else this.slowFrames = Math.max(0, this.slowFrames - 2);
    if (!this.reduced && this.slowFrames >= 120) {
      this.reduced = true;
      this.renderer.setPixelRatio(Math.min(1, this.profile.pixelRatio));
      this.bloomPass.strength *= 0.55;
      this.resize();
      this.onPerformanceMode?.(true);
    }
  }
}
