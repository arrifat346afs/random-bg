/**
 * scene3d/depth.ts — Depth cues as pure functions of normalised depth.
 *
 * All cues take depth in 0..1 (0 = near plane, 1 = far) and return plain
 * numbers/hex — no IR, no RNG, trivially unit-testable:
 *  - perspective size scale (true perspective: reference/dist),
 *  - fog opacity falloff (monotonic in depth),
 *  - line-width falloff,
 *  - atmospheric colour shift toward the background,
 *  - circle of confusion from focal distance + range + DOF strength
 *    (monotonic in |depth − focus| past the focal range).
 */

import { mixColor } from '../palette'
import { clamp, clamp01 } from './math'

/** True-perspective size multiplier: 1 at the reference distance. */
export function perspScale(dist: number, ref: number): number {
  if (!(dist > 0) || !(ref > 0)) return 1
  return clamp(ref / dist, 0.15, 6)
}

/** Fog: opacity multiplier, strictly decreasing in depth. */
export function fogAlpha(depth01: number, fogDensity: number): number {
  const d = clamp01(depth01)
  const k = clamp(fogDensity, 0, 1)
  return clamp01(1 - d * (0.15 + 0.75 * k))
}

/** Line width multiplier: nearer lines read thicker. */
export function widthAt(depth01: number, falloff: number): number {
  return clamp(1 - clamp01(depth01) * clamp(falloff, 0, 1) * 0.65, 0.35, 1)
}

/** Atmospheric perspective: drift the colour toward the background. */
export function atmShift(color: string, bg: string, depth01: number, amount: number): string {
  const k = clamp01(clamp01(depth01) * clamp(amount, 0, 1) * 0.7)
  if (k <= 0.001) return color
  return mixColor(color, bg, k)
}

/**
 * Circle of confusion in px: 0 inside the focal range, then growing with
 * |depth − focus|. Zero when DOF is off.
 */
export function cocRadius(
  depth01: number,
  focal: number,
  focalRange: number,
  dof: number,
  maxR: number,
): number {
  if (!(dof > 0.001) || !(maxR > 0)) return 0
  const d = Math.max(0, Math.abs(clamp01(depth01) - clamp01(focal)) - Math.max(0, focalRange))
  return d * clamp01(dof) * maxR
}

/** Which painter's slab (0 = farthest) a depth falls into. */
export function slabOf(depth01: number, slabs: number): number {
  const n = Math.max(1, Math.round(slabs))
  return Math.max(0, Math.min(n - 1, Math.floor((1 - clamp01(depth01)) * n)))
}
