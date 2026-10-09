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
};

const MAP: Record<string, Record<string, string>> = {
  kaiser: { atk: 'sword', sec: 'shield', abi: 'dive', ult: 'burst' },
  nova: { atk: 'blades', sec: 'glitch', abi: 'phantom', ult: 'remix' },
  rex: { atk: 'gun', sec: 'charge', abi: 'bomb', ult: 'notes' },
  sera: { atk: 'orb', sec: 'beam', abi: 'wave', ult: 'spotlight' },
  akali: { atk: 'kunai', sec: 'smoke', abi: 'shuriken', ult: 'execute' },
  qiyana: { atk: 'ring', sec: 'elements', abi: 'pounce', ult: 'quake' },
  locke: { atk: 'stake', sec: 'nails', abi: 'ashes', ult: 'reliquary' },
};

export function abilityIcon(champ: string, slot: string): string {
  return ICONS[MAP[champ]?.[slot] ?? 'burst'];
}
