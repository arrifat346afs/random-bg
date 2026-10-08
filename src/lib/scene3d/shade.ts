/**
 * scene3d/shade.ts — Simple bounded lighting for 3D surfaces and nodes.
 *
 * Lambert diffuse from one direction + rim light by view angle + crest
 * highlight by relative height. Highlights mix toward white but are
 * soft-clipped well below pure white, and chroma is capped, so the
 * harshness gate holds. Hex in, hex out — no DOM.
 */

import { mixColor } from '../palette'
import { capChroma, capYellow } from '../field/oklab'
import { clamp01 } from './math'

export interface ShadeOpts {
  /** diffuse strength 0..1 */
  diffuse: number
  /** rim strength 0..1 */
  rim: number
  /** crest highlight strength 0..1 */
  crest: number
  /** OKLCH chroma ceiling */
  chromaCap: number
}

/** Soft clip: highlights roll off instead of hitting white. */
export function softClip(t: number): number {
  const x = clamp01(t)
  return x / (1 + x * 0.55)
}

/** Lambert term for a unit normal and a unit light direction. */
export function lambert(nx: number, ny: number, nz: number, lx: number, ly: number, lz: number): number {
  return clamp01((nx * lx + ny * ly + nz * lz) * 0.5 + 0.5)
}

function tame(c: string, cap: number): string {
  return capYellow(capChroma(c, cap))
}

/**
 * Shade one surface point. `view` is the unit vector from the point toward
 * the camera; `h01` is the relative crest height (0 valleys, 1 crests).
 */
export function shadePoint(
  base: string,
  nx: number,
  ny: number,
  nz: number,
  view: { x: number; y: number; z: number },
  h01: number,
  lx: number,
  ly: number,
  lz: number,
  o: ShadeOpts,
): string {
  const dif = lambert(nx, ny, nz, lx, ly, lz)
  const facing = clamp01(nx * view.x + ny * view.y + nz * view.z)
  const rim = Math.pow(1 - facing, 2) * o.rim
  const crest = clamp01(h01) * clamp01(h01) * o.crest
  // valleys deepen toward the base hue instead of going black
  let c = mixColor(base, '#0a0f1e', (1 - dif) * 0.45 * o.diffuse)
  const lift = softClip((dif * 0.5 * o.diffuse + rim + crest) * 0.62)
  c = mixColor(c, '#ffffff', lift)
  return tame(c, o.chromaCap)
}
