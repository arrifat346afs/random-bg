/**
 * filters/canvas.ts — The canvas pipeline for the filter stack.
 *
 * Pure (no DOM): works on raw RGBA bytes so it runs in workers, tests and
 * the browser. The DOM canvas wrappers live in `render/` and call this.
 */

import { getFilter } from './index'
import { getFiltered, setFiltered, filterCacheKey } from './cache'
import { activeFilters } from './stack'
import { filterSeed } from './kit'
import type { FilterInstance } from './types'

export interface FilterApplyOpts {
  /** per-layer seed (already mixed with the project seed) */
  seed: number
  /** layer content key from `pipeline.layerCacheKey` */
  contentKey?: string
  /**
   * Surface transform signature (CTM at the time the pixels were produced).
   * Part of the cache key: the cached buffer is a filtered surface in device
   * space, so it is only valid for the transform it was rendered under.
   */
  transform?: string
  /** use the bitmap cache (default true) */
  useCache?: boolean
}

/**
 * Apply an ordered filter stack to RGBA bytes. Returns a new array
 * (the input is never mutated). Deterministic for a fixed seed.
 */
export function applyFilterStack(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  filters: FilterInstance[],
  seed: number,
): Uint8ClampedArray {
  const active = filters.filter((f) => f.enabled && getFilter(f.type))
  if (active.length === 0) return src.slice()
  let cur = src
  for (const f of active) {
    const def = getFilter(f.type)
    if (!def) continue
    cur = def.apply(cur, w, h, f.params, filterSeed(seed, f.id))
  }
  return cur
}

/**
 * Cached variant keyed by content + stack + size. Changing a filter
 * re-applies pixels only — generation is never re-run.
 */
export function applyFilterStackCached(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  layer: { id: string; filters?: FilterInstance[]; filtersBypassed?: boolean },
  opts: FilterApplyOpts,
): Uint8ClampedArray {
  const filters = activeFilters(layer)
  if (filters.length === 0) return src.slice()
  if (opts.useCache !== false && opts.contentKey) {
    const key = filterCacheKey(opts.contentKey, filters, w, h, opts.seed, opts.transform)
    const hit = getFiltered(key)
    if (hit && hit.w === w && hit.h === h && hit.data.length === src.length) return hit.data.slice()
    const out = applyFilterStack(src, w, h, filters, opts.seed)
    setFiltered(key, out.slice(), w, h)
    return out
  }
  return applyFilterStack(src, w, h, filters, opts.seed)
}

/** Mean absolute error (0-255) between two RGBA buffers. */
export function meanAbsError(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length || a.length === 0) return NaN
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

/** True when a buffer contains only finite pixel values. */
export function isFiniteImage(data: Uint8ClampedArray): boolean {
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i])) return false
  }
  return true
}
