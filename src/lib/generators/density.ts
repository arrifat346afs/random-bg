/**
 * generators/density.ts — Density-aware alpha guard.
 *
 * Additive stacks blow out to white when many translucent strokes overlap.
 * This helper scales opacity down as the estimated overlap load grows, so a
 * dense roll keeps its shape instead of clipping. Pure math, no DOM.
 */

/** Overlap load one canvas tolerates before dimming kicks in. */
export const ADDITIVE_LOAD_BUDGET = 24

/**
 * Scale `base` alpha so dense stacks do not blow out to white.
 *
 * Square-root falloff: halving alpha per 4x load keeps the shape of the
 * design instead of just going dim in one spot.
 */
export function alphaForLoad(base: number, load: number, budget: number = ADDITIVE_LOAD_BUDGET): number {
  if (!(base > 0)) return 0
  if (!(load > budget)) return Math.max(0, Math.min(1, base))
  const k: number = Math.sqrt(budget / load)
  return Math.max(0, Math.min(1, base * k))
}

/**
 * Estimate how many strokes overlap at a typical pixel.
 */
export function ribbonLoad(ribbons: number, strands: number, coverage: number): number {
  const c: number = Math.max(0.05, Math.min(1, coverage))
  return Math.max(1, ribbons * strands * c)
}
