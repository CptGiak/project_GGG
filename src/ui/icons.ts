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
};

const MAP: Record<string, Record<string, string>> = {
  kaiser: { atk: 'sword', sec: 'shield', abi: 'dive', ult: 'burst' },
  nova: { atk: 'blades', sec: 'glitch', abi: 'phantom', ult: 'remix' },
  rex: { atk: 'gun', sec: 'charge', abi: 'bomb', ult: 'notes' },
  sera: { atk: 'orb', sec: 'beam', abi: 'wave', ult: 'spotlight' },
};

export function abilityIcon(champ: string, slot: string): string {
  return ICONS[MAP[champ]?.[slot] ?? 'burst'];
}
