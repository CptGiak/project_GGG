import * as THREE from 'three';

/** the bloom pass's luminance threshold (Engine: UnrealBloomPass(…, 1.45)) */
export const BLOOM_THRESHOLD = 1.45;

/** linear Rec.709 luminance (as three's Color.getLuminance on linear values) */
export const lum = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * An HDR colour of the given hue whose luminance is `tier` x the bloom threshold, so every hue
 * blooms the same at the same tier (violet #9b5cff needs ~3x gold #ffc94a's multiplier).
 *   0.3-0.9 mid layers (no bloom) · 1.2 soft halo · 2 strong · 4 flash (<= 3 frames) · 6+ impact frames
 * Channels above 1 clip toward white on screen, so keep big mid layers <= 0.9 and push only small
 * cores past the threshold: the halo keeps the hue because bloom blurs the HDR colour.
 */
export function bloomColor(hex: THREE.ColorRepresentation, tier: number, out = new THREE.Color()): THREE.Color {
  out.set(hex);
  return out.multiplyScalar((tier * BLOOM_THRESHOLD) / Math.max(lum(out), 1e-4));
}
