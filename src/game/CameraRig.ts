import * as THREE from 'three';
import type { CollisionWorld } from '../world/Collision';
import type { Fighter } from './Fighter';

const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

/**
 * Third-person over-the-shoulder camera. Mouse controls yaw/pitch directly (no aim lag); the
 * pivot follows the fighter with a slight spring in the air to sell speed. FOV widens with
 * speed and pulls in while zooming (charged shots).
 */
export class CameraRig {
  yaw = 0;
  pitch = -0.1;
  readonly camera: THREE.PerspectiveCamera;
  readonly pivot = new THREE.Vector3();
  baseFov = 74;
  distance = 4.3;
  shoulder = 0.85;
  height = 0.28;
  zoom = 0;
  private trauma = 0;
  private fov = 74;
  private dist = 4.3;
  private initialized = false;
  private shakeT = 0;
  /** death / spectate orbit */
  orbit = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.08, 1400);
    this.camera.rotation.order = 'YXZ';
  }

  addTrauma(t: number): void {
    this.trauma = Math.min(1, this.trauma + t);
  }

  rotate(dx: number, dy: number, sensitivity: number, invertY: boolean): void {
    const k = 0.0022 * sensitivity * (1 - this.zoom * 0.55);
    this.yaw -= dx * k;
    this.pitch -= dy * k * (invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.35);
  }

  /** forward direction of the view (aim) */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  snapTo(f: Fighter): void {
    this.pivot.copy(f.pos).setY(f.pos.y + 1.55);
    this.yaw = f.facing;
    this.initialized = true;
  }

  update(dt: number, f: Fighter, world: CollisionWorld): void {
    _target.copy(f.pos);
    _target.y += 1.55;
    if (!this.initialized) this.snapTo(f);
    // follow: tight on the ground, slightly springy in flight
    const speed = f.speed;
    const follow = f.grounded ? 30 : THREE.MathUtils.lerp(26, 17, Math.min(1, speed / 50));
    this.pivot.lerp(_target, 1 - Math.exp(-follow * dt));
    if (this.pivot.distanceToSquared(_target) > 100) this.pivot.copy(_target);

    // distance & fov react to speed
    const sp = THREE.MathUtils.clamp((speed - 8) / 45, 0, 1);
    const targetDist = (this.distance + sp * 0.8 + (this.orbit ? 3 : 0)) * (1 - this.zoom * 0.45);
    this.dist += (targetDist - this.dist) * (1 - Math.exp(-6 * dt));
    const targetFov = this.baseFov + sp * 12 - this.zoom * 34;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-5 * dt));

    this.forward(_fwd);
    _right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    _up.crossVectors(_right, _fwd).normalize();
    const shoulder = this.shoulder * (1 - this.zoom * 0.2);
    _desired.copy(this.pivot).addScaledVector(_fwd, -this.dist).addScaledVector(_right, shoulder).addScaledVector(_up, this.height);

    // collision: cast from pivot to desired position
    _dir.subVectors(_desired, this.pivot);
    const len = _dir.length();
    _dir.divideScalar(len);
    const hit = world.raycast(this.pivot, _dir, len + 0.3);
    if (hit) _desired.copy(this.pivot).addScaledVector(_dir, Math.max(0.3, hit.distance - 0.3));

    // shake
    this.shakeT += dt;
    const shake = this.trauma * this.trauma;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const sx = (noise(this.shakeT * 31) * 0.5) * shake;
    const sy = (noise(this.shakeT * 29 + 7) * 0.5) * shake;
    const sr = (noise(this.shakeT * 23 + 13) * 0.08) * shake;

    this.camera.position.copy(_desired);
    this.camera.rotation.set(this.pitch + sy * 0.12, this.yaw + Math.PI + sx * 0.12, sr, 'YXZ');
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

function noise(t: number): number {
  return Math.sin(t * 1.0) * 0.5 + Math.sin(t * 2.3 + 1.3) * 0.3 + Math.sin(t * 4.7 + 2.1) * 0.2;
}
