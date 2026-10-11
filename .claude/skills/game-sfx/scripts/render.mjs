#!/usr/bin/env node
/**
 * Offline "ears": renders audio through the game's own Web Audio code in headless Chromium and
 * writes a WAV, a spectrogram PNG, an MP3 for listening on a phone, and a JSON of stats.
 *
 *   node .claude/skills/game-sfx/scripts/render.mjs <fn> '<json args>' <outPrefix> [--port 5199]
 *
 * <fn> is an export of src/core/audio/preview.ts (dev-only module, never bundled):
 *   song      {"id":"city","seconds":30,"intensity":0.7,"warm":true,"at":3,"climaxAt":10,"skip":["pad"]}
 *   sfxSheet  {"names":["hit","slam"],"repeat":3,"gap":0.25,"arena":"stage","champ":"kaiser"}
 *   drumKit   {}            guitarBank {}
 * Starts a Vite dev server on --port when none is running and stops it afterwards.
 */
import { spawn, execFileSync, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const argv = process.argv.slice(2);
const portIdx = argv.indexOf('--port');
const port = portIdx >= 0 ? Number(argv.splice(portIdx, 2)[1]) : 5199;
const [fn, argsJson = '{}', out = path.join(root, 'audio-preview')] = argv;
if (!fn) {
  console.error('usage: render.mjs <fn> <jsonArgs> <outPrefix> [--port N]');
  process.exit(1);
}

// playwright: local install, else the global one
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const req = createRequire(path.join(execSync('npm root -g').toString().trim(), '/'));
  ({ chromium } = req('playwright'));
}
const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

const base = `http://localhost:${port}`;
const up = async () => fetch(base).then(() => true, () => false);
let vite = null;
if (!(await up())) {
  vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[page]', m.text()));
await page.goto(`${base}/src/core/audio/dsp.ts`);
page.setDefaultTimeout(0);
const res = await page.evaluate(async ({ fn, args }) => {
  const mod = await import('/src/core/audio/preview.ts');
  const t0 = performance.now();
  const r = await mod[fn](args);
  const ms = performance.now() - t0;
  const chans = r.channels;
  const n = chans[0].length;
  const pcm = new Int16Array(n * chans.length);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < chans.length; c++) {
      const v = chans[c][i];
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
      pcm[i * chans.length + c] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    }
  const bytes = new Uint8Array(pcm.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { b64: btoa(bin), sr: r.sampleRate, ch: chans.length, n, peak, rms: Math.sqrt(sum / (n * chans.length)), ms, info: r.info ?? null };
}, { fn, args: JSON.parse(argsJson) });
await browser.close();
if (vite) process.kill(-vite.pid);

const data = Buffer.from(res.b64, 'base64');
const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0);
hdr.writeUInt32LE(36 + data.length, 4);
hdr.write('WAVE', 8);
hdr.write('fmt ', 12);
hdr.writeUInt32LE(16, 16);
hdr.writeUInt16LE(1, 20);
hdr.writeUInt16LE(res.ch, 22);
hdr.writeUInt32LE(res.sr, 24);
hdr.writeUInt32LE(res.sr * res.ch * 2, 28);
hdr.writeUInt16LE(res.ch * 2, 32);
hdr.writeUInt16LE(16, 34);
hdr.write('data', 36);
hdr.writeUInt32LE(data.length, 40);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(`${out}.wav`, Buffer.concat([hdr, data]));
const db = (x) => +(20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);
const stats = { seconds: +(res.n / res.sr).toFixed(2), peakDb: db(res.peak), rmsDb: db(res.rms), totalMs: Math.round(res.ms), info: res.info };
fs.writeFileSync(`${out}.json`, JSON.stringify(stats, null, 1));
console.log(JSON.stringify(stats).slice(0, 2000));
const ff = (args) => {
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
  } catch (e) {
    console.log('ffmpeg:', e.message.split('\n')[0]);
  }
};
ff(['-i', `${out}.wav`, '-lavfi', 'showspectrumpic=s=1200x500:mode=combined:scale=log:fscale=log:legend=1', `${out}.png`]);
ff(['-i', `${out}.wav`, '-codec:a', 'libmp3lame', '-b:a', '192k', `${out}.mp3`]);
