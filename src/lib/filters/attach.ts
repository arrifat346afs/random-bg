/**
 * filters/attach.ts — Build the per-layer filter lookup the backends consume.
 *
 * `Node.lid` says *which* layer a node belongs to; this turns the project into
 * the id → stack map that `render/canvas.ts` and `render/svg.ts` read. Kept
 * separate from both so the preview, every exporter and the quality gate cannot
 * disagree about what a layer's stack is.
 */

import { hash32 } from '../rng'
import type { Project } from '../schema'
import type { FilterInstance } from './types'
import { activeFilters, stackNeedsRaster } from './stack'

/**
 * `{ layerId: enabled stack }` for layers that have one.
 *
 * Layers with an empty stack are simply absent, which is what makes the
 * renderers' no-filter path identical to the pre-filter behaviour.
 */
export function layerFilterMap(project: Project): Record<string, FilterInstance[]> {
  const out: Record<string, FilterInstance[]> = {}
  for (const layer of project.layers) {
    const active = activeFilters(layer)
    if (active.length > 0) out[layer.id] = active
  }
  return out
}

/**
 * Per-layer seed for the noise-bearing filters (grain, roughen, turbulence).
 *
 * Derived from the project seed and the layer's stable `salt` — never from its
 * `id`, which carries `Date.now()` + `Math.random()` and would make the same
 * seed render differently on every load.
 */
export function layerFilterSeeds(project: Project): (layerId: string) => number {
  const byId = new Map(project.layers.map((l) => [l.id, l.salt ?? hash32(l.id)]))
  return (layerId: string) => hash32(project.seed, byId.get(layerId) ?? layerId)
}

/** Both halves in one call — what every caller actually wants. */
export function projectFilterOpts(project: Project): {
  layerFilters: Record<string, FilterInstance[]>
  filterSeedOf: (layerId: string) => number
} {
  return { layerFilters: layerFilterMap(project), filterSeedOf: layerFilterSeeds(project) }
}

/**
 * Layer ids whose enabled stack cannot be expressed as an SVG `<filter>` and
 * therefore rasterise to `<image>` on export.
 */
export function rasterFilteredLayers(project: Project): string[] {
  return Object.entries(layerFilterMap(project))
    .filter(([, filters]) => stackNeedsRaster(filters))
    .map(([id]) => id)
}