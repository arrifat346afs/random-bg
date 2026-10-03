/**
 * filters/stack.ts — Pure helpers for the ordered filter stack.
 *
 * Every function returns new objects; the store commits the result via
 * `updateLayer`. Kept pure (no store import) so it stays testable.
 */

import { hash32 } from '../rng'
import type { Layer, Params } from '../schema'
import { getFilter } from './index'
import { newFilterId } from './kit'
import type { FilterInstance, SpreadCtx } from './types'

export type { SpreadCtx }

/** Filters every layer carries when none were saved (legacy projects). */
export function ensureFilters(layer: Layer): FilterInstance[] {
  return Array.isArray(layer.filters) ? layer.filters : []
}

/** Default params for a filter type (from its schema defaults). */
export function defaultFilterParams(type: string): Params {
  const def = getFilter(type)
  const out: Params = {}
  if (!def) return out
  for (const p of def.params) out[p.key] = p.default
  return out
}

/** Create one filter instance with schema defaults. */
export function createFilter(type: string, overrides?: Params): FilterInstance | null {
  if (!getFilter(type)) return null
  return {
    id: newFilterId(),
    type,
    enabled: true,
    params: { ...defaultFilterParams(type), ...overrides },
  }
}

/** `createFilter` for callers that have verified the type exists. */
export function makeFilter(type: string, overrides?: Params): FilterInstance {
  const f = createFilter(type, overrides)
  if (!f) throw new Error(`unknown filter type: ${type}`)
  return f
}

/** Append a filter to the layer's stack. */
export function addFilter(layer: Layer, type: string, overrides?: Params): Layer {
  const inst = createFilter(type, overrides)
  if (!inst) return layer
  return { ...layer, filters: [...ensureFilters(layer), inst] }
}

/** Replace the whole stack (preset apply, reset). */
export function setFilters(layer: Layer, filters: FilterInstance[]): Layer {
  return { ...layer, filters }
}

/** Remove one entry by id. */
export function removeFilter(layer: Layer, id: string): Layer {
  return { ...layer, filters: ensureFilters(layer).filter((f) => f.id !== id) }
}

/** Move one entry (reorder). */
export function moveFilter(layer: Layer, from: number, to: number): Layer {
  const list = ensureFilters(layer).slice()
  if (from < 0 || from >= list.length) return layer
  const clamped = Math.max(0, Math.min(list.length - 1, to))
  const [item] = list.splice(from, 1)
  list.splice(clamped, 0, item)
  return { ...layer, filters: list }
}

/** Patch one entry's fields. */
export function patchFilter(layer: Layer, id: string, patch: Partial<FilterInstance>): Layer {
  return {
    ...layer,
    filters: ensureFilters(layer).map((f) => (f.id === id ? { ...f, ...patch } : f)),
  }
}

/** Patch one param of one entry. */
export function setFilterParam(layer: Layer, id: string, key: string, value: Params[string]): Layer {
  return {
    ...layer,
    filters: ensureFilters(layer).map((f) =>
      f.id === id ? { ...f, params: { ...f.params, [key]: value } } : f,
    ),
  }
}

/** Duplicate one entry (inserted right after the original). */
export function duplicateFilter(layer: Layer, id: string): Layer {
  const list = ensureFilters(layer)
  const idx = list.findIndex((f) => f.id === id)
  if (idx < 0) return layer
  const copy: FilterInstance = { ...structuredClone(list[idx]), id: newFilterId() }
  const next = list.slice()
  next.splice(idx + 1, 0, copy)
  return { ...layer, filters: next }
}

/** Clear the whole stack. */
export function resetFilters(layer: Layer): Layer {
  return { ...layer, filters: [] }
}

/** Only the enabled entries, in order. */
export function activeFilters(layer: Pick<Layer, 'filters' | 'filtersBypassed'>): FilterInstance[] {
  if (layer.filtersBypassed) return []
  return (layer.filters ?? []).filter((f) => f.enabled && getFilter(f.type))
}

/** Content hash of the stack (order + type + params + enabled). */
export function filterStackHash(filters: FilterInstance[] | undefined): string {
  if (!filters || filters.length === 0) return 'nofilter'
  return hash32(JSON.stringify(filters.map((f) => [f.type, f.enabled ? 1 : 0, f.params]))).toString(36)
}

/** True when any enabled filter is raster-only (needs `<image>` on SVG export). */
export function stackNeedsRaster(filters: FilterInstance[]): boolean {
  return filters.some((f) => {
    if (!f.enabled) return false
    const def = getFilter(f.type)
    return !!def && (!def.isVectorSafe || def.rasterOnly)
  })
}

/**
 * How far (in canvas units) the stack can push pixels away from where they
 * started — the sum of every enabled filter's `spread`.
 *
 * `ctx` is the canvas size in IR units, needed by the filters whose reach is
 * relative to it (radial / zoom blur sample out toward the farthest corner).
 * `renderBounds` grows a layer's surface by exactly this, so a filter that
 * declares no `spread` is a filter whose pixels can be sliced off at the
 * surface edge — a hard, straight cut rather than a fade.
 */
export function stackSpread(filters: readonly FilterInstance[], ctx: SpreadCtx): number {
  let sum = 0
  for (const f of filters) {
    if (!f.enabled) continue
    const def = getFilter(f.type)
    const s = def?.spread?.(f.params, ctx) ?? 0
    if (Number.isFinite(s) && s > 0) sum += s
  }
  return sum
}
