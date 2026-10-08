/**
 * Keyboard + mouse input with pointer lock, edge detection and rebindable actions.
 */

export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'dash' | 'hookL' | 'hookR'
  | 'attack' | 'secondary' | 'ability' | 'ultimate'
  | 'scoreboard' | 'pause';

/** binding codes: KeyboardEvent.code, or 'Mouse0'..'Mouse4' */
export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  dash: ['ShiftLeft', 'ShiftRight'],
  hookL: ['KeyQ', 'Mouse3'],
  hookR: ['KeyE', 'Mouse4'],
  attack: ['Mouse0'],
  secondary: ['Mouse2'],
  ability: ['KeyF'],
  ultimate: ['KeyR'],
  scoreboard: ['Tab'],
  pause: ['Escape'],
};

export class Input {
  private down = new Set<string>();
  private pressedSet = new Set<string>();
  private releasedSet = new Set<string>();
  bindings: Record<Action, string[]> = structuredClone(DEFAULT_BINDINGS);
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** gameplay input enabled (disabled while menus are open) */
  enabled = true;
  sensitivity = 1;
  invertY = false;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (e.code === 'Tab' || e.code === 'Space' || (e.code.startsWith('Arrow') && this.locked)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedSet.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releasedSet.add(e.code);
    });
    window.addEventListener('blur', () => {
      for (const c of this.down) this.releasedSet.add(c);
      this.down.clear();
    });
    target.addEventListener('mousedown', (e) => {
      const c = `Mouse${e.button}`;
      if (!this.down.has(c)) this.pressedSet.add(c);
      this.down.add(c);
    });
    window.addEventListener('mouseup', (e) => {
      const c = `Mouse${e.button}`;
      this.down.delete(c);
      this.releasedSet.add(c);
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // guard against the occasional huge spike some browsers emit on lock
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      this.onLockChange?.(this.locked);
    });
  }

  requestLock(): void {
    if (document.pointerLockElement !== this.target) {
      const p = this.target.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** action held */
  held(a: Action): boolean {
    if (!this.enabled) return false;
    return this.bindings[a].some((c) => this.down.has(c));
  }

  pressed(a: Action): boolean {
    if (!this.enabled) return false;
    return this.bindings[a].some((c) => this.pressedSet.has(c));
  }

  released(a: Action): boolean {
    return this.bindings[a].some((c) => this.releasedSet.has(c));
  }

  /** raw key check (menus) */
  keyPressed(code: string): boolean {
    return this.pressedSet.has(code);
  }

  consumeMouse(): [number, number] {
    const d: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  endFrame(): void {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.wheel = 0;
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
