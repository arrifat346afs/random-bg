/**
 * field/lattice.ts — Jittered control lattice with domain warp.
 *
 * The shared layout primitive for mesh gradients (and later liquid/silk
 * fields): a small grid of colour control points in normalised 0..1 space,
 * jittered so it never reads as a stamped grid, then displaced by an fBm
 * domain warp so colour regions flow organically. Generation stays in
 * normalised space; callers scale to canvas units.
 */

import type { RNG } from '../rng'
import { createNoise } from '../noise'
import { rampColor } from '../palette'

/** One colour control point. `u`/`v` are normalised 0..1 before warp. */
export interface LatticePoint {
  u: number
  v: number
  /** warped position, still normalised */
  x: number
  y: number
  color: string
}

/** How control-point colours are assigned from the palette. */
export type LatticeMapping = 'ramp' | 'random'

export function isLatticeMapping(v: string): v is LatticeMapping {
  return v === 'ramp' || v === 'random'
}

/** Maximum warp displacement as a fraction of the canvas min dimension. */
export const WARP_REACH = 0.28

export interface LatticeOpts {
  cols: number
  rows: number
  /** jitter as a fraction of one cell (0 = exact grid) */
  jitter: number
  /** domain-warp amount 0..1 */
  warp: number
  /** fBm frequency of the warp field */
  warpScale: number
  mapping: LatticeMapping
}

/**
 * Build a warped control lattice. Deterministic in `rng` + `seed`: the same
 * inputs always place the same points with the same colours.
 */
export function buildLattice(
  rng: RNG,
  seed: number,
  colors: string[],
  opts: LatticeOpts,
): LatticePoint[] {
  const palette = colors.length ? colors : ['#ffffff']
  const warpRng = rng.fork('lattice')
  const noise = createNoise(seed)
  const pts: LatticePoint[] = []
  for (let r = 0; r < opts.rows; r++) {
    for (let c = 0; c < opts.cols; c++) {
      const cu = opts.cols === 1 ? 0.5 : c / (opts.cols - 1)
      const cv = opts.rows === 1 ? 0.5 : r / (opts.rows - 1)
      const cellU = opts.cols === 1 ? 1 : 1 / (opts.cols - 1)
      const cellV = opts.rows === 1 ? 1 : 1 / (opts.rows - 1)
      const u = cu + warpRng.normal(0, 0.5) * opts.jitter * Math.min(cellU, 1)
      const v = cv + warpRng.normal(0, 0.5) * opts.jitter * Math.min(cellV, 1)
      const t = Math.max(0, Math.min(1, (cu + cv) / 2))
      const color =
        opts.mapping === 'random'
          ? palette[Math.floor(warpRng.next() * palette.length)] ?? palette[0]
          : rampColor(palette, t, 'linear')
      const wob = opts.warp * WARP_REACH
      const x = u + noise.fbm(u * opts.warpScale, v * opts.warpScale, 3) * wob
      const y = v + noise.fbm(u * opts.warpScale + 7.3, v * opts.warpScale - 2.1, 3) * wob
      pts.push({ u, v, x, y, color })
    }
  }
  return pts
}
