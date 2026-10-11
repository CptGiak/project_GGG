/**
 * Dev-only offline renders (never imported by the game): tools drive these from a headless browser
 * to check levels and spectra and to export listening previews.
 */
import { pluck, drive, filter, midiHz, normalize, mixInto } from './dsp';

export interface Rendered {
  channels: Float32Array[];
  sampleRate: number;
  info?: unknown;
}

export async function guitarTest(): Promise<Rendered> {
  const sr = 48000;
  const out = new Float32Array(sr * 4);
  let at = 0;
  for (const [root, mute] of [[40, false], [40, true], [40, true], [43, false], [45, false], [38, true]] as const) {
    const ch = new Float32Array(Math.floor(sr * 0.7));
    [0, 7, 12].forEach((iv, k) => mixInto(ch, pluck(sr, { freq: midiHz(root + iv), dur: 0.7, t60: 3, damp: 0.35, pickPos: 0.14, bright: 0.85, muteAt: mute ? 0.11 : undefined, seed: 7 + k }), 0.5, k * 200));
    filter(ch, sr, ['highpass', 110, 0.7]);
    drive(ch, 18, 0.12);
    filter(ch, sr, ['highpass', 85, 0.7], ['peaking', 480, 1.2, -5], ['peaking', 2400, 1, 4], ['lowpass', 5200, 0.8], ['lowpass', 7000, 0.6]);
    mixInto(out, ch, 0.6, Math.floor(at * sr));
    at += mute ? 0.18 : 0.6;
  }
  normalize(out, 0.8);
  return { channels: [out], sampleRate: sr };
}

async function offline(seconds: number, build: (ctx: OfflineAudioContext) => void, sr = 48000): Promise<Rendered> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  build(ctx);
  const buf = await ctx.startRendering();
  return { channels: [buf.getChannelData(0), buf.getChannelData(1)], sampleRate: sr };
}

export async function drumKit(): Promise<Rendered> {
  const { SampleBank } = await import('./samples');
  const ids = ['kick', 'kick', 'snare', 'snare', 'snareRim', 'ghost', 'clap', 'hat', 'hat', 'hatOpen', 'tom1', 'tom2', 'tom3', 'tom4', 'crash', 'china', 'ride', 'rideBell', 'splash', 'taiko', 'gong'] as const;
  return offline(ids.length * 0.6 + 4, (ctx) => {
    const bank = new SampleBank(ctx);
    ids.forEach((id, i) => {
      const s = ctx.createBufferSource();
      s.buffer = bank.drum(id);
      s.connect(ctx.destination);
      s.start(i * 0.6);
    });
  });
}

export async function guitarBank(): Promise<Rendered> {
  const { SampleBank } = await import('./samples');
  return offline(6, (ctx) => {
    const bank = new SampleBank(ctx);
    const seq: Array<[number, 'open' | 'mute' | 'single' | 'lead', number]> = [
      [40, 'open', 0], [40, 'mute', 0.6], [40, 'mute', 0.75], [40, 'mute', 0.9], [43, 'open', 1.05], [45, 'open', 1.5],
      [40, 'mute', 2.1], [40, 'mute', 2.25], [46, 'open', 2.4], [45, 'open', 2.85], [64, 'lead', 3.3],
    ];
    for (const [root, art, at] of seq) {
      const s = ctx.createBufferSource();
      s.buffer = bank.guitar(root, art);
      const g = ctx.createGain();
      g.gain.value = 0.7;
      s.connect(g).connect(ctx.destination);
      s.start(at);
      if (art === 'open' && at < 3) s.stop(at + 0.45);
    }
    [28, 28, 31, 33, 28, 34, 33].forEach((m, i) => {
      const s = ctx.createBufferSource();
      s.buffer = bank.bass(m);
      s.connect(ctx.destination);
      s.start(i * 0.3);
      s.stop(i * 0.3 + 0.28);
    });
  });
}

/** a stretch of a song through the full music chain (optionally switching to the climax) */
export async function song(o: { id: string; seconds: number; intensity?: number; climaxAt?: number; skip?: string[]; warm?: boolean; at?: number }): Promise<Rendered> {
  const { Graph } = await import('./graph');
  const { SampleBank } = await import('./samples');
  const { MusicPlayer } = await import('./music');
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(o.seconds * sr), sr);
  const g = new Graph(ctx);
  const bank = new SampleBank(ctx);
  const master = g.gain(0.9);
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -3;
  lim.ratio.value = 16;
  lim.attack.value = 0.002;
  lim.release.value = 0.12;
  master.connect(lim).connect(ctx.destination);
  const m = new MusicPlayer(g, bank, master);
  m.intensity = o.intensity ?? 0.6;
  for (const k of o.skip ?? []) m.skip.add(k);
  const w0 = performance.now();
  if (o.warm) {
    m.prewarm(o.id);
    await m.ready();
  }
  const warmMs = performance.now() - w0;
  m.start(o.id);
  if (o.at) m.seek(o.at);
  // schedule just in time, like the live clock: suspend the render every half second, add the
  // next notes, resume (scheduling everything up front bloats the graph)
  let scheduleMs = 0;
  const step = 0.5;
  for (let t = 0; t < o.seconds - 0.5; t += step) {
    const at = t;
    void ctx.suspend(at).then(() => {
      const t0 = performance.now();
      if (o.climaxAt !== undefined && at >= o.climaxAt) m.setClimax(true);
      m.scheduleUntil(Math.min(o.seconds - 0.5, at + step + 0.2));
      scheduleMs += performance.now() - t0;
      void ctx.resume();
    });
  }
  const r0 = performance.now();
  const buf = await ctx.startRendering();
  const renderMs = performance.now() - r0 - scheduleMs;
  return { channels: [buf.getChannelData(0), buf.getChannelData(1)], sampleRate: sr, info: { cached: m.band.cache.size, warmMs: Math.round(warmMs), scheduleMs: Math.round(scheduleMs), renderMs: Math.round(renderMs), misses: [...m.band.misses].sort((a, b) => b[1] - a[1]).slice(0, 12) } };
}

/**
 * The movement loops through the 'move' bus as in the game: stand 1 s, accelerate to top speed
 * while hooked and airborne, boost, coast, land and run. Info: the timeline.
 */
export async function loopsRender(o: { seconds?: number } = {}): Promise<Rendered> {
  const { Graph } = await import('./graph');
  const { Loops } = await import('../Audio');
  const { CATS, dbToGain } = await import('./mix');
  const sr = 48000;
  const seconds = o.seconds ?? 12;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  const g = new Graph(ctx);
  const cat = CATS.move;
  const bus = g.gain(dbToGain(cat.db), g.filter('highpass', cat.hp, 0.7, g.filter('lowpass', cat.lp, 0.6, g.filter('peaking', 3000, 0.8, ctx.destination, cat.presence ?? 0))));
  const loops = new Loops(g, bus, bus, () => undefined);
  const timeline: Array<[number, string]> = [];
  const state = (t: number) => {
    if (t < 1) return { speed: 0, boost: false, grounded: true, hooked: 0 };
    if (t < 5) return { speed: ((t - 1) / 4) * 55, boost: false, grounded: false, hooked: 1 };
    if (t < 7) return { speed: 55, boost: true, grounded: false, hooked: 0 };
    if (t < 9) return { speed: 55 - ((t - 7) / 2) * 35, boost: false, grounded: false, hooked: 0 };
    return { speed: 9, boost: false, grounded: true, hooked: 0 };
  };
  for (let t = 0; t < seconds - 0.05; t += 0.05) {
    const at = t;
    void ctx.suspend(at).then(() => {
      const s = state(at);
      loops.update(s.speed, s.boost, { grounded: s.grounded, hooked: s.hooked, wallRun: false, dt: 0.05 });
      void ctx.resume();
    });
  }
  timeline.push([0, 'stand'], [1, 'hooked, accelerating to 55 m/s'], [5, 'boosting at 55'], [7, 'coasting down'], [9, 'running 9 m/s']);
  const buf = await ctx.startRendering();
  return { channels: [buf.getChannelData(0), buf.getChannelData(1)], sampleRate: sr, info: timeline };
}

/** the catalogue's names (returned in `info`, with a token render) */
export async function sfxNames(): Promise<Rendered> {
  const { SFX } = await import('./sfx');
  return { channels: [new Float32Array(480), new Float32Array(480)], sampleRate: 48000, info: Object.keys(SFX) };
}

/**
 * Every SFX (or a list) dry, one at a time with silence between. `raw` (the default): no trim, no
 * level, no bus, for loudness measurement (tools/audio/mix_trims.mjs). `raw: false`: as the game
 * plays it next to the listener (trim, rank, category level and EQ). A name may carry a champion
 * after "@" ("hit.blade@kaiser") and per-play data after "#" as JSON ("hit.blade#{\"w\":0.9}").
 */
export async function sfxDry(o: { names?: string[]; repeat?: number; arena?: string; self?: boolean; raw?: boolean; v?: number }): Promise<Rendered> {
  const { Graph } = await import('./graph');
  const { SFX } = await import('./sfx');
  const { TRIMS } = await import('./trims');
  const { CATS, dbToGain } = await import('./mix');
  const names = o.names ?? Object.keys(SFX);
  const repeat = o.repeat ?? 3;
  const raw = o.raw ?? true;
  const pad = 0.5;
  const parse = (full: string) => {
    const [head, json] = full.split('#');
    const [name, champ] = head.split('@');
    return { name, champ, arg: json ? (JSON.parse(json) as Record<string, unknown>) : undefined };
  };
  let total = 0.5;
  for (const n of names) total += (SFX[parse(n).name].dur + pad) * repeat;
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
  const g = new Graph(ctx);
  g.softAttack = true;
  const harmony = { root: 2, tones: [0, 3, 7], tonic: 2, scale: [0, 2, 3, 5, 7, 9, 10] };
  const marks: Array<[string, number, number]> = [];
  let t = 0.25;
  for (const full of names) {
    const { name, champ, arg } = parse(full);
    const def = SFX[name];
    const cat = CATS[def.cat];
    for (let k = 0; k < repeat; k++) {
      let dst: AudioNode = ctx.destination;
      let lvl = 1;
      if (!raw) {
        dst = g.filter('highpass', cat.hp, 0.7, g.filter('lowpass', cat.lp, 0.6, g.filter('peaking', 3000, 0.8, ctx.destination, cat.presence ?? 0)));
        lvl = dbToGain((TRIMS[name] ?? 0) + (def.lvl ?? 0) + cat.db);
      }
      const out = g.gain(lvl * (o.v ?? 1), dst);
      def.fn({ g, t, out, p: 1 + (Math.random() * 2 - 1) * (def.vary ?? 0.035), v: o.v ?? 1, r: Math.random, step: 0, champ: champ ?? null, self: !!o.self, h: harmony, arena: o.arena ?? 'neon_city', arg });
      marks.push([full, +t.toFixed(3), +(t + def.dur + pad * 0.9).toFixed(3)]);
      t += def.dur + pad;
    }
  }
  const buf = await ctx.startRendering();
  return { channels: [buf.getChannelData(0), buf.getChannelData(1)], sampleRate: sr, info: marks };
}

/**
 * Sounds one after another as the game mixes them (trim, rank, category level and EQ, the arena
 * room for world sounds), with a fresh variation and an escalating combo step each repeat. Names
 * take "@champion" and "#{json arg}" like sfxDry.
 */
export async function sfxSheet(o: { names?: string[]; gap?: number; arena?: string; champ?: string; repeat?: number }): Promise<Rendered> {
  const { Graph } = await import('./graph');
  const { SFX } = await import('./sfx');
  const { TRIMS } = await import('./trims');
  const { CATS, dbToGain } = await import('./mix');
  const { renderRoom, ROOMS } = await import('./reverb');
  const names = o.names ?? Object.keys(SFX);
  const gap = o.gap ?? 0.15;
  const repeat = o.repeat ?? 1;
  const parse = (full: string) => {
    const [head, json] = full.split('#');
    const [name, champ] = head.split('@');
    return { name, champ: champ ?? o.champ, arg: json ? (JSON.parse(json) as Record<string, unknown>) : undefined };
  };
  let total = 1;
  for (const n of names) total += (SFX[parse(n).name].dur + gap) * repeat;
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
  const g = new Graph(ctx);
  g.softAttack = true;
  const master = g.gain(1);
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -2;
  lim.ratio.value = 20;
  lim.knee.value = 0;
  lim.attack.value = 0.001;
  master.connect(lim).connect(ctx.destination);
  const room = ctx.createConvolver();
  room.buffer = renderRoom(ctx, ROOMS[o.arena ?? 'neon_city']);
  room.connect(g.gain(0.7, master));
  const roomIn = g.gain(1);
  roomIn.connect(g.filter('highpass', 250, 0.6)).connect(g.filter('lowpass', 7000, 0.6)).connect(room);
  const harmony = { root: 2, tones: [0, 3, 7], tonic: 2, scale: [0, 2, 3, 5, 7, 9, 10] };
  const marks: Array<[string, number]> = [];
  let t = 0.3;
  for (const full of names) {
    const { name, champ, arg } = parse(full);
    const def = SFX[name];
    const cat = CATS[def.cat];
    for (let k = 0; k < repeat; k++) {
      const bus = g.filter('highpass', cat.hp, 0.7, g.filter('lowpass', cat.lp, 0.6, g.filter('peaking', 3000, 0.8, master, cat.presence ?? 0)));
      const out = g.gain(dbToGain((TRIMS[name] ?? 0) + (def.lvl ?? 0) + cat.db), bus);
      if (!cat.ui) out.connect(g.gain(0.12 * cat.rev * (def.rev ?? 1), roomIn));
      def.fn({ g, t, out, p: 1 + (Math.random() * 2 - 1) * (def.vary ?? 0.035), v: 1, r: Math.random, step: k, champ: champ ?? null, self: false, h: harmony, arena: o.arena ?? 'neon_city', arg });
      marks.push([full, +t.toFixed(2)]);
      t += def.dur + gap;
    }
  }
  const buf = await ctx.startRendering();
  return { channels: [buf.getChannelData(0), buf.getChannelData(1)], sampleRate: sr, info: marks };
}


/**
 * A timed scenario through the game's own SFX chain at default settings (trim, rank, category
 * bus, SFX slider, glue, master, limiter; world sounds through the arena room): for A/B listening.
 * events: [time, name, volume?, champion?, arg?]
 */
export async function scenario(o: { events: Array<[number, string, number?, string?, Record<string, unknown>?]>; arena?: string; seconds?: number }): Promise<Rendered> {
  const { Graph } = await import('./graph');
  const { SFX } = await import('./sfx');
  const { TRIMS } = await import('./trims');
  const { CATS, dbToGain, sliderGain, DEFAULT_VOLUMES } = await import('./mix');
  const { renderRoom, ROOMS } = await import('./reverb');
  const sr = 48000;
  const seconds = o.seconds ?? Math.max(...o.events.map((e) => e[0])) + 2;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  const g = new Graph(ctx);
  g.softAttack = true;
  const master = g.gain(sliderGain(DEFAULT_VOLUMES.master));
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -2;
  lim.knee.value = 0;
  lim.ratio.value = 20;
  lim.attack.value = 0.001;
  lim.release.value = 0.1;
  master.connect(lim).connect(ctx.destination);
  const sfxBus = g.gain(sliderGain(DEFAULT_VOLUMES.sfx));
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -15;
  glue.knee.value = 10;
  glue.ratio.value = 2;
  glue.attack.value = 0.012;
  glue.release.value = 0.2;
  sfxBus.connect(glue).connect(master);
  const room = ctx.createConvolver();
  room.buffer = renderRoom(ctx, ROOMS[o.arena ?? 'neon_city']);
  room.connect(g.gain(0.7, sfxBus));
  const roomIn = g.gain(1);
  roomIn.connect(g.filter('highpass', 250, 0.6)).connect(g.filter('lowpass', 7000, 0.6)).connect(room);
  const buses: Record<string, AudioNode> = {};
  for (const [k, cat] of Object.entries(CATS)) buses[k] = g.gain(dbToGain(cat.db), g.filter('highpass', cat.hp, 0.7, g.filter('lowpass', cat.lp, 0.6, g.filter('peaking', 3000, 0.8, sfxBus, cat.presence ?? 0))));
  const harmony = { root: 2, tones: [0, 3, 7], tonic: 2, scale: [0, 2, 3, 5, 7, 9, 10] };
  const steps = new Map<string, { t: number; step: number }>();
  for (const [t, name, vol = 1, champ, arg] of o.events) {
    const def = SFX[name];
    if (!def) continue;
    const cat = CATS[def.cat];
    const out = g.gain(vol * dbToGain((TRIMS[name] ?? 0) + (def.lvl ?? 0)), buses[def.cat]);
    if (!cat.ui) out.connect(g.gain(0.1 * cat.rev * (def.rev ?? 1), roomIn));
    let step = 0;
    if (def.combo) {
      const prev = steps.get(name);
      step = prev && t - prev.t < def.combo ? prev.step + 1 : 0;
      steps.set(name, { t, step });
    }
    def.fn({ g, t, out, p: 1 + (Math.random() * 2 - 1) * (def.vary ?? 0.035), v: vol, r: Math.random, step, champ: champ ?? null, self: true, h: harmony, arena: o.arena ?? 'neon_city', arg });
  }
  const buf = await ctx.startRendering();
  return { channels: [buf.getChannelData(0), buf.getChannelData(1)], sampleRate: sr, info: o.events.length };
}
