import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { PersonaFXShader } from '../render/PostFX';
import { ToonEnv } from '../render/toon';

export interface QualitySettings {
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  fxaa: boolean;
}

export const QUALITY_PRESETS: Record<'low' | 'medium' | 'high', QualitySettings> = {
  low: { pixelRatio: 0.75, shadows: false, shadowMapSize: 1024, bloom: false, fxaa: false },
  medium: { pixelRatio: 1, shadows: true, shadowMapSize: 2048, bloom: true, fxaa: true },
  high: { pixelRatio: 2, shadows: true, shadowMapSize: 4096, bloom: true, fxaa: true },
};

/** Renderer + post-processing chain. Scenes/cameras are swapped in by the app states. */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly renderPass: RenderPass;
  readonly bloom: UnrealBloomPass;
  readonly fx: ShaderPass;
  readonly fxaa: FXAAPass;
  scene: THREE.Scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
  quality: QualitySettings = QUALITY_PRESETS.medium;
  private width = 1;
  private height = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.5, 0.32, 1.45);
    this.composer.addPass(this.bloom);
    this.fx = new ShaderPass(PersonaFXShader);
    this.composer.addPass(this.fx);
    this.composer.addPass(new OutputPass());
    this.fxaa = new FXAAPass();
    this.composer.addPass(this.fxaa);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.renderer.shadowMap.enabled = q.shadows;
    this.bloom.enabled = q.bloom;
    this.fxaa.enabled = q.fxaa;
    this.resize();
    // materials must recompile when shadow support toggles
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
    });
  }

  setView(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.scene = scene;
    this.camera = camera;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    ToonEnv.resolution.value.set(w * pr, h * pr);
    this.fx.uniforms.uAspect.value = w / h;
    this.fx.uniforms.uResolution.value.set(w * pr, h * pr);
  }

  get aspect(): number {
    return this.width / this.height;
  }

  render(time: number): void {
    ToonEnv.time.value = time;
    this.fx.uniforms.uTime.value = time;
    this.composer.render();
  }
}
