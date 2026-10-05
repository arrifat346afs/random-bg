/**
 * preview/gestureSurfaces.ts — the two surfaces a drag draws from.
 *
 * While a layer is being dragged nothing is rasterised. Instead the stage blits:
 *
 *   below   everything painted under the dragged layer, composited once
 *   self    the dragged layer alone, its filter stack already applied
 *
 * `self` is rendered at the **identity** and placed by the blit, which is what
 * makes the live transform free — the same pixels serve every offset, scale and
 * rotation until the gesture ends.
 *
 * Snapshots are cached per layer and per resolution. Building one costs about
 * 0.03 ms per primitive (measured: 77 ms on a 2.3k-primitive layer, 165 ms on a
 * heavier one), so only the *first* drag of a given layer at a given zoom pays
 * it; every later drag of the same layer blits straight away. That is the
 * difference between a cost you notice once and a cost you feel every time.
 */

import { drawIR } from '@/lib/render/canvas'
import { composeIR, type LayerResult } from '@/lib/pipeline'
import { buildIR, type IR } from '@/lib/ir'
import { activeFilters } from '@/lib/filters/stack'
import type { FilterInstance } from '@/lib/filters/types'
import { pivotOf } from '@/lib/transform'
import { nodesContentBounds } from '@/lib/render/reach'
import type { Layer, Project } from '@/lib/schema'

/**
 * The snapshot is drawn at a fraction of the raster resolution.
 *
 * A glow layer is soft by construction and the committed re-raster on
 * pointer-up restores full sharpness immediately, so full resolution here buys
 * detail nobody can see for the length of a gesture. This is the same reasoning
 * as `drawBlurredWide`'s reduced-resolution blur path: blur is forgiving,
 * cropping is not.
 *
 * Past `SNAPSHOT_NODE_BUDGET` nodes the fraction drops further: building the
 * snapshot costs ~0.006 ms per node (measured), so a 40k-node layer would hitch
 * for ~235 ms at half resolution versus ~165 ms at quarter — and the gesture it
 * unlocks runs at 0.1 ms a frame either way.
 */
export const SNAPSHOT_RESOLUTION = 0.5
const SNAPSHOT_NODE_BUDGET = 20000
const SNAPSHOT_RESOLUTION_LARGE = 0.25

/** Cached entries; two surfaces each, so this bounds device memory. */
const SNAPSHOT_CACHE_MAX = 8

export interface GestureSurfaces {
  /** the **raster** scale this was built for — the drift check's datum */
  forUnit: number
  below: HTMLCanvasElement
  self: HTMLCanvasElement
  pivot: { x: number; y: number }
  blend: GlobalCompositeOperation
  opacity: number
}

const cache = new Map<string, GestureSurfaces>()

/** Cache key: which layer, which raster scale, and whose pixels. */
function key(layerId: string, unit: number, contentVersion: number): string {
  return `${layerId}|${unit.toFixed(4)}|${contentVersion}`
}

/** Hand back the cached snapshot, or build and remember it. Evicts oldest-first. */
export function acquireSurfaces(
  layerId: string,
  unit: number,
  contentVersion: number,
  build: () => GestureSurfaces | null,
): GestureSurfaces | null {
  const k = key(layerId, unit, contentVersion)
  const hit = cache.get(k)
  if (hit) {
    cache.delete(k)
    cache.set(k, hit)
    return hit
  }
  const made = build()
  if (!made) return null
  cache.set(k, made)
  while (cache.size > SNAPSHOT_CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return made
}

/** Drop every cached snapshot — called when the artwork itself changes. */
export function clearSurfaces(): void {
  cache.clear()
}

/**
 * Build the two surfaces for one layer.
 *
 * Both go through `composeIR`, so every *other* layer's committed placement and
 * filter grouping is resolved by exactly the code the exporters use. The dragged
 * layer is rendered at the identity, because the blit applies the live transform
 * itself — that is the whole trick.
 */
export function buildSurfaces(
  ir: IR,
  project: Project,
  results: LayerResult[],
  layer: Layer,
  forUnit: number,
): GestureSurfaces | null {
  const selfResult = results.find((r) => r.layerId === layer.id)
  if (!selfResult) return null
  // Large layers get a softer snapshot: the build cost is per node, and a
  // quarter-resolution glow is indistinguishable mid-gesture from a half one.
  const res = selfResult.ir.stats.count > SNAPSHOT_NODE_BUDGET
    ? SNAPSHOT_RESOLUTION_LARGE
    : SNAPSHOT_RESOLUTION
  const unit = forUnit * res
  const w = Math.max(1, Math.round(ir.w * unit))
  const h = Math.max(1, Math.round(ir.h * unit))

  const belowIR = composeIR(
    { ...project, layers: project.layers.filter((l) => l.id !== layer.id) },
    results.filter((r) => r.layerId !== layer.id),
  )
  const filters = activeFilters(layer)
  const below = paint(w, h, unit, belowIR)
  // `lid` is what routes the layer through the filter path; stamp it exactly as
  // `composeIR` would, so the snapshot's pixels match the committed render.
  const selfIR = buildIR(
    ir.w,
    ir.h,
    filters.length > 0
      ? selfResult.ir.nodes.map((n) => ({ ...n, lid: layer.id }))
      : selfResult.ir.nodes,
  )
  const self = paint(w, h, unit, selfIR, layer.id, filters)
  if (!below || !self) return null
  return {
    forUnit,
    below,
    self,
    pivot: pivotOf(nodesContentBounds(selfResult.ir.nodes)),
    blend: canvasBlend(layer.blend),
    opacity: layer.opacity,
  }
}

/** Rasterise one IR at `unit` into a fresh canvas. */
function paint(
  w: number,
  h: number,
  unit: number,
  ir: IR,
  lid?: string,
  filters?: FilterInstance[],
): HTMLCanvasElement | null {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(unit, 0, 0, unit, 0, 0)
  drawIR(ctx, ir, 1, undefined, lid && filters ? { layerFilters: { [lid]: filters } } : undefined)
  return c
}

/** Canvas blend name for a layer blend mode. */
function canvasBlend(b: string | undefined): GlobalCompositeOperation {
  if (!b || b === 'normal') return 'source-over'
  if (b === 'plus-lighter') return 'lighter'
  return b as GlobalCompositeOperation
}