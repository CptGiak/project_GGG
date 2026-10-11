/** helpers for writing note lines */

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** transpose every pitch in a line of note tokens */
export function up(src: string, semis: number): string {
  return src.replace(/\b([A-G])(#|b)?(-?\d)\b/g, (_m, l: string, acc: string | undefined, oct: string) => {
    const midi = 12 * (Number(oct) + 1) + PC[l] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + semis;
    return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  });
}

/** repeat a bar pattern n times */
export function rep(bar: string, n: number): string {
  return Array.from({ length: n }, () => bar).join(' | ');
}
