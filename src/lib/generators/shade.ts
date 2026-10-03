/**
 * generators/shade.ts — Hex shade helpers shared by the new generators.
 *
 * `scatter.ts` and `geometric.ts` each carry private copies; new code shares
 * this module instead. Pure colour math, no DOM.
 */

import { hexToHsl, hslToHex } from '../palette'

/** Maximum lightness the ladder will climb to. */
export const SHADE_LIGHT_MAX = 96
/** Minimum lightness the ladder will sink to. */
export const SHADE_DARK_MIN = 4

/** Lighten a hex colour toward white by `t` (0..1). */
export function lightenHex(c: string, t: number): string {
  if (!c.startsWith('#')) return c
  const [h, s, l] = hexToHsl(c)
  return hslToHex(h, s, Math.min(SHADE_LIGHT_MAX, l + t * 60))
}

/** Darken a hex colour toward black by `t` (0..1). */
export function darkenHex(c: string, t: number): string {
  if (!c.startsWith('#')) return c
  const [h, s, l] = hexToHsl(c)
  return hslToHex(h, s, Math.max(SHADE_DARK_MIN, l - t * 60))
}

/**
 * Build a lighter/base/darker ladder from one palette colour.
 */
export function shadeLadder(c: string, variance: number): [string, string, string] {
  const v: number = Math.max(0, Math.min(1, variance))
  return [lightenHex(c, 0.5 * v), c, darkenHex(c, 0.5 * v)]
}
