#!/usr/bin/env node
/**
 * Records a real match the way a player hears it, for mix checks.
 *
 *   node .claude/skills/game-sfx/scripts/capture.mjs '<game url>' <seconds> <outPrefix>
 *   e.g. 'http://localhost:5199/?play&champ=kaiser&arena=neon_city&bots=5&diff=0.8'
 *   then python3 .claude/skills/game-sfx/scripts/mixstats.py <outPrefix>
 *
 * Needs a running dev server (npx vite --port 5199). Plays a bot match in headless Chromium with
 * the local fighter driven by a bot too (rendering skipped), and writes the master (stereo, pre
 * limiter), the music bus and the SFX bus (mono taps: about 3 dB under the stereo-equivalent
 * loudness), a log of every SFX trigger (time, name, distance to the listener, volume, source
 * champion) and how often the master limiter and the SFX glue compressor work.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const req = createRequire(execSync('npm root -g').toString().trim() + '/');
  ({ chromium } = req('playwright'));
}
const [url, secsArg, out] = process.argv.slice(2);
const secs = Number(secsArg ?? 60);
const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(url);
await page.waitForTimeout(5000);
await page.mouse.click(240, 135);
await page.waitForTimeout(500);
await page.evaluate((secs) => {
  const app = window.__app;
  const a = app.audio;
  const m = app.match;
  // the local fighter fights on its own
  const Bot = m.bots[0].constructor;
  m.bots.push(new Bot(m.local, 0.8));
  // skip drawing: the simulation and the audio are what we need
  m.render = () => {};
  const ctx = a.ctx;
  const taps = { master: [[], []], music: [[]], sfx: [[]] };
  const tap = (node, key, ch) => {
    const sp = ctx.createScriptProcessor(4096, ch, ch);
    node.connect(sp);
    const z = ctx.createGain();
    z.gain.value = 0;
    sp.connect(z).connect(ctx.destination);
    sp.onaudioprocess = (e) => {
      if (window.__capDone) return;
      for (let c = 0; c < ch; c++) taps[key][c].push(new Float32Array(e.inputBuffer.getChannelData(c)));
    };
    return sp;
  };
  window.__taps = taps;
  window.__keep = [tap(a.master, 'master', 2), tap(a.musicBus, 'music', 1), tap(a.sfxBus, 'sfx', 1)];
  window.__t0 = ctx.currentTime;
  // limiter / glue gain reduction, sampled every 20 ms
  window.__red = [];
  window.__redT = setInterval(() => {
    if (window.__capDone) return;
    window.__red.push([a.limiter ? a.limiter.reduction : 0, a.glue ? a.glue.reduction : 0]);
  }, 20);
  window.__log = [];
  const orig = a.play.bind(a);
  a.play = (n, pos, vol = 1, src) => {
    const lp = a.listenerPos;
    const d = pos ? Math.round(pos.distanceTo(lp) * 10) / 10 : -1;
    window.__log.push([Math.round((ctx.currentTime - window.__t0) * 1000) / 1000, n, d, Math.round(vol * 100) / 100, src ?? null]);
    return orig(n, pos, vol, src);
  };
}, secs);
const t0 = Date.now();
while (Date.now() - t0 < secs * 1000) {
  await page.waitForTimeout(5000);
  const s = await page.evaluate(() => ({ t: window.__app.audio.ctx.currentTime - window.__t0, n: window.__log.length, k: window.__app.match.local.kills, st: window.__app.match.state }));
  process.stdout.write(`  t=${s.t.toFixed(0)}s sfx=${s.n} kills=${s.k} ${s.st}\r`);
}
console.log();
const res = await page.evaluate(() => {
  window.__capDone = true;
  const enc = (chs) => {
    const n = chs[0].reduce((s, b) => s + b.length, 0);
    const pcm = new Int16Array(n * chs.length);
    let i = 0;
    for (let b = 0; b < chs[0].length; b++) {
      for (let k = 0; k < chs[0][b].length; k++, i++) for (let c = 0; c < chs.length; c++) pcm[i * chs.length + c] = Math.max(-32768, Math.min(32767, Math.round(chs[c][b][k] * 32767)));
    }
    const bytes = new Uint8Array(pcm.buffer);
    let bin = '';
    for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(j, j + 0x8000));
    return { b64: btoa(bin), ch: chs.length };
  };
  const t = window.__taps;
  return { sr: window.__app.audio.ctx.sampleRate, master: enc(t.master), music: enc(t.music), sfx: enc(t.sfx), log: window.__log, vol: window.__app.audio.volumes, red: window.__red };
});
const wav = (o, file) => {
  const data = Buffer.from(o.b64, 'base64');
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12);
  hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(o.ch, 22); hdr.writeUInt32LE(res.sr, 24);
  hdr.writeUInt32LE(res.sr * o.ch * 2, 28); hdr.writeUInt16LE(o.ch * 2, 32); hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([hdr, data]));
};
wav(res.master, out + '.master.wav');
wav(res.music, out + '.music.wav');
wav(res.sfx, out + '.sfx.wav');
fs.writeFileSync(out + '.log.json', JSON.stringify({ volumes: res.vol, log: res.log, red: res.red }));
if (res.red?.length) {
  const lim = res.red.map((r) => r[0]);
  const glue = res.red.map((r) => r[1]);
  const pct = (a, th) => ((100 * a.filter((x) => x < th).length) / a.length).toFixed(1);
  console.log(`limiter: active ${pct(lim, -0.5)}% of the time, >3 dB ${pct(lim, -3)}%, max ${Math.min(...lim).toFixed(1)} dB | glue: active ${pct(glue, -0.5)}%, >3 dB ${pct(glue, -3)}%, max ${Math.min(...glue).toFixed(1)} dB`);
}
console.log('volumes', JSON.stringify(res.vol), 'triggers', res.log.length);
console.log('errors:', errors.length ? errors.slice(0, 10).join('\n') : 'none');
await browser.close();
