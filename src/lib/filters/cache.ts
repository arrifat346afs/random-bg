/**
 * filters/cache.ts — Bitmap cache for filtered layers.
 *
 * Keyed by `layer content hash + filter stack hash + size`, held outside the
 * store (a plain module-level Map). Changing a filter re-applies pixels only —
 * generation (`pipeline.ts`) is never re-run for a filter edit.
 */

import type { FilterInstance } from './types'
import { filterStackHash } from './stack'

const MAX_ENTRIES = 24
const MAX_PIXELS = 24_000_000

interface Entry {
  data: Uint8ClampedArray
  w: number
  h: number
  pixels: number
}

const cache = new Map<string, Entry>()
let cachePixels = 0

/**
 * Cache key: content + stack + surface size + seed + **transform**.
 *
 * The transform is part of the key because the cached pixels are a filtered
 * surface sized in *device* space: the same layer rendered at a different zoom
 * or export scale needs a differently-sized surface, and handing back the old
 * one would composite the layer at the wrong scale (or offset it by a stale
 * origin). `w x h` alone does not distinguish "same surface, different CTM".
 */
export function filterCacheKey(
  contentKey: string,
  filters: FilterInstance[],
  w: number,
  h: number,
  seed: number,
  transform = '',
): string {
  return `${contentKey}|${filterStackHash(filters)}|${w}x${h}|${transform}|${seed}`
}

export function getFiltered(key: string): Entry | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  // promote to most-recently-used
  cache.delete(key)
  cache.set(key, hit)
  return hit
}

export function setFiltered(key: string, data: Uint8ClampedArray, w: number, h: number): void {
  const prev = cache.get(key)
  if (prev) cachePixels -= prev.pixels
  cache.delete(key)
  const pixels = w * h
  cache.set(key, { data, w, h, pixels })
  cachePixels += pixels
  while ((cache.size > MAX_ENTRIES || cachePixels > MAX_PIXELS) && cache.size > 1) {
    const oldest = cache.keys().next().value
    if (oldest === undefined || oldest === key) break
    const victim = cache.get(oldest)
    if (victim) cachePixels -= victim.pixels
    cache.delete(oldest)
  }
}

export function clearFilterCache(): void {
  cache.clear()
  cachePixels = 0
}
