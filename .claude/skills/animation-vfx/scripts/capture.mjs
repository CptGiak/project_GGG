#!/usr/bin/env node
/**
 * Deterministic frame capture for PROJECT GGG (or any three.js page driven by requestAnimationFrame).
 *
 * The page runs on a VIRTUAL CLOCK: performance.now() and requestAnimationFrame are replaced so every
 * advance(n) steps exactly n frames of 1/60 s, and Math.random is seeded. The same scenario therefore
 * renders the same frames every run — before/after comparisons are honest.
 *
 * Needs the dev server: `npm run dev` (http://localhost:5173). Chromium renders through SwiftShader.
 *
 * USAGE
 *   node capture.mjs still   "<query>" out.png [--size 1280x720]
 *   node capture.mjs viewer  "<viewer query>" --frames 0-48/3 --out DIR [--sheet] [--onion] [--gif] [--mp4]
 *   node capture.mjs scenario path/to/scenario.mjs --out DIR [--size 1280x720]
 *
 *   <query> is the URL query without "?", e.g. "viewer&champ=rex&anims=single&cam=front&yaw=90".
 *   --frames A-B/S   frames A..B (inclusive) every S frames, counted from page start (60 fps)
 *   --seed N         Math.random seed (default 1337)
 *   --url URL        default http://localhost:5173
 *   --keep-ui        keep the DOM HUD in play captures (hidden by default)
 *
 * SCENARIOS (real match, real kits, real VFX) — a module exporting `default async (lab) => {}`:
 *   await lab.open('champ=rex&arena=stage&bots=1')   // practice match, countdown skipped
 *   await lab.dummy({ distance: 12 })                  // bot 0 frozen, immortal, in front of you
 *   await lab.camera({ mode: 'side', dist: 7 })       // side | front34 | behind | target | top | game | {pos,look}
 *   await lab.place({ x: 40, z: 6, look: [0, 6] })     // respawn yourself on open floor
 *   await lab.ready()                                  // cooldowns to 0, ultimate full
 *   await lab.press('skill') / lab.hold('secondary') / lab.release('secondary')
 *   await lab.advance(10)
 *   await lab.film('lead-single', { frames: 40, every: 2, sheet: true, gif: true })
 *   await lab.shot('name')                             // single PNG
 *   await lab.eval((ctx) => { ... })                    // runs in the page; ctx = { app, match, local, dummy, THREE }
 * Actions: attack (RMB) · skill (LMB signature) · secondary (C) · ability (F) · ultimate (R) · jump · dash · taunt
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadPlaywright() {
  const tries = [process.cwd() + '/', '/opt/node22/lib/node_modules/', HERE + '/'];
  for (const base of tries) {
    try {
      return createRequire(base)('playwright');
    } catch {
      /* next */
    }
  }
  const g = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' }).stdout.trim();
  return createRequire(g + '/')('playwright');
}

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const nxt = argv[i + 1];
      if (nxt === undefined || nxt.startsWith('--')) opt[k] = true;
      else {
        opt[k] = nxt;
        i++;
      }
    } else pos.push(a);
  }
  return { pos, opt };
}

/** Installed before any page script: virtual clock + seeded Math.random. */
function initScript(seed) {
  let vt = 0;
  const queue = [];
  let s = seed >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  performance.now = () => vt;
  window.requestAnimationFrame = (cb) => {
    queue.push(cb);
    return queue.length;
  };
  window.cancelAnimationFrame = () => {};
  window.__vclock = {
    advance(n = 1, stepMs = 1000 / 60) {
      for (let i = 0; i < n; i++) {
        vt += stepMs;
        const cbs = queue.splice(0, queue.length);
        for (const cb of cbs) {
          try {
            cb(vt);
          } catch (e) {
            console.error('frame error', e && e.stack ? e.stack : e);
          }
        }
      }
      return vt;
    },
    get t() {
      return vt;
    },
  };
}

function parseFrames(spec) {
  const m = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(spec ?? '0-60/4');
  if (!m) throw new Error(`bad --frames "${spec}" (use A-B/S)`);
  const out = [];
  for (let f = Number(m[1]); f <= Number(m[2]); f += Number(m[3] ?? 1)) out.push(f);
  return out;
}

function sizeOf(s, def = [1280, 720]) {
  if (!s || s === true) return def;
  const [w, h] = String(s).split('x').map(Number);
  return [w || def[0], h || def[1]];
}

function runPy(args) {
  const r = spawnSync('python3', [path.join(HERE, 'contact_sheet.py'), ...args], { encoding: 'utf8' });
  if (r.status !== 0) console.error(r.stderr || r.stdout);
  else if (r.stdout.trim()) console.log(r.stdout.trim());
}

function encode(dir, name, fps, kind) {
  const files = fs.readdirSync(dir).filter((f) => /^f\d+\.png$/.test(f)).sort();
  if (!files.length) return;
  const list = path.join(dir, 'frames.txt');
  fs.writeFileSync(list, files.map((f) => `file '${path.join(dir, f)}'\nduration ${1 / fps}`).join('\n') + `\nfile '${path.join(dir, files[files.length - 1])}'\n`);
  const out = path.join(dir, `${name}.${kind}`);
  const vf = kind === 'gif' ? 'scale=min(720\\,iw):-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3' : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  const args = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', vf];
  if (kind === 'mp4') args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(fps));
  args.push(out);
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status !== 0) console.error(r.stderr);
  else console.log('wrote', out);
}

class Lab {
  constructor(browser, opt) {
    this.browser = browser;
    this.opt = opt;
    this.url = opt.url && opt.url !== true ? opt.url : 'http://localhost:5173';
    this.seed = Number(opt.seed ?? 1337);
    this.out = path.resolve(opt.out && opt.out !== true ? opt.out : 'captures');
    this.size = sizeOf(opt.size);
    this.frame = 0;
    fs.mkdirSync(this.out, { recursive: true });
  }

  async page() {
    if (this._page) return this._page;
    const [w, h] = this.size;
    const page = await this.browser.newPage({ viewport: { width: w, height: h } });
    await page.addInitScript(initScript, this.seed);
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}]`, m.text());
    });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    this._page = page;
    return page;
  }

  async advance(n = 1) {
    const page = await this.page();
    await page.evaluate((k) => window.__vclock.advance(k), n);
    this.frame += n;
  }

  /** viewer page (no match): ?viewer&... */
  async openViewer(query) {
    const page = await this.page();
    await page.goto(`${this.url}/?${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000, polling: 100 });
    this.frame = 0;
  }

  /** practice match with a scripted controller (lab) */
  async open(query) {
    const page = await this.page();
    await page.goto(`${this.url}/?play&${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window.__app && window.__app.match), null, { timeout: 120000, polling: 100 });
    await page.evaluate((keepUi) => {
      const app = window.__app;
      const m = app.match;
      const T = window.__THREE;
      if (!keepUi) {
        const ui = document.getElementById('ui');
        if (ui) ui.style.visibility = 'hidden';
      }
      m.countdown = 0.001;
      const L = (window.__lab = { held: new Set(), pressed: new Set(), released: new Set(), move: new T.Vector2(), dummy: null, aimAt: null, cam: null });
      const fwd = new T.Vector3();
      const chest = new T.Vector3();
      m.controller.update = (f) => {
        const it = f.intent;
        it.move.copy(L.move);
        if (L.dummy) {
          L.dummy.hp = L.dummy.maxHp;
          L.dummy.vel.set(0, L.dummy.vel.y, 0);
        }
        const target = L.aimAt ?? (L.dummy ? L.dummy.chest(new T.Vector3()) : null);
        if (target) {
          f.chest(chest);
          chest.y += 0.35;
          fwd.subVectors(target, chest).normalize();
          m.cam.yaw = Math.atan2(fwd.x, fwd.z);
          m.cam.pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y)));
        } else m.cam.forward(fwd);
        it.aimYaw = m.cam.yaw;
        it.aimPitch = m.cam.pitch;
        m.cam.forward(fwd);
        it.aimDir.copy(fwd);
        it.aimOrigin.copy(f.pos).setY(f.pos.y + 1.9).addScaledVector(fwd, -0.5);
        const A = ['jump', 'dash', 'hookL', 'hookR', 'skill', 'attack', 'secondary', 'ability', 'ultimate', 'taunt'];
        for (const a of A) {
          const held = L.held.has(a);
          if (a in it) it[a] = held;
          const pk = `${a}Pressed`;
          if (pk in it) it[pk] = it[pk] || L.pressed.has(a);
        }
        it.secondaryReleased = it.secondaryReleased || L.released.has('secondary');
        L.pressed.clear();
        L.released.clear();
      };
      // the lab camera, when set, renders instead of the game camera
      const camRig = m.cam;
      const origUpdate = camRig.update.bind(camRig);
      camRig.update = (dt, f, world) => {
        origUpdate(dt, f, world);
        if (L.cam) L.cam.place();
      };
    }, !!this.opt['keep-ui']);
    await this.advance(3);
  }

  /** respawn yourself on the floor at (x, z), facing `yaw` degrees (0 = +Z) or toward `look` [x, z] */
  async place({ x = 0, z = 0, yaw, look } = {}) {
    const page = await this.page();
    await page.evaluate(({ x, z, yaw, look }) => {
      const m = window.__app.match;
      const T = window.__THREE;
      const me = m.local;
      const at = new T.Vector3(x, 60, z);
      const hit = m.world.raycast(at, new T.Vector3(0, -1, 0), 120);
      at.y = hit ? hit.point.y : 0.5;
      const a = look ? Math.atan2(look[0] - x, look[1] - z) : ((yaw ?? 0) * Math.PI) / 180;
      me.spawn(at, a);
      me.spawnProtect = 0;
      m.cam.snapTo(me);
    }, { x, z, yaw, look });
    await this.advance(2);
  }

  async dummy({ distance = 12, side = 0, height = 0, champ, freeze = true } = {}) {
    const page = await this.page();
    await page.evaluate(({ distance, side, height, freeze }) => {
      const m = window.__app.match;
      const T = window.__THREE;
      const me = m.local;
      const bot = m.bots[0];
      if (!bot) throw new Error('no bot: open the match with bots=1');
      if (freeze) bot.think = () => {};
      const f = bot.f;
      const yaw = me.facing;
      const fw = new T.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const rt = new T.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
      const at = me.pos.clone().addScaledVector(fw, distance).addScaledVector(rt, side);
      // stand it on whatever floor is under that spot
      const hit = m.world.raycast(at.clone().setY(at.y + 12), new T.Vector3(0, -1, 0), 40);
      if (hit) at.y = hit.point.y;
      at.y += height;
      // neutral intent: nothing held (a bot frozen mid-swing would keep its hooks pulling)
      const it = f.intent;
      it.move.set(0, 0);
      for (const k of Object.keys(it)) if (typeof it[k] === 'boolean') it[k] = false;
      f.spawn(at, yaw + Math.PI);
      f.spawnProtect = 0;
      me.spawnProtect = 0;
      window.__lab.dummy = f;
    }, { distance, side, height, freeze });
    void champ;
    await this.advance(2);
  }

  /**
   * Lab camera. Modes are framed on the line from you to the dummy (or your facing):
   * side (profile, sees the shot travel) · front34 · behind · target (at the dummy, looking back) · top · game
   * or { pos: [x, y, z], look: [x, y, z] } in the aim frame (x right, y up, z toward the target, origin at your feet)
   */
  async camera(spec = { mode: 'side' }) {
    const page = await this.page();
    await page.evaluate((spec) => {
      const app = window.__app;
      const m = app.match;
      const T = window.__THREE;
      const L = window.__lab;
      if (spec.mode === 'game') {
        L.cam = null;
        app.engine.setView(m.scene, m.cam.camera);
        return;
      }
      const cam = new T.PerspectiveCamera(spec.fov ?? 40, app.engine.aspect, 0.05, 2000);
      const me = m.local;
      const dist = spec.dist ?? 7;
      const h = spec.height ?? 1.3;
      L.cam = {
        place() {
          const tgt = L.dummy ? L.dummy.pos : null;
          const fw = new T.Vector3();
          if (tgt) fw.subVectors(tgt, me.pos).setY(0);
          if (!tgt || fw.lengthSq() < 1e-4) fw.set(Math.sin(me.facing), 0, Math.cos(me.facing));
          fw.normalize();
          const rt = new T.Vector3().crossVectors(fw, new T.Vector3(0, 1, 0)).negate();
          const span = tgt ? me.pos.distanceTo(tgt) : 8;
          const at = (x, y, z) => me.pos.clone().addScaledVector(rt, x).add(new T.Vector3(0, y, 0)).addScaledVector(fw, z);
          let pos;
          let look;
          if (spec.pos) {
            pos = at(...spec.pos);
            look = at(...(spec.look ?? [0, 1.1, 0]));
          } else if (spec.mode === 'front34') {
            pos = at(dist * 0.55, h, dist * 0.85);
            look = at(0, h - 0.25, 0);
          } else if (spec.mode === 'behind') {
            pos = at(0.9, h + 0.5, -dist * 0.6);
            look = at(0, h, span * 0.5);
          } else if (spec.mode === 'target') {
            pos = at(1.2, h + 0.2, span - 2.5);
            look = at(0, h - 0.1, 0);
          } else if (spec.mode === 'side-wide') {
            // shooter and target both in frame
            const half = span / 2 + 1.6;
            const d = spec.dist ?? half / Math.tan((((spec.fov ?? 40) / 2) * Math.PI) / 180) / Math.max(1, app.engine.aspect) * 1.05;
            pos = at(-d, h, span / 2);
            look = at(0, h - 0.2, span / 2);
          } else if (spec.mode === 'top') {
            pos = at(0, dist * 1.4, span * 0.35);
            look = at(0, 0, span * 0.36);
          } else {
            // side: profile of the shooter (shooter left of centre, the shot travelling right)
            const lead = spec.lead ?? Math.min(span * 0.3, dist * 0.35);
            pos = at(-dist, h, lead);
            look = at(0, h - 0.15, lead);
          }
          cam.position.copy(pos);
          cam.lookAt(look);
        },
      };
      app.engine.setView(m.scene, cam);
      L.cam.place();
    }, spec);
  }

  /** zero every cooldown and fill the ultimate meter */
  async ready() {
    const page = await this.page();
    await page.evaluate(() => {
      const me = window.__app.match.local;
      if (me.kit && me.kit.cd) for (const k of Object.keys(me.kit.cd)) me.kit.cd[k] = 0;
      me.ult = 1;
    });
  }

  async press(action) {
    const page = await this.page();
    await page.evaluate((a) => window.__lab.pressed.add(a), action);
  }
  async hold(action) {
    const page = await this.page();
    await page.evaluate((a) => {
      window.__lab.held.add(a);
      window.__lab.pressed.add(a);
    }, action);
  }
  async release(action) {
    const page = await this.page();
    await page.evaluate((a) => {
      window.__lab.held.delete(a);
      window.__lab.released.add(a);
    }, action);
  }
  async move(x, y) {
    const page = await this.page();
    await page.evaluate(([x, y]) => window.__lab.move.set(x, y), [x, y]);
  }

  async eval(fn, arg) {
    const page = await this.page();
    return page.evaluate(
      ([src, a]) => {
        const app = window.__app;
        const ctx = { app, match: app?.match, local: app?.match?.local, dummy: window.__lab?.dummy, THREE: window.__THREE, lab: window.__lab };
        // eslint-disable-next-line no-new-func
        return new Function('ctx', 'arg', `return (${src})(ctx, arg);`)(ctx, a);
      },
      [fn.toString(), arg],
    );
  }

  async shot(name) {
    const page = await this.page();
    const file = path.join(this.out, name.endsWith('.png') ? name : `${name}.png`);
    await page.screenshot({ path: file });
    console.log('wrote', file);
    return file;
  }

  /**
   * Plays `frames` frames, saving every `every`-th. Writes DIR/<name>/fNNNN.png and, on request,
   * <name>_sheet.png (grid with frame labels), <name>_onion.png (tinted overlay), <name>.gif / .mp4.
   */
  async film(name, { frames = 30, every = 2, sheet = true, onion = false, gif = false, mp4 = false, cols, crop, fps } = {}) {
    const page = await this.page();
    const dir = path.join(this.out, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const start = this.frame;
    const saved = [];
    // frame 1 is the first frame simulated after the call (a press made just before lands on it)
    for (let i = 1; i <= frames; i++) {
      await this.advance(1);
      if ((i - 1) % every === 0) {
        const file = path.join(dir, `f${String(i).padStart(4, '0')}.png`);
        await page.screenshot({ path: file });
        saved.push(file);
      }
    }
    console.log(`film ${name}: ${saved.length} frames (${start}..${this.frame}) -> ${dir}`);
    const common = ['--every', String(every), '--start', '0'];
    if (crop) common.push('--crop', crop);
    if (sheet) runPy([...common, '--cols', String(cols ?? Math.min(6, saved.length)), '--out', path.join(this.out, `${name}_sheet.png`), ...saved]);
    if (onion) runPy([...common, '--onion', '--out', path.join(this.out, `${name}_onion.png`), ...saved]);
    const rate = fps ?? Math.round(60 / every);
    if (gif) encode(dir, name, rate, 'gif');
    if (mp4) encode(dir, name, rate, 'mp4');
    return saved;
  }
}

async function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const [mode, a, b] = pos;
  if (!mode || opt.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
    return;
  }
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const lab = new Lab(browser, opt);
  try {
    if (mode === 'still') {
      await lab.openViewer(a);
      await lab.advance(Number(opt.warm ?? 30));
      const out = path.resolve(b ?? 'still.png');
      await (await lab.page()).screenshot({ path: out });
      console.log('wrote', out);
    } else if (mode === 'viewer') {
      await lab.openViewer(a);
      const frames = parseFrames(opt.frames);
      const name = opt.name && opt.name !== true ? opt.name : 'viewer';
      const dir = path.join(lab.out, name);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const page = await lab.page();
      const saved = [];
      for (const f of frames) {
        if (f > lab.frame) await lab.advance(f - lab.frame);
        const file = path.join(dir, `f${String(f).padStart(4, '0')}.png`);
        await page.screenshot({ path: file });
        saved.push(file);
      }
      console.log(`viewer ${name}: ${saved.length} frames -> ${dir}`);
      const every = frames.length > 1 ? frames[1] - frames[0] : 1;
      const common = ['--every', String(every), '--start', String(frames[0])];
      if (opt.crop) common.push('--crop', opt.crop);
      if (opt.sheet || (!opt.onion && !opt.gif && !opt.mp4)) runPy([...common, '--cols', String(opt.cols ?? Math.min(6, saved.length)), '--out', path.join(lab.out, `${name}_sheet.png`), ...saved]);
      if (opt.onion) runPy([...common, '--onion', '--out', path.join(lab.out, `${name}_onion.png`), ...saved]);
      if (opt.gif) encode(dir, name, Math.round(60 / every), 'gif');
      if (opt.mp4) encode(dir, name, Math.round(60 / every), 'mp4');
    } else if (mode === 'scenario') {
      const mod = await import(pathToFileURL(path.resolve(a)).href);
      await mod.default(lab);
    } else {
      throw new Error(`unknown mode ${mode}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
