import * as THREE from 'three';
import { Engine } from './core/Engine';
import { setKeyLight, ToonEnv } from './render/toon';
import { buildVisual } from './champions';
import { FighterAnimator } from './fighter/FighterAnimator';

/**
 * Debug model viewer: /?viewer&champ=kaiser&anims=idle,run@0.25,atk1@0.13&cam=34&freeze=1
 * Renders one instance per anim spec side by side. Used for screenshot-driven iteration.
 */
export function startViewer(params: URLSearchParams): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  const engine = new Engine(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(params.get('bg') ?? '#2a1b33');
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.position.set(-4, 9, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  setKeyLight(sun);
  ToonEnv.rimColor.value.set(params.get('rim') ?? '#ff5a8a');
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshToonMaterial({ color: 0x3a2a44 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const champ = params.get('champ') ?? 'kaiser';
  const specs = (params.get('anims') ?? 'idle').split(',');
  const freeze = params.has('freeze');
  const spacing = Number(params.get('spacing') ?? 1.9);
  const yawDeg = Number(params.get('yaw') ?? 0);
  const animators: { a: FighterAnimator; spec: string }[] = [];
  specs.forEach((spec, i) => {
    const v = buildVisual(champ);
    v.root.position.x = (i - (specs.length - 1) / 2) * spacing;
    v.root.rotation.y = THREE.MathUtils.degToRad(yawDeg);
    scene.add(v.root);
    for (const o of v.worldObjects) scene.add(o);
    const a = new FighterAnimator(v);
    applySpec(a, spec, freeze);
    animators.push({ a, spec });
  });

  const camMode = params.get('cam') ?? '34';
  const dist = Number(params.get('dist') ?? 4.2 + specs.length * 1.2);
  const camY = Number(params.get('camy') ?? 1.15);
  const dirs: Record<string, [number, number]> = { front: [0, 1], side: [1, 0], back: [0, -1], '34': [0.55, 0.85], left: [-1, 0], top: [0.01, 0.3] };
  const [dx, dz] = dirs[camMode] ?? dirs['34'];
  cam.position.set(dx * dist, camY + (camMode === 'top' ? 4 : 0.15), dz * dist);
  cam.lookAt(0, camY - 0.05, 0);
  engine.setView(scene, cam);

  let t = 0;
  if (freeze) {
    for (let i = 0; i < 120; i++) for (const { a } of animators) a.update(1 / 60, false);
  }
  const loop = () => {
    const dt = 1 / 60;
    t += dt;
    if (!freeze) {
      for (const { a, spec } of animators) {
        if (spec.startsWith('run')) a.st.runPhase += dt * 9;
        if (!a.action.active && !['idle', 'run', 'air', 'fly', 'dash'].includes(spec.split('@')[0])) applySpec(a, spec, false);
        a.update(dt, false);
      }
    }
    engine.render(t);
    requestAnimationFrame(loop);
  };
  loop();
  (window as unknown as { __ready: boolean; __scene: THREE.Scene }).__scene = scene;
  (window as unknown as { __ready: boolean }).__ready = true;
}

function applySpec(a: FighterAnimator, spec: string, freeze: boolean): void {
  const [name, arg] = spec.split('@');
  const v = arg !== undefined ? Number(arg) : undefined;
  const st = a.st;
  switch (name) {
    case 'idle':
      st.time = v ?? 0;
      return;
    case 'run':
      st.wRun = 1;
      st.runIntensity = 1;
      st.runPhase = (v ?? 0) * Math.PI * 2;
      return;
    case 'air':
      st.wAir = 1;
      st.vy = v ?? 4;
      return;
    case 'fly':
      st.wFly = 1;
      st.swing = v ?? 0;
      return;
    case 'dash':
      st.wDash = 1;
      return;
    default:
      a.play(name, freeze ? { speed: 0, hold: true, fadeIn: 0, offset: v ?? 0 } : { offset: 0 });
  }
}
