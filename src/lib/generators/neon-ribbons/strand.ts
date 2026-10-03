/**
 * neon-ribbons/strand.ts — One strand of a ribbon bundle.
 *
 * A strand is the base centre-line plus a lateral offset that weaves it
 * across its neighbours (twist) and fans it out (spread). Width tapers thin
 * at both ends so strands read as light trails, not wires.
 */

import type { RNG } from '../../rng'

/** How many samples the offset loop walks. */
export const STRAND_SAMPLES = 40

/**
 * Offset a centre-line polyline into one strand.
 *
 * @param base Flat centre-line from `traceCurve`.
 * @param rng Seeded strand rng (already forked per ribbon).
 * @param index Strand index within the bundle.
 * @param total Strands in this bundle.
 * @param spread Lateral fan-out in px.
 * @param twist Weave strength 0..2.
 * @returns New flat polyline for this strand.
 */
export function strandPoints(
  base: number[],
  rng: RNG,
  index: number,
  total: number,
  spread: number,
  twist: number,
): number[] {
  const n: number = base.length / 2
  const mid: number = (total - 1) / 2
  const lane: number = total > 1 ? (index - mid) / mid : 0
  const phase: number = rng.range(0, Math.PI * 2)
  const amp: number = spread * (0.35 + rng.range(0, 0.65))
  const weave: number = twist * rng.range(0.6, 1.4)
  const out: number[] = new Array(base.length)
  for (let i = 0; i < n; i++) {
    const t: number = n > 1 ? i / (n - 1) : 0
    const x: number = base[i * 2]
    const y: number = base[i * 2 + 1]
    // direction from neighbours for a stable normal
    const a: number = Math.max(0, i - 1) * 2
    const b: number = Math.min(n - 1, i + 1) * 2
    let dx: number = base[b] - base[a]
    let dy: number = base[b + 1] - base[a + 1]
    const len: number = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    // envelope: strands rejoin at the ends so bundles taper to points
    const env: number = Math.sin(Math.PI * Math.min(1, Math.max(0, t)))
    const lateral: number =
      lane * amp * (0.3 + 0.7 * env) + Math.sin(t * Math.PI * 2 * (1 + weave) + phase) * amp * 0.35 * weave * env
    out[i * 2] = x - dy * lateral + rng.normal(0, 0.5)
    out[i * 2 + 1] = y + dx * lateral + rng.normal(0, 0.5)
  }
  return out
}

/**
 * Tapered half-width at `t`: thin at both ends, full in the middle.
 */
export function strandWidth(t: number, width: number, taper: number): number {
  const env: number = Math.sin(Math.PI * Math.min(1, Math.max(0, t)))
  const k: number = Math.pow(Math.max(0, env), Math.max(0, taper))
  return Math.max(0.05, width * (0.08 + 0.92 * k))
}
