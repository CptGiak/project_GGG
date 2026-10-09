import * as THREE from 'three';
import { BEAT_MS, SPOT, inSpot, spotPhase, spotSchedule, spotTarget, type SpotPhase, type SpotZone } from '../../shared/modes';
import type { Fighter } from './Fighter';
import type { Match } from './Match';

const COLUMN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const COLUMN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uPulse;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  // bright at the floor, fading up; rising bands and the beat pulse
  float fade = pow(1.0 - vUv.y, 1.6);
  float bands = 0.65 + 0.35 * step(0.5, fract(vUv.y * 6.0 - uTime * 0.9));
  float a = fade * bands * (0.55 + 0.45 * uPulse) * uOpacity;
  gl_FragColor = vec4(uColor * (1.4 + uPulse), a);
}
`;

function columnMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uTime: { value: 0 }, uPulse: { value: 0 }, uOpacity: { value: 1 } },
    vertexShader: COLUMN_VERT,
    fragmentShader: COLUMN_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

const NEUTRAL = new THREE.Color('#ffe7a3');
const CONTESTED = new THREE.Color('#ff2e4a');
const PREVIEW = new THREE.Color('#ffffff');

/** One spotlight in the world: light column, floor ring, sky beam. */
class ZoneVisual {
  readonly root = new THREE.Group();
  private column: THREE.Mesh;
  private ring: THREE.Mesh;
  private beam: THREE.Mesh;
  private colMat = columnMaterial();
  private beamMat = columnMaterial();
  private ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  zone: SpotZone | null = null;

  constructor() {
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48, 1, true), this.colMat);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 64), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    // spotlight from the sky: a tall cone, narrow at the top
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 1, 1, 32, 1, true), this.beamMat);
    this.root.add(this.column, this.ring, this.beam);
    this.root.visible = false;
    this.column.renderOrder = this.beam.renderOrder = 5;
  }

  set(z: SpotZone | null): void {
    this.zone = z;
    this.root.visible = !!z;
    if (!z) return;
    const [x, y, zz] = z.c;
    this.root.position.set(x, y, zz);
    this.column.scale.set(z.r, z.h, z.r);
    this.column.position.y = z.h / 2;
    this.ring.scale.setScalar(z.r);
    this.ring.position.y = 0.06;
    const sky = 70;
    this.beam.scale.set(z.r * 0.8, sky, z.r * 0.8);
    this.beam.position.y = sky / 2;
    // the beam is brightest at the top for this one (flip the gradient)
    this.beam.rotation.x = Math.PI;
  }

  update(t: number, pulse: number, color: THREE.Color, opacity: number, ring: number): void {
    for (const m of [this.colMat, this.beamMat]) {
      m.uniforms.uTime.value = t;
      m.uniforms.uPulse.value = pulse;
      (m.uniforms.uColor.value as THREE.Color).copy(color);
    }
    this.colMat.uniforms.uOpacity.value = opacity;
    this.beamMat.uniforms.uOpacity.value = opacity * 0.22;
    this.ringMat.color.copy(color).multiplyScalar(1.5 + pulse);
    this.ringMat.opacity = ring;
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.colMat.dispose();
    this.beamMat.dispose();
    this.ringMat.dispose();
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/**
 * RIFLETTORE runtime on the client: the zone schedule, scores (computed here in practice,
 * received from the server online), the 3D spotlights, the HUD panel and the off-screen marker.
 */
export class SpotMode {
  readonly schedule: SpotZone[];
  readonly scores = new Map<string, number>();
  /** ms since the match went live (practice: accumulated here; online: from the server clock) */
  timeMs = 0;
  beat = -1;
  phase: SpotPhase;
  owner: Fighter | null = null;
  contested = false;
  private live = new ZoneVisual();
  private next = new ZoneVisual();
  private pulse = 0;
  private panel: HTMLDivElement | null = null;
  private marker: HTMLDivElement | null = null;
  private lastHtml = '';
  private lastOwnerId: string | null = null;
  private ownerColor = new THREE.Color();
  private panelHud: unknown = null;

  /** `authoritative`: this client keeps the score (practice) */
  constructor(private m: Match, arena: string, seed: number, readonly authoritative: boolean) {
    this.schedule = spotSchedule(arena, seed);
    this.phase = spotPhase(this.schedule, -SPOT.warmupBeats);
    m.scene.add(this.live.root, this.next.root);
  }

  score(f: Fighter): number {
    return this.scores.get(f.id) ?? 0;
  }

  /** the zone bots should go for (and spawns keep away from) */
  objective(): SpotZone | null {
    return spotTarget(this.phase);
  }

  leader(): Fighter | null {
    let best: Fighter | null = null;
    let bestS = 0;
    for (const f of this.m.fighters) {
      const s = this.score(f);
      if (s > bestS) {
        bestS = s;
        best = f;
      }
    }
    return best;
  }

  update(dt: number): void {
    const m = this.m;
    if (this.authoritative && m.state === 'playing') this.timeMs += dt * 1000;
    const beat = Math.floor(this.timeMs / BEAT_MS);
    const prev = this.phase;
    this.phase = spotPhase(this.schedule, beat);
    if (this.phase.idx !== prev.idx) this.onSwitch(prev);
    if (beat !== this.beat) {
      const first = this.beat < 0;
      this.beat = beat;
      if (!first) this.onBeat();
    }
    this.pulse *= Math.exp(-dt * 6);
    this.updateVisuals();
    this.updateHud();
  }

  /** online: the server scored a beat */
  applyServer(own: string | null, contested: boolean, scores: Array<[string, number]>): void {
    for (const [id, s] of scores) this.scores.set(id, s);
    this.contested = contested;
    this.owner = own ? this.m.getFighter(own) ?? null : null;
    this.feedback();
  }

  private onBeat(): void {
    this.pulse = 1;
    const z = this.phase.zone;
    if (!this.authoritative) return;
    if (!z || this.m.state !== 'playing') {
      this.owner = null;
      this.contested = false;
      return;
    }
    const inside = this.m.fighters.filter((f) => f.alive && inSpot(z, f.pos.x, f.pos.y, f.pos.z));
    this.contested = inside.length > 1;
    this.owner = inside.length === 1 ? inside[0] : null;
    if (this.owner) {
      const s = this.score(this.owner) + (z.finale ? SPOT.finaleMult : 1);
      this.scores.set(this.owner.id, s);
      if (s >= SPOT.scoreToWin) this.m.end(this.owner);
    }
    this.feedback();
  }

  /** sounds and banners for the local player when the beat is scored */
  private feedback(): void {
    const m = this.m;
    const local = m.local;
    if (this.owner === local) m.audio.play('perfectTick', undefined, 0.35);
    const ownerId = this.owner?.id ?? null;
    if (ownerId !== this.lastOwnerId) {
      if (this.owner === local) m.hud?.banner('SOTTO I RIFLETTORI!', 'mode');
      else if (this.lastOwnerId === local.id && this.owner) m.hud?.banner(`${this.owner.name} TI RUBA LA SCENA`, 'alert');
      this.lastOwnerId = ownerId;
    }
  }

  private onSwitch(prev: SpotPhase): void {
    const m = this.m;
    const z = this.phase.zone;
    this.owner = null;
    this.contested = false;
    if (this.phase.over) {
      if (this.authoritative) m.end(this.leader());
      return;
    }
    if (!z) return;
    const at = new THREE.Vector3(z.c[0], z.c[1] + 0.2, z.c[2]);
    m.vfx.shockwave(at, z.r * 1.2, z.finale ? '#ffc94a' : '#ffffff');
    m.vfx.ring(at, new THREE.Vector3(0, 1, 0), '#ffe7a3', 0.5, z.r, 0.6);
    m.audio.play(z.finale ? 'chord' : 'alarm', undefined, 0.7);
    m.hud?.banner(z.finale ? `GRAN FINALE · ${z.name} · PUNTI X${SPOT.finaleMult}` : prev.idx < 0 ? `RIFLETTORE SU: ${z.name}` : `IL RIFLETTORE SI SPOSTA: ${z.name}`, 'mode');
  }

  private updateVisuals(): void {
    const p = this.phase;
    const t = this.m.time;
    if (this.live.zone !== p.zone) this.live.set(p.zone);
    if (this.next.zone !== p.next) this.next.set(p.next);
    if (p.zone) {
      let color = NEUTRAL;
      if (this.contested) color = Math.floor(t * 8) % 2 ? CONTESTED : NEUTRAL;
      else if (this.owner) color = this.ownerColor.set(this.owner.champ.colors[0]);
      // the last beats before a switch: the light flickers out
      const fading = p.next ? 0.45 + 0.55 * (Math.floor(t * 10) % 2) : 1;
      this.live.update(t, this.pulse, color, fading * this.camFade(p.zone), 0.9);
    }
    if (p.next) {
      const blink = 0.35 + 0.35 * Math.sin(t * 9);
      this.next.update(t, this.pulse * 0.5, PREVIEW, 0.35 * blink * this.camFade(p.next), blink);
    }
  }

  /** with the camera inside a column its walls would wash the whole view: thin them out */
  private camFade(z: SpotZone): number {
    const cam = this.m.cam.camera.position;
    if (cam.y > z.c[1] + z.h) return 1;
    const d = Math.hypot(cam.x - z.c[0], cam.z - z.c[2]);
    return 0.2 + 0.8 * THREE.MathUtils.clamp((d - z.r) / 3, 0, 1);
  }

  private updateHud(): void {
    const m = this.m;
    const hud = m.hud;
    if (!hud) return;
    if (this.panelHud !== hud) {
      // first frame, or the HUD was rebuilt (online champion swap)
      this.panel?.remove();
      this.marker?.remove();
      this.panelHud = hud;
      this.lastHtml = '';
      this.panel = document.createElement('div');
      this.panel.className = 'spot-panel';
      hud.modeBox.append(this.panel);
      this.marker = document.createElement('div');
      this.marker.className = 'spot-marker';
      this.marker.innerHTML = '<i></i><span></span>';
      hud.root.append(this.marker);
    }
    const p = this.phase;
    const me = m.local;
    const lead = this.leader();
    const mine = this.score(me);
    const best = lead ? this.score(lead) : 0;
    const zi = p.idx < 0 ? 0 : Math.min(p.idx + 1, this.schedule.length);
    const z = p.zone;
    let state = 'IN ARRIVO';
    let cls = 'wait';
    if (z) {
      if (this.contested) {
        state = 'CONTESO';
        cls = 'ctd';
      } else if (this.owner === me) {
        state = 'SEI SUL PALCO';
        cls = 'mine';
      } else if (this.owner) {
        state = esc(this.owner.name);
        cls = 'other';
      } else {
        state = 'LIBERO';
        cls = 'free';
      }
    }
    const nextTxt = p.next ? `<div class="sp-next">PROSSIMO: <b>${esc(p.next.name)}</b> · ${p.beatsLeft}</div>` : '';
    const pct = (s: number) => Math.min(100, (s / SPOT.scoreToWin) * 100).toFixed(1);
    const html = `<div class="sp-head"><b>RIFLETTORE</b><span>${z ? esc(z.name) : p.over ? 'FINE' : '—'}</span><em>${zi}/${this.schedule.length}${z?.finale ? ' · X2' : ''}</em></div>`
      + `<div class="sp-row me"><span>TU</span><i><u style="width:${pct(mine)}%"></u></i><b>${mine}</b></div>`
      + (lead && lead !== me ? `<div class="sp-row lead"><span>${esc(lead.name)}</span><i><u style="width:${pct(best)}%"></u></i><b>${best}</b></div>` : '')
      + `<div class="sp-state ${cls}">${state}</div>${nextTxt}`;
    if (html !== this.lastHtml) {
      this.panel!.innerHTML = html;
      this.lastHtml = html;
    }
    this.panel!.classList.toggle('pulse', this.pulse > 0.6);
    this.placeMarker(z ?? p.next, !z);
  }

  /** diamond over the zone, clamped to the screen edge when it is off-screen */
  private placeMarker(z: SpotZone | null, preview: boolean): void {
    const mk = this.marker!;
    const m = this.m;
    if (!z || !m.local.alive) {
      mk.style.display = 'none';
      return;
    }
    const cam = m.cam.camera;
    const p = new THREE.Vector3(z.c[0], z.c[1] + 2.2, z.c[2]);
    const dist = p.distanceTo(m.local.pos);
    const inside = inSpot(z, m.local.pos.x, m.local.pos.y, m.local.pos.z);
    if (inside) {
      mk.style.display = 'none';
      return;
    }
    const v = p.clone().project(cam);
    const behind = v.z > 1;
    let x = v.x;
    let y = v.y;
    if (behind) {
      x = -x;
      y = -y;
    }
    const off = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.86;
    if (off) {
      const k = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.86, 1e-3);
      x /= k;
      y /= k;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    mk.style.display = '';
    mk.style.transform = `translate(${(x * 0.5 + 0.5) * w}px, ${(-y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
    mk.classList.toggle('off', off);
    mk.classList.toggle('preview', preview);
    const span = mk.querySelector('span') as HTMLSpanElement;
    const txt = `${Math.round(dist)} m`;
    if (span.textContent !== txt) span.textContent = txt;
  }

  dispose(): void {
    this.m.scene.remove(this.live.root, this.next.root);
    this.live.dispose();
    this.next.dispose();
    this.panel?.remove();
    this.marker?.remove();
  }
}
