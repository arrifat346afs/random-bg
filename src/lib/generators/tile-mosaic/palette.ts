/**
 * tile-mosaic/palette.ts — Palette colour picking for mosaic triangles.
 *
 * Colours come from the layer palette (2–8 colours) plus a lighter/darker
 * ladder per pick. Three modes: seeded random, position gradient, noise
 * field. Pure, runs in Bun and in the render worker.
 */

import { createNoise, type Noise2D } from '../../noise'
import { rampColor } from '../../palette'
import type { RNG } from '../../rng'
import { darkenHex, lightenHex } from '../shade'

/** Colour-pick modes. */
export type MosaicMapping = 'random' | 'position' | 'noise'

/** True for every valid mapping id. */
export function isMosaicMapping(v: string): v is MosaicMapping {
  return v === 'random' || v === 'position' || v === 'noise'
}

/** Lazily built noise fields keyed by seed (mirrors `dist.ts` caching). */
const noiseCache = new Map<number, Noise2D>()

function fieldFor(seed: number): Noise2D {
  let n: Noise2D | undefined = noiseCache.get(seed)
  if (!n) {
    n = createNoise(seed)
    if (noiseCache.size > 24) noiseCache.clear()
    noiseCache.set(seed, n)
  }
  return n
}

/**
 * Pick a triangle colour.
 */
export function mosaicColor(
  rng: RNG,
  seed: number,
  colors: string[],
  cx: number,
  cy: number,
  w: number,
  h: number,
  mode: MosaicMapping,
  axisDeg: number,
  triIndex: number,
  shadeVariance: number,
): string {
  const list: string[] = colors.length ? colors : ['#ffffff']
  let base: string
  if (mode === 'position') {
    const a: number = (axisDeg * Math.PI) / 180
    const ex: number = (Math.abs(Math.cos(a)) * w) / 2 || 1
    const ey: number = (Math.abs(Math.sin(a)) * h) / 2 || 1
    const proj: number = (cx - w / 2) * Math.cos(a) + (cy - h / 2) * Math.sin(a)
    const extent: number = ex * Math.abs(Math.cos(a)) + ey * Math.abs(Math.sin(a)) || 1
    const t: number = Math.max(0, Math.min(1, 0.5 + proj / (2 * extent)))
    base = rampColor(list, t)
  } else if (mode === 'noise') {
    const n: Noise2D = fieldFor(seed)
    const v: number = n.fbm((cx / Math.max(1, Math.min(w, h))) * 3, (cy / Math.max(1, Math.min(w, h))) * 3, 3) * 0.5 + 0.5
    base = rampColor(list, Math.max(0, Math.min(1, v)))
  } else {
    base = list[Math.floor(rng.next() * list.length)] ?? '#ffffff'
  }
  // per-triangle shade step: alternate lighter / base / darker
  const v: number = Math.max(0, Math.min(1, shadeVariance))
  const step: number = (triIndex + Math.floor(rng.next() * 3)) % 3
  if (step === 0) return lightenHex(base, 0.45 * v)
  if (step === 2) return darkenHex(base, 0.45 * v)
  return base
}
