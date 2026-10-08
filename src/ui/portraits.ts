import * as THREE from 'three';
import { buildVisual } from '../champions';
import { FighterAnimator } from '../fighter/FighterAnimator';
import type { ChampionId } from '../../shared/champions';

const cache = new Map<ChampionId, string>();

const W = 720;
const H = 240;

/**
 * Renders a tight eye-level close-up of each champion (the Persona cut-in strip) into data URLs.
 * The shot is drawn into a corner of the game canvas and copied out right away, so call this
 * only right before a full-frame render (or while a loading screen covers the canvas).
 */
export function renderPortraits(renderer: THREE.WebGLRenderer, ids: readonly ChampionId[]): Map<ChampionId, string> {
  const out = new Map<ChampionId, string>();
  const canvas = renderer.domElement;
  if (canvas.width < W || canvas.height < H) return out;
  const prevViewport = renderer.getViewport(new THREE.Vector4());
  const prevScissor = renderer.getScissor(new THREE.Vector4());
  const prevScissorTest = renderer.getScissorTest();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const pr = renderer.getPixelRatio();
  const copy = document.createElement('canvas');
  copy.width = W;
  copy.height = H;
  const ctx = copy.getContext('2d');
  if (!ctx) return out;
  for (const id of ids) {
    const hit = cache.get(id);
    if (hit) {
      out.set(id, hit);
      continue;
    }
    try {
      const v = buildVisual(id);
      const anim = new FighterAnimator(v);
      for (let i = 0; i < 3; i++) anim.update(1 / 60, false);
      const scene = new THREE.Scene();
      scene.add(v.root);
      const key = new THREE.DirectionalLight(0xffffff, 3);
      scene.add(key, key.target);
      v.root.updateMatrixWorld(true);
      // frame the eyes straight on, whatever way the idle stance turns the head
      const head = v.rig.byName.head;
      const eye = new THREE.Vector3(0, 0.112, 0.06).applyMatrix4(head.matrixWorld);
      const fwd = new THREE.Vector3(0, 0, 1).transformDirection(head.matrixWorld);
      const up = new THREE.Vector3(0, 1, 0).transformDirection(head.matrixWorld);
      const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
      key.position.copy(eye).addScaledVector(fwd, 2).addScaledVector(up, 1.4).addScaledVector(right, -1.2);
      key.target.position.copy(eye);
      const cam = new THREE.PerspectiveCamera(16, W / H, 0.02, 5);
      cam.position.copy(eye).addScaledVector(fwd, 0.62);
      cam.up.copy(up);
      cam.lookAt(eye);
      renderer.setScissorTest(true);
      renderer.setViewport(0, 0, W / pr, H / pr);
      renderer.setScissor(0, 0, W / pr, H / pr);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, cam);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(canvas, 0, canvas.height - H, W, H, 0, 0, W, H);
      const url = copy.toDataURL('image/png');
      cache.set(id, url);
      out.set(id, url);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    } catch (e) {
      console.warn('portrait failed', id, e);
    }
  }
  renderer.setScissorTest(prevScissorTest);
  renderer.setViewport(prevViewport);
  renderer.setScissor(prevScissor);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.clear();
  return out;
}
