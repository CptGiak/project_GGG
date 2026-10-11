import * as THREE from 'three';

const _t = new THREE.Vector3();

/**
 * 0..1: how much the viewer at `camPos` looks down a shot from behind (`dir` = the way the shot
 * travels; `sign = -1` when `dir` is a hit normal pointing back at the shooter). 1 for the
 * shooter's own third-person camera (or a teammate right behind), 0 for side and enemy views.
 * Seen from behind, a shot's cast glow, face-on rings, sparks and the glow on the target all pile
 * up on the crosshair: scale those layers by it (decided once at emit time; effects are short).
 */
export function alongView(camPos: THREE.Vector3, at: THREE.Vector3, dir: THREE.Vector3, sign = 1): number {
  _t.subVectors(at, camPos);
  const d = _t.length();
  return d < 1e-3 ? 1 : THREE.MathUtils.smoothstep((sign * _t.dot(dir)) / d, 0.85, 0.97);
}

/**
 * A spark direction around `dir` (the hit normal or travel, `bias` toward it). In the own view
 * (`own` from alongView) 85 % of the along-view component is removed, so the sparks fan out across
 * the screen around the target instead of flying at the camera and blooming into a ball.
 */
export function sprayDir(out: THREE.Vector3, dir: THREE.Vector3, bias: number, own: number): THREE.Vector3 {
  const u = Math.random() * 2 - 1;
  const t = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  out.set(s * Math.cos(t), u, s * Math.sin(t)).addScaledVector(dir, bias * (1 - own));
  out.addScaledVector(dir, -out.dot(dir) * 0.85 * own);
  return out.normalize();
}

/**
 * Like alongView, but either way along the line of fire: the shooter behind the shot AND the
 * target in front of it (its own body fills the screen). Use it for impact layers.
 */
export function lineView(camPos: THREE.Vector3, at: THREE.Vector3, dir: THREE.Vector3): number {
  _t.subVectors(at, camPos);
  const d = _t.length();
  return d < 1e-3 ? 1 : THREE.MathUtils.smoothstep(Math.abs(_t.dot(dir)) / d, 0.85, 0.97);
}
