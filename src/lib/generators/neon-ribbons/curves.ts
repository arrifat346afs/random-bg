/**
 * neon-ribbons/curves.ts — Parametric centre-lines for ribbon bundles.
 *
 * Each function maps t∈[0,1] to a point; `traceCurve` samples one into a flat
 * polyline. All deterministic given the inputs — randomness lives in the
 * caller, which offsets and rotates the result per strand.
 */

import type { RNG } from '../../rng'

/** Ribbon centre-line families. */
export type CurveKind =
  | 'swirl'
  | 'ellipse'
  | 'sCurve'
  | 'bezier'
  | 'fan'
  | 'chevron'
  | 'vortex'

/** True for every valid curve id; guards hand-written project JSON. */
export function isCurveKind(v: string): v is CurveKind {
  return (
    v === 'swirl' ||
    v === 'ellipse' ||
    v === 'sCurve' ||
    v === 'bezier' ||
    v === 'fan' ||
    v === 'chevron' ||
    v === 'vortex'
  )
}

/** Inputs a curve needs beyond (t, centre, size). */
export interface CurveOpts {
  rotation: number
  perspective: number
  seedPick: number
}

/**
 * Sample one centre-line into a flat [x0,y0,…] polyline.
 */
export function traceCurve(
  kind: CurveKind,
  rng: RNG,
  cx: number,
  cy: number,
  size: number,
  samples: number,
  opts: CurveOpts,
): number[] {
  const pts: number[] = []
  const rot: number = opts.rotation + rng.range(-0.4, 0.4)
  const cos: number = Math.cos(rot)
  const sin: number = Math.sin(rot)
  const squash: number = Math.max(0.15, Math.min(1, opts.perspective))
  // per-ribbon variation that survives without touching the parent stream
  const wob: number = rng.range(0.7, 1.3)
  const ph: number = rng.range(0, Math.PI * 2)

  for (let i = 0; i <= samples; i++) {
    const t: number = i / samples
    let x = 0
    let y = 0
    switch (kind) {
      case 'swirl': {
        const turns = 1.2 + (opts.seedPick % 5) * 0.35
        const a: number = ph + t * turns * Math.PI * 2
        const r: number = size * (0.08 + 0.92 * t) * wob
        x = Math.cos(a) * r
        y = Math.sin(a) * r * squash + (t - 0.5) * size * 0.2
        break
      }
      case 'ellipse': {
        const a: number = t * Math.PI * 2
        x = Math.cos(a) * size * wob
        y = Math.sin(a) * size * squash
        break
      }
      case 'sCurve': {
        x = (t - 0.5) * size * 2.2
        y = Math.sin(t * Math.PI * 2 + ph) * size * 0.55 * wob
        break
      }
      case 'bezier': {
        // cubic sweep: control points jittered by the ribbon rng
        const c1x = -size * 0.6 * wob
        const c1y = -size * (0.5 + 0.4 * Math.sin(ph))
        const c2x = size * 0.6 * wob
        const c2y = size * (0.5 + 0.4 * Math.cos(ph))
        const u: number = t
        const v: number = 1 - u
        x = v * v * v * -size + 3 * v * v * u * c1x + 3 * v * u * u * c2x + u * u * u * size
        y = v * v * v * -size * 0.5 + 3 * v * v * u * c1y + 3 * v * u * u * c2y + u * u * u * size * 0.5
        break
      }
      case 'fan': {
        // near-straight converging beam; per-strand offsets fan it out
        x = (t - 0.5) * size * 2.4
        y = (t - 0.5) * (t - 0.5) * size * 0.8 * Math.sin(ph)
        break
      }
      case 'chevron': {
        // arrow: two segments meeting at a head near t=0.8
        const head = 0.78
        const arm: number = size * 0.5 * wob
        if (t < head) {
          const k: number = t / head
          x = (k - 0.6) * size * 2
          y = 0
        } else {
          const k: number = (t - head) / (1 - head)
          const side: number = Math.sin(ph) > 0 ? 1 : -1
          x = size * 0.8 - k * arm
          y = k * arm * 0.6 * side
        }
        break
      }
      case 'vortex': {
        const a: number = ph + t * Math.PI * 2 * 1.05
        const r: number = size * (1 - t * 0.55) * wob
        x = Math.cos(a) * r
        y = Math.sin(a) * r * squash
        break
      }
    }
    pts.push(cx + x * cos - y * sin, cy + x * sin + y * cos)
  }
  return pts
}
