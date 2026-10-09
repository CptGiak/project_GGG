/**
 * Builds the game as one self-contained page for static hosting without the game server (the
 * version published as a Claude artifact): three.js from jsDelivr through an import map, the
 * game's JS and CSS inline, the GLB models packed as base64 in models.json next to the page
 * (artifact hosts do not serve .glb files). Online PvP is off (VITE_STATIC).
 *
 *   node tools/build_static.mjs [outDir]      -> <outDir>/index.html + <outDir>/models.json
 *
 * The page has no <html>/<head>/<body> of its own: the artifact host wraps it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'dist-static'));
const tmp = path.join(out, '.vite');
const THREE_VERSION = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/three/package.json'), 'utf8')).version;

process.env.VITE_STATIC = '1';
fs.rmSync(out, { recursive: true, force: true });
await build({
  root,
  configFile: false,
  base: './',
  publicDir: false,
  logLevel: 'warn',
  build: {
    outDir: tmp,
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: false,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { external: ['three', /^three\/addons\//] },
  },
});

const assets = path.join(tmp, 'assets');
const files = fs.readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js'));
const css = files.filter((f) => f.endsWith('.css'));
if (js.length !== 1) throw new Error(`expected one JS chunk, got ${js.join(', ')}`);
// inline code must not close its own tag
const read = (f, tag) => fs.readFileSync(path.join(assets, f), 'utf8').replaceAll(`</${tag}`, `<\\/${tag}`);
const importMap = {
  imports: {
    three: `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js`,
    'three/addons/': `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/`,
  },
};
const html = `<title>Project GGG</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=Rubik:wght@400;600;800&display=swap">
<style>:root{color-scheme:dark}html,body{height:100%;background:#0b0710;color:#fff}
${css.map((f) => read(f, 'style')).join('\n')}</style>
<canvas id="game"></canvas>
<div id="ui"></div>
<script type="importmap">${JSON.stringify(importMap)}</script>
<script type="module">
${read(js[0], 'script')}
</script>
`;
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.rmSync(tmp, { recursive: true, force: true });

// public/models/**/*.glb -> { "models/<path>.glb": base64 } (the keys are the game's model paths)
const glbs = (dir, pre) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? glbs(path.join(dir, d.name), `${pre}${d.name}/`) : d.name.endsWith('.glb') ? [`${pre}${d.name}`] : []));
const packed = Object.fromEntries(glbs(path.join(root, 'public/models'), 'models/').map((p) => [p, fs.readFileSync(path.join(root, 'public', p)).toString('base64')]));
fs.writeFileSync(path.join(out, 'models.json'), JSON.stringify(packed));

const list = (dir, pre = '') =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? list(path.join(dir, d.name), `${pre}${d.name}/`) : [`${pre}${d.name}`]));
for (const f of list(out)) console.log(`${(fs.statSync(path.join(out, f)).size / 1024).toFixed(0).padStart(7)} KB  ${f}`);
