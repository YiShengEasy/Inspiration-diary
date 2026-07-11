import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { ParticleParams, ParticleSource, QualityProfile } from "./types";
import {
  imagePlaneFragmentShader,
  imagePlaneVertexShader,
  particleFragmentShader,
  particleGlowFragmentShader,
  particleVertexShader,
} from "./shaders";

const EXPORT_SCALE_LIMIT = 3;

function createEdgeParticleGeometry(source: ParticleSource): THREE.BufferGeometry {
  const aspect = source.width / source.height;
  const positions: number[] = [];
  const colors: number[] = [];
  const depth: number[] = [];
  const random: number[] = [];

  for (let index = 0; index < source.particleCount; index += 1) {
    const offset = index * 3;
    const normalizedX = Math.abs(source.positions[offset]) / Math.max(aspect, 0.0001);
    const normalizedY = Math.abs(source.positions[offset + 1]);
    const edgeDistance = Math.max(normalizedX, normalizedY);
    const seed = source.random[index];
    if (edgeDistance < 0.68 || (edgeDistance < 0.82 && seed < 0.42)) continue;

    const outward = Math.max(0, edgeDistance - 0.68) * (0.55 + seed * 0.9);
    const length = Math.hypot(source.positions[offset] / Math.max(aspect, 0.0001), source.positions[offset + 1]) || 1;
    positions.push(
      source.positions[offset] + (source.positions[offset] / Math.max(aspect, 0.0001) / length) * outward * aspect,
      source.positions[offset + 1] + (source.positions[offset + 1] / length) * outward,
      source.positions[offset + 2],
    );
    colors.push(source.colors[offset], source.colors[offset + 1], source.colors[offset + 2]);
    depth.push(source.depth[index]);
    random.push(seed);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("aDepth", new THREE.Float32BufferAttribute(depth, 1));
  geometry.setAttribute("aRandom", new THREE.Float32BufferAttribute(random, 1));
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
  private readonly material: THREE.ShaderMaterial;
  private readonly glowMaterial: THREE.ShaderMaterial;
  private imagePlane: THREE.Mesh<THREE.BoxGeometry, THREE.Material[]> | null = null;
  private imageTexture: THREE.Texture | null = null;
  private points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private glowPoints: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
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

    this.material = new THREE.ShaderMaterial({
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      // Preserve the sampled image colors. Additive blending makes thousands
      // of nearby particles accumulate to white before Bloom is applied.
      blending: THREE.NormalBlending,
      uniforms: {
        uDepthStrength: { value: 2.4 }, uScatter: { value: 0.18 }, uDrift: { value: 0.12 },
        uTime: { value: 0 }, uProgress: { value: 0 }, uPointSize: { value: 1.4 },
      },
    });

    this.glowMaterial = new THREE.ShaderMaterial({
      vertexShader: particleVertexShader,
      fragmentShader: particleGlowFragmentShader,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uDepthStrength: { value: 2.4 }, uScatter: { value: 0.18 }, uDrift: { value: 0.12 },
        uTime: { value: 0 }, uProgress: { value: 0 }, uPointSize: { value: 2.1 },
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
    this.removePoints();
    const geometry = createEdgeParticleGeometry(source);
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.glowPoints = new THREE.Points(geometry, this.glowMaterial);
    this.glowPoints.frustumCulled = false;
    this.scene.add(this.glowPoints);
    this.startTime = performance.now();
    this.material.uniforms.uProgress.value = 0;
  }

  async setImageTexture(url: string | null, aspect = 1): Promise<void> {
    this.removeImagePlane();
    if (!url || this.disposed) return;
    const texture = await new THREE.TextureLoader().loadAsync(url);
    if (this.disposed) {
      texture.dispose();
      return;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    this.imageTexture = texture;
    const geometry = new THREE.BoxGeometry(aspect * 2, 2, 0.14);
    const frontMaterial = new THREE.ShaderMaterial({
      vertexShader: imagePlaneVertexShader,
      fragmentShader: imagePlaneFragmentShader,
      transparent: true,
      uniforms: { uImage: { value: texture } },
    });
    const sideMaterial = new THREE.MeshBasicMaterial({ color: 0x071116 });
    const backMaterial = new THREE.MeshBasicMaterial({ color: 0x020405 });
    this.imagePlane = new THREE.Mesh(geometry, [
      sideMaterial, sideMaterial, sideMaterial, sideMaterial, frontMaterial, backMaterial,
    ]);
    this.imagePlane.position.z = -0.02;
    this.imagePlane.renderOrder = -1;
    this.scene.add(this.imagePlane);
  }

  setParams(params: ParticleParams): void {
    this.params = params;
    this.scene.background = new THREE.Color(params.backgroundColor);
    this.material.uniforms.uDepthStrength.value = params.depthStrength;
    this.material.uniforms.uScatter.value = params.scatter;
    this.material.uniforms.uDrift.value = params.driftSpeed;
    this.material.uniforms.uPointSize.value = params.particleSize * this.profile.pixelRatio;
    this.glowMaterial.uniforms.uDepthStrength.value = params.depthStrength;
    this.glowMaterial.uniforms.uScatter.value = params.scatter * 1.12;
    this.glowMaterial.uniforms.uDrift.value = params.driftSpeed * 1.18;
    this.glowMaterial.uniforms.uPointSize.value = params.particleSize * this.profile.pixelRatio * 1.65;
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
    this.removeImagePlane();
    this.material.dispose();
    this.glowMaterial.dispose();
    this.bloomPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  private removePoints(): void {
    if (!this.points) return;
    this.scene.remove(this.points);
    if (this.glowPoints) this.scene.remove(this.glowPoints);
    this.points.geometry.dispose();
    this.points = null;
    this.glowPoints = null;
  }

  private removeImagePlane(): void {
    if (this.imagePlane) {
      this.scene.remove(this.imagePlane);
      this.imagePlane.geometry.dispose();
      new Set(this.imagePlane.material).forEach((material) => material.dispose());
      this.imagePlane = null;
    }
    this.imageTexture?.dispose();
    this.imageTexture = null;
  }

  private animate = (): void => {
    if (this.paused || this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);
    const now = performance.now();
    const delta = now - this.lastFrame;
    this.lastFrame = now;
    this.material.uniforms.uTime.value = (now - this.startTime) / 1000;
    this.material.uniforms.uProgress.value = Math.min(1, (now - this.startTime) / 1100);
    this.glowMaterial.uniforms.uTime.value = this.material.uniforms.uTime.value;
    this.glowMaterial.uniforms.uProgress.value = this.material.uniforms.uProgress.value;
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
