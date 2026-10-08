import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { CameraRig } from './CameraRig';
import type { Fighter } from './Fighter';
import type { CollisionWorld } from '../world/Collision';

const _fwd = new THREE.Vector3();

/** Maps keyboard/mouse + camera into the local fighter's intent. */
export class LocalController {
  constructor(readonly input: Input, readonly cam: CameraRig) {}

  update(f: Fighter, world: CollisionWorld): void {
    const inp = this.input;
    const it = f.intent;
    const [dx, dy] = inp.consumeMouse();
    if (inp.locked && inp.enabled) this.cam.rotate(dx, dy, inp.sensitivity, inp.invertY);
    it.move.set((inp.held('right') ? 1 : 0) - (inp.held('left') ? 1 : 0), (inp.held('forward') ? 1 : 0) - (inp.held('back') ? 1 : 0));
    if (it.move.lengthSq() > 1) it.move.normalize();
    it.aimYaw = this.cam.yaw;
    it.aimPitch = this.cam.pitch;
    // aim ray from the camera
    this.cam.forward(_fwd);
    it.aimDir.copy(_fwd);
    it.aimOrigin.copy(this.cam.camera.position);
    // push the ray origin to the fighter's depth so walls behind the player never catch it
    const toPlayer = new THREE.Vector3().subVectors(f.pos, it.aimOrigin).dot(_fwd);
    if (toPlayer > 0) it.aimOrigin.addScaledVector(_fwd, Math.max(0, toPlayer - 0.5));
    void world;
    const edge = (a: Parameters<Input['pressed']>[0]) => inp.pressed(a);
    it.jump = inp.held('jump');
    it.jumpPressed = it.jumpPressed || edge('jump');
    it.dashPressed = it.dashPressed || edge('dash');
    it.hookL = inp.held('hookL');
    it.hookLPressed = it.hookLPressed || edge('hookL');
    it.hookR = inp.held('hookR');
    it.hookRPressed = it.hookRPressed || edge('hookR');
    it.attack = inp.held('attack');
    it.attackPressed = it.attackPressed || edge('attack');
    it.secondary = inp.held('secondary');
    it.secondaryPressed = it.secondaryPressed || edge('secondary');
    it.secondaryReleased = it.secondaryReleased || inp.released('secondary');
    it.abilityPressed = it.abilityPressed || edge('ability');
    it.ultimatePressed = it.ultimatePressed || edge('ultimate');
  }
}
