/** Minimal SVG glyphs for ability cards (stroke-only, inherits currentColor). */
const P = (d: string, extra = '') => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linejoin="miter" stroke-linecap="square" ${extra}>${d}</svg>`;

export const ICONS: Record<string, string> = {
  sword: P('<path d="M10 38 L34 14 L40 8 L40 14 L34 20 L10 44 Z" fill="currentColor" fill-opacity="0.25"/><path d="M8 30 L18 40"/><path d="M6 42 L10 38"/>'),
  shield: P('<path d="M24 6 L40 12 L38 30 Q32 40 24 43 Q16 40 10 30 L8 12 Z" fill="currentColor" fill-opacity="0.2"/><path d="M24 14 L24 34"/>'),
  dive: P('<path d="M6 24 L30 24"/><path d="M24 14 L40 24 L24 34 Z" fill="currentColor" fill-opacity="0.35"/><path d="M6 16 L18 16 M6 32 L18 32"/>'),
  burst: P('<path d="M24 4 L28 18 L42 12 L32 24 L44 32 L29 30 L24 44 L19 30 L4 32 L16 24 L6 12 L20 18 Z" fill="currentColor" fill-opacity="0.3"/>'),
  blades: P('<path d="M8 40 L32 8 M16 40 L40 8"/><path d="M6 36 L12 42 M14 36 L20 42"/>'),
  glitch: P('<path d="M6 14 H22 V20 H34 V14 H42 M6 28 H14 V34 H30 V28 H42"/><path d="M22 40 L30 40" />'),
  phantom: P('<circle cx="18" cy="16" r="6"/><path d="M8 40 Q10 26 18 24 Q26 26 28 40"/><path d="M30 12 L42 24 L30 36" />'),
  remix: P('<path d="M6 34 L16 14 L24 34 L32 14 L42 34"/><circle cx="24" cy="24" r="20" stroke-opacity="0.4"/>'),
  gun: P('<path d="M6 18 H34 L40 22 V26 H24 L22 34 H14 L16 26 H6 Z" fill="currentColor" fill-opacity="0.25"/><path d="M40 20 L44 18 M40 28 L44 30"/>'),
  charge: P('<circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="5" fill="currentColor"/><path d="M24 2 V10 M24 38 V46 M2 24 H10 M38 24 H46"/>'),
  bomb: P('<circle cx="22" cy="28" r="13" fill="currentColor" fill-opacity="0.25"/><path d="M30 18 L36 12 M36 12 L42 8 M38 6 L40 4"/>'),
  notes: P('<path d="M18 36 V10 L38 6 V30"/><ellipse cx="13" cy="36" rx="5" ry="4" fill="currentColor"/><ellipse cx="33" cy="31" rx="5" ry="4" fill="currentColor"/>'),
  orb: P('<circle cx="24" cy="24" r="10" fill="currentColor" fill-opacity="0.35"/><circle cx="24" cy="24" r="17" stroke-dasharray="6 5"/>'),
  beam: P('<path d="M4 24 H44"/><path d="M4 18 H30 M4 30 H30" stroke-opacity="0.5"/><circle cx="8" cy="24" r="4" fill="currentColor"/>'),
  wave: P('<path d="M24 24 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0"/><path d="M24 24 m-13 0 a13 13 0 1 0 26 0 a13 13 0 1 0 -26 0" stroke-opacity="0.65"/><path d="M24 24 m-20 0 a20 20 0 1 0 40 0 a20 20 0 1 0 -40 0" stroke-opacity="0.35"/>'),
  // signature skills
  chord: P('<path d="M24 4 V28"/><path d="M17 9 H31"/><path d="M20 28 L24 35 L28 28 Z" fill="currentColor" fill-opacity="0.4"/><path d="M4 42 Q10 36 16 42 M32 42 Q38 36 44 42"/><path d="M14 46 H34" stroke-opacity="0.6"/>'),
  cross: P('<path d="M9 9 L39 39 M39 9 L9 39"/><path d="M5 5 L13 7 L7 13 Z M43 5 L41 13 L35 7 Z" fill="currentColor"/><circle cx="24" cy="24" r="4" fill="currentColor" fill-opacity="0.4"/>'),
  kama: P('<path d="M14 44 L26 20"/><path d="M26 20 Q30 6 44 8 Q34 12 30 22 Z" fill="currentColor" fill-opacity="0.35"/><path d="M10 40 L18 44"/>'),
  slashes: P('<path d="M8 36 Q20 30 40 10" /><path d="M8 44 Q24 38 42 22" stroke-opacity="0.6"/>'),
  flame: P('<path d="M24 44 Q10 40 12 28 Q14 20 20 14 Q20 22 25 24 Q24 12 30 4 Q34 16 38 22 Q42 34 34 42 Q30 44 24 44 Z" fill="currentColor" fill-opacity="0.3"/><path d="M24 40 Q18 36 21 30 Q24 34 27 31 Q30 36 24 40 Z" fill="currentColor"/>'),
  slug: P('<path d="M10 17 H30 Q41 17 43 24 Q41 31 30 31 H10 Z" fill="currentColor" fill-opacity="0.3"/><path d="M16 17 V31"/><path d="M2 13 H9 M2 35 H9 M1 24 H6"/>'),
  highnote: P('<path d="M5 42 Q12 10 30 14" stroke-dasharray="3 4"/><path d="M34 32 V12 L44 9 V27"/><ellipse cx="30" cy="32" rx="5" ry="4" fill="currentColor"/><ellipse cx="40" cy="27" rx="5" ry="4" fill="currentColor"/>'),
  spotlight: P('<path d="M18 4 H30 L40 44 H8 Z" fill="currentColor" fill-opacity="0.25"/><path d="M14 44 H34"/><path d="M24 4 V12"/>'),
  // League of Legends ports
  kunai: P('<path d="M24 42 L8 16 M24 42 L15 10 M24 42 L24 7 M24 42 L33 10 M24 42 L40 16"/><path d="M24 3 L27 9 L24 13 L21 9 Z" fill="currentColor"/>'),
  smoke: P('<path d="M12 36 Q4 36 6 28 Q4 20 13 20 Q14 10 24 12 Q32 6 36 16 Q44 16 42 26 Q46 34 36 36 Z" fill="currentColor" fill-opacity="0.25"/><path d="M14 42 H34" stroke-opacity="0.5"/>'),
  shuriken: P('<path d="M24 4 L28 20 L44 24 L28 28 L24 44 L20 28 L4 24 L20 20 Z" fill="currentColor" fill-opacity="0.3"/><circle cx="24" cy="24" r="3.5"/>'),
  execute: P('<path d="M6 40 L42 8"/><path d="M6 8 L42 40" stroke-opacity="0.5"/><path d="M32 8 H42 V18"/>'),
  ring: P('<circle cx="24" cy="24" r="13"/><path d="M24 3 L29 11 L19 11 Z M45 24 L37 29 L37 19 Z M24 45 L19 37 L29 37 Z" fill="currentColor"/>'),
  elements: P('<path d="M4 40 L14 24 L22 40 Z" fill="currentColor" fill-opacity="0.3"/><path d="M24 40 Q28 32 32 40 Q36 32 40 40"/><path d="M30 22 Q30 8 42 6 Q42 20 30 22 Z M30 22 L38 12"/>'),
  pounce: P('<path d="M6 40 Q16 6 38 22"/><path d="M30 14 L40 22 L30 28"/><path d="M34 40 H44" stroke-opacity="0.5"/>'),
  quake: P('<path d="M4 24 H14"/><path d="M18 12 Q26 24 18 36"/><path d="M26 8 Q36 24 26 40" stroke-opacity="0.7"/><path d="M40 6 V42" stroke-width="5"/>'),
  stake: P('<path d="M24 4 L28 14 V40 H20 V14 Z" fill="currentColor" fill-opacity="0.3"/><path d="M14 30 H34"/><path d="M24 40 V46"/>'),
  nails: P('<path d="M8 12 H34 L42 14 L34 16 H8 Z M8 24 H34 L42 26 L34 28 H8 Z M8 36 H34 L42 38 L34 40 H8 Z" fill="currentColor" fill-opacity="0.35"/><path d="M6 9 V19 M6 21 V31 M6 33 V43"/>'),
  ashes: P('<circle cx="10" cy="32" r="5" stroke-opacity="0.6"/><circle cx="17" cy="24" r="3" stroke-opacity="0.4"/><path d="M14 38 L36 14" stroke-dasharray="5 4"/><path d="M28 12 H38 V22"/>'),
  reliquary: P('<path d="M12 18 H36 V42 H12 Z" fill="currentColor" fill-opacity="0.25"/><path d="M24 22 V38 M18 28 H30"/><path d="M24 3 L28 9 L24 15 L20 9 Z" fill="currentColor"/>'),
  // Pooh
  belly: P('<circle cx="29" cy="25" r="14" fill="currentColor" fill-opacity="0.3"/><path d="M3 17 H12 M1 25 H10 M3 33 H12"/><circle cx="31" cy="27" r="1.8" fill="currentColor"/>'),
  hunny: P('<path d="M14 15 H34 L31 19 Q41 23 40 33 Q38 44 24 44 Q10 44 8 33 Q7 23 17 19 Z" fill="currentColor" fill-opacity="0.3"/><path d="M11 29 H37"/><path d="M15 15 Q15 8 24 8 Q33 8 33 15"/><path d="M33 15 V22" stroke-width="2.4"/>'),
  balloon: P('<ellipse cx="26" cy="17" rx="12" ry="14" fill="currentColor" fill-opacity="0.3"/><path d="M24 31 L28 31 L26 34 Z" fill="currentColor"/><path d="M26 34 Q19 39 24 46"/><path d="M20 10 Q22 7 25 7" stroke-opacity="0.6"/>'),
  idea: P('<path d="M24 7 Q35 7 35 18 Q35 25 30 29 V35 H18 V29 Q13 25 13 18 Q13 7 24 7 Z" fill="currentColor" fill-opacity="0.3"/><path d="M19 39 H29 M20 44 H28"/><path d="M3 18 H8 M40 18 H45 M7 5 L11 9 M41 5 L37 9"/>'),
  bees: P('<ellipse cx="17" cy="29" rx="12" ry="14" fill="currentColor" fill-opacity="0.3"/><path d="M7 23 H27 M6 31 H28 M9 39 H25"/><circle cx="36" cy="11" r="3" fill="currentColor"/><path d="M36 8 Q33 3 30 6 M36 8 Q39 3 42 6"/><circle cx="41" cy="27" r="2.5" fill="currentColor"/><path d="M41 25 Q39 21 37 23 M41 25 Q43 21 45 23"/>'),
  // Elisabbat
  fangs: P('<path d="M5 14 Q24 32 43 14"/><path d="M14 20 L17 36 L21 23 Z M27 23 L31 36 L34 20 Z" fill="currentColor"/><path d="M20 42 Q24 46 28 42" stroke-opacity="0.6"/>'),
  claws: P('<path d="M8 40 Q14 22 28 8"/><path d="M17 43 Q23 25 37 12"/><path d="M27 45 Q33 29 44 19"/>'),
  bat: P('<path d="M24 19 L21 12 L22.5 19 Q14 14 3 19 Q10 23 8 30 Q14 26 18 31 Q21 27 24 35 Q27 27 30 31 Q34 26 40 30 Q38 23 45 19 Q34 14 25.5 19 L27 12 Z" fill="currentColor" fill-opacity="0.35"/>'),
  batswarm: P('<path d="M12 14 Q8 11 3 13 Q6 15 5 18 Q8 16 10 19 Q12 16 14 19 Q16 16 19 18 Q18 15 21 13 Q16 11 12 14 Z M32 22 Q27 18 21 21 Q25 24 24 28 Q28 25 30 29 Q32 25 34 29 Q36 25 40 28 Q39 24 43 21 Q37 18 32 22 Z M18 34 Q15 32 11 33 Q13 35 13 37 Q15 36 17 38 Q18 36 19 38 Q21 36 23 37 Q23 35 25 33 Q21 32 18 34 Z" fill="currentColor" fill-opacity="0.45"/><path d="M4 44 L44 6" stroke-opacity="0.3" stroke-dasharray="3 5"/>'),
  night: P('<path d="M30 5 A19 19 0 1 0 43 33 A15 15 0 1 1 30 5 Z" fill="currentColor" fill-opacity="0.3"/><path d="M6 38 Q10 34 14 38 Q18 34 22 38" /><path d="M24 44 Q27 41 30 44 Q33 41 36 44" stroke-opacity="0.6"/>'),
};

const MAP: Record<string, Record<string, string>> = {
  kaiser: { sig: 'chord', atk: 'sword', sec: 'shield', abi: 'dive', ult: 'burst' },
  nova: { sig: 'cross', atk: 'blades', sec: 'glitch', abi: 'phantom', ult: 'remix' },
  rex: { sig: 'slug', atk: 'gun', sec: 'charge', abi: 'bomb', ult: 'notes' },
  sera: { sig: 'highnote', atk: 'orb', sec: 'beam', abi: 'wave', ult: 'spotlight' },
  akali: { sig: 'kunai', atk: 'kama', sec: 'smoke', abi: 'shuriken', ult: 'execute' },
  qiyana: { sig: 'ring', atk: 'slashes', sec: 'elements', abi: 'pounce', ult: 'quake' },
  locke: { sig: 'nails', atk: 'stake', sec: 'flame', abi: 'ashes', ult: 'reliquary' },
  pooh: { sig: 'belly', atk: 'hunny', sec: 'balloon', abi: 'idea', ult: 'bees' },
  elisabbat: { sig: 'fangs', atk: 'claws', sec: 'bat', abi: 'batswarm', ult: 'night' },
};

export function abilityIcon(champ: string, slot: string): string {
  return ICONS[MAP[champ]?.[slot] ?? 'burst'];
}
