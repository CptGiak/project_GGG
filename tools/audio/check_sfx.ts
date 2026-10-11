/**
 * Consistency check for the SFX catalogue (run: npx tsx tools/audio/check_sfx.ts):
 *  - every sound name the game code plays exists in the catalogue (unknown names are silent);
 *  - every champion damage part has an impact in IMPACTS, and every IMPACTS key is a real part;
 *  - catalogue entries nothing plays (dead sounds);
 *  - every entry has a category and a trim (tools/audio/mix_trims.mjs).
 * Exits with 1 on missing names or missing impacts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CHAMPIONS } from '../../shared/champions';
import { IMPACTS } from '../../src/core/audio/impacts';
import { SFX } from '../../src/core/audio/sfx';
import { TRIMS } from '../../src/core/audio/trims';

const root = path.resolve(import.meta.dirname, '../..');
const files: string[] = [];
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name) && !p.includes(`${path.sep}core${path.sep}audio${path.sep}`)) files.push(p);
  }
};
walk(path.join(root, 'src'));

// the names reaching audio.play (incl. both arms of a ternary), afterimage(..., 'name'),
// boom: 'name' and the menus' sfx('name'); literals compared with ===/!== are action names
const used = new Map<string, string>();
const callName = /(?:audio\.play\(|\bsfx\(|afterimage\([^)]*,\s*|boom:\s*)([^,)]*)/g;
const lit = /(?<![=!]==\s*)'([a-z][\w.]*)'/g;
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const call of line.matchAll(callName)) {
      for (const m of call[1].matchAll(lit)) if (!used.has(m[1])) used.set(m[1], `${path.relative(root, f)}:${i + 1}`);
    }
  });
}
let bad = 0;
for (const [name, where] of used) {
  if (!SFX[name]) {
    console.log(`MISSING sound '${name}' (played at ${where})`);
    bad++;
  }
}
// impacts vs damage parts
for (const [id, ch] of Object.entries(CHAMPIONS)) {
  for (const [slot, ab] of Object.entries(ch.abilities)) {
    for (const part of Object.keys(ab.damage ?? {})) {
      if (!IMPACTS[id]?.[`${slot}.${part}`]) {
        console.log(`MISSING impact ${id} ${slot}.${part}`);
        bad++;
      }
    }
  }
  for (const key of Object.keys(IMPACTS[id] ?? {})) {
    const [slot, part] = key.split('.');
    if (!(ch.abilities as Record<string, { damage?: Record<string, number> }>)[slot]?.damage?.[part]) console.log(`stale impact ${id} ${key}`);
  }
}
// dead and untrimmed sounds
const playedByEngine = /^(hit\.|confirm\.|hurt$|footstep$|ultTick$)/;
const dead = Object.keys(SFX).filter((n) => !used.has(n) && !playedByEngine.test(n));
if (dead.length) console.log(`unused sounds (${dead.length}): ${dead.join(', ')}`);
const untrimmed = Object.keys(SFX).filter((n) => TRIMS[n] === undefined);
if (untrimmed.length) console.log(`not normalised (${untrimmed.length}): ${untrimmed.join(', ')}  -> node tools/audio/mix_trims.mjs`);
const stale = Object.keys(TRIMS).filter((n) => !SFX[n]);
if (stale.length) console.log(`stale trims (${stale.length}): ${stale.join(', ')}`);
console.log(`${Object.keys(SFX).length} sounds, ${used.size} names played by the game code, ${bad} problems`);
process.exit(bad ? 1 : 0);
