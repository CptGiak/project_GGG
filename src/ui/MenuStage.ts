import * as THREE from 'three';
import { CHAMPION_IDS, CHAMPIONS, type ChampionId } from '../../shared/champions';
import { buildVisual, championAvailable } from '../champions';
import type { ChampionVisual } from '../champions/types';
import { FighterAnimator } from '../fighter/FighterAnimator';
import { groundMaterial, skyMaterial } from '../world/materials';
import { setKeyLight, ToonEnv } from '../render/toon';
import { SlashTrail } from '../vfx/Trails';

const PREVIEWS: Record<ChampionId, string[]> = {
  kaiser: ['taunt', 'atk1', 'atk2', 'atk3', 'dive', 'ultSlam'],
  nova: ['taunt', 'c1', 'c2', 'c3', 'c4', 'air', 'phantom'],
  rex: ['taunt', 'aim', 'charge', 'throw', 'ult'],
  sera: ['taunt', 'cast', 'wave', 'ult', 'cast'],
  akali: ['taunt', 'c1', 'c2', 'c3', 'fan', 'flip', 'air'],
  qiyana: ['taunt', 'c1', 'c2', 'wrath', 'audacity', 'air'],
  locke: ['taunt', 'c1', 'c2', 'c3', 'c4', 'nails', 'pursuit'],
};

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
`;
const BEAM_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uIntensity;
void main() {
  float a = pow( vUv.y, 1.6 ) * 0.5 * uIntensity;
  float edge = sin( vUv.x * 3.14159 * 2.0 ) * 0.5 + 0.5;
  gl_FragColor = vec4( uColor * a * ( 0.6 + 0.4 * edge ), a );
}
`;

interface StageChamp {
  id: ChampionId;
  visual: ChampionVisual;
  anim: FighterAnimator;
  home: THREE.Vector3;
  nextPreview: number;
  previewIdx: number;
  trails: SlashTrail[];
  beam: THREE.Mesh;
}

/** 3D backdrop for the menus: the champions on a concert stage under spotlights. */
export class MenuStage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 500);
  private champs = new Map<ChampionId, StageChamp>();
  private lineup: ChampionId[] = [];
  /** lineup width relative to the original four (camera distance scale) */
  private spread = 1;
  private mode: 'lineup' | 'select' = 'lineup';
  private focus: ChampionId = 'kaiser';
  private camPos = new THREE.Vector3(0, 1.6, 9);
  private camLook = new THREE.Vector3(0, 1.1, 0);
  private t = 0;
  private sun: THREE.DirectionalLight;
  private pedestalRing: THREE.Mesh;

  constructor() {
    this.scene.background = new THREE.Color(0x14040a);
    this.scene.fog = new THREE.Fog(0x14040a, 14, 60);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 24, 12), skyMaterial({ top: 0x0a0208, mid: 0x2a0410, horizon: 0x8a0a20, moon: 0xffe0e0, moonDir: new THREE.Vector3(-0.5, 0.35, -0.8), moonSize: 0.09 }));
    this.scene.add(sky);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), groundMaterial({ color: 0x1a0710, line: 0xe5191c, pattern: 'stage', scale: 1.4, glow: 1.2, rim: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.position.set(-3, 8, 7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -8;
    sc.right = 8;
    sc.top = 8;
    sc.bottom = -8;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    // pedestal ring for the focused champion
    this.pedestalRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(2), transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    this.pedestalRing.rotation.x = -Math.PI / 2;
    this.pedestalRing.position.y = 0.02;
    this.scene.add(this.pedestalRing);

    const ids = CHAMPION_IDS.filter(championAvailable);
    this.lineup = ids;
    const mid = (ids.length - 1) / 2;
    // four in a row; more get closer, staggered in depth, and the lineup camera backs off
    const step = ids.length <= 4 ? 1.75 : 1.15;
    this.spread = ids.length <= 4 ? 1 : ((ids.length - 1) * step) / (3 * 1.75) + 0.08;
    ids.forEach((id, i) => {
      const visual = buildVisual(id);
      const anim = new FighterAnimator(visual);
      const home = new THREE.Vector3((i - mid) * step, 0, i % 2 ? (ids.length <= 4 ? -0.6 : -0.9) : 0);
      visual.root.position.copy(home);
      visual.root.rotation.y = -0.15 * (i - mid);
      this.scene.add(visual.root);
      for (const o of visual.worldObjects) this.scene.add(o);
      const trails = visual.blades.map((b) => {
        const t = new SlashTrail(b.colorA, b.colorB, 2.4);
        this.scene.add(t.mesh);
        return t;
      });
      const beamMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(CHAMPIONS[id].colors[0]) }, uIntensity: { value: 1 } },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 1.3, 9, 24, 1, true), beamMat);
      beam.position.set(home.x, 4.5, home.z);
      this.scene.add(beam);
      this.champs.set(id, { id, visual, anim, home, nextPreview: 1.5 + i * 0.9, previewIdx: 0, trails, beam });
    });
  }

  activate(): void {
    setKeyLight(this.sun);
    ToonEnv.shade.value.set(0.62, 0.46, 0.74);
    ToonEnv.lit.value.set(1, 0.96, 0.95);
    ToonEnv.rimColor.value.set(0xff4060);
  }

  setLineup(): void {
    this.mode = 'lineup';
  }

  setFocus(id: ChampionId): void {
    this.mode = 'select';
    if (this.focus !== id) {
      const c = this.champs.get(id);
      if (c) {
        // greet with the taunt, then cycle the moves
        c.nextPreview = 0.35;
        c.previewIdx = 0;
        c.anim.st.time = 0;
      }
    }
    this.focus = id;
  }

  /** play a flashy preview clip now (on champion selection) */
  showOff(id: ChampionId): void {
    const c = this.champs.get(id);
    if (c) c.nextPreview = 0;
  }

  update(dt: number, aspect: number): void {
    this.t += dt;
    const t = this.t;
    for (const c of this.champs.values()) {
      const focused = this.mode === 'select' && c.id === this.focus;
      const visible = this.mode === 'lineup' || focused;
      c.visual.root.visible = visible;
      for (const o of c.visual.worldObjects) o.visible = visible;
      (c.beam.material as THREE.ShaderMaterial).uniforms.uIntensity.value = visible ? (focused ? 1.3 : 0.8) : 0;
      if (!visible) continue;
      // placement
      const target = focused ? new THREE.Vector3(0, 0, 0) : c.home;
      c.visual.root.position.lerp(target, 1 - Math.exp(-dt * 6));
      c.beam.position.set(c.visual.root.position.x, 4.5, c.visual.root.position.z);
      const yaw = focused ? Math.sin(t * 0.35) * 0.45 + 0.2 : -0.12 * (this.lineup.indexOf(c.id) - (this.lineup.length - 1) / 2);
      c.visual.root.rotation.y += (yaw - c.visual.root.rotation.y) * (1 - Math.exp(-dt * 3));
      // preview clips
      c.nextPreview -= dt;
      if (c.nextPreview <= 0) {
        const list = PREVIEWS[c.id] ?? ['taunt'];
        const name = list[c.previewIdx % list.length];
        c.previewIdx++;
        c.anim.play(name, { fadeIn: 0.08 });
        const clipLen = c.visual.anims.clips[name]?.duration ?? 1;
        c.nextPreview = focused ? Math.max(2.4, clipLen + 0.4) : 3.5 + Math.random() * 2.5;
        if ((c.id === 'rex' || c.id === 'sera') && name !== 'taunt') c.anim.st.aim = 1;
      }
      if (!c.anim.action.active) c.anim.st.aim *= Math.exp(-dt * 3);
      c.anim.update(dt, false);
      for (const ev of c.anim.action.events) {
        if (ev === 'swing' || ev === 'hitOn') c.trails.forEach((tr) => (tr.emitting = true));
        if (ev === 'hitOff') c.trails.forEach((tr) => (tr.emitting = false));
      }
      c.anim.action.events.length = 0;
      if (!c.anim.action.active) c.trails.forEach((tr) => (tr.emitting = false));
      c.visual.blades.forEach((b, i) => c.trails[i].update(t, b.base, b.tip));
      c.visual.tick(dt, t, 0.6);
    }
    this.pedestalRing.visible = this.mode === 'select';
    // camera
    let pos: THREE.Vector3;
    let look: THREE.Vector3;
    if (this.mode === 'lineup') {
      const a = Math.sin(t * 0.12) * 0.18 - 0.12;
      const k = this.spread;
      pos = new THREE.Vector3(Math.sin(a) * 10 * k - 2.6 * k, 1.8 + (k - 1) * 0.8, Math.cos(a) * 10 * k);
      look = new THREE.Vector3(-2.6 * k, 1.05, 0);
    } else {
      pos = new THREE.Vector3(0.2, 1.35, 5.3);
      look = new THREE.Vector3(0.05, 1.0, 0);
    }
    this.camPos.lerp(pos, 1 - Math.exp(-dt * 3));
    this.camLook.lerp(look, 1 - Math.exp(-dt * 3));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    if (Math.abs(this.camera.aspect - aspect) > 1e-3) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    const ring = this.pedestalRing.material as THREE.MeshBasicMaterial;
    ring.color.set(CHAMPIONS[this.focus].colors[0]).multiplyScalar(2.2);
  }
}
