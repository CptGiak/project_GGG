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

/** every SFX (or a list) one after another, through a room, with a fresh variation each time */
export async function sfxSheet(o: { names?: string[]; gap?: number; arena?: string; champ?: string; repeat?: number }): Promise<Rendered> {
  const { Graph } = await import('./graph');
  const { SFX } = await import('./sfx');
  const { renderRoom, ROOMS } = await import('./reverb');
  const names = o.names ?? Object.keys(SFX);
  const gap = o.gap ?? 0.15;
  const repeat = o.repeat ?? 1;
  let total = 1;
  for (const n of names) total += (SFX[n].dur + gap) * repeat;
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
  const g = new Graph(ctx);
  const master = g.gain(0.9);
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -3;
  lim.ratio.value = 16;
  lim.attack.value = 0.002;
  master.connect(lim).connect(ctx.destination);
  const room = ctx.createConvolver();
  room.buffer = renderRoom(ctx, ROOMS[o.arena ?? 'neon_city']);
  room.connect(g.gain(0.8, master));
  const harmony = { root: 2, tones: [0, 3, 7], tonic: 2, scale: [0, 2, 3, 5, 7, 9, 10] };
  const marks: Array<[string, number]> = [];
  let t = 0.3;
  for (const name of names) {
    const def = SFX[name];
    for (let k = 0; k < repeat; k++) {
      const out = g.gain(def.gain ?? 1, master);
      if (!def.ui) out.connect(g.gain(0.25 * (def.rev ?? 1), room));
      def.fn({ g, t, out, p: 1 + (Math.random() * 2 - 1) * (def.vary ?? 0.035), v: 1, r: Math.random, step: k, champ: o.champ ?? null, self: false, h: harmony, arena: o.arena ?? 'neon_city' });
      marks.push([name, +t.toFixed(2)]);
      t += def.dur + gap;
    }
  }
  const buf = await ctx.startRendering();
  return { channels: [buf.getChannelData(0), buf.getChannelData(1)], sampleRate: sr, info: marks };
}

