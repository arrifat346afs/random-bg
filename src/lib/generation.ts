/**
 * generation.ts — "will this project produce different pixels from the engine?"
 *
 * The answer decides whether the render loop runs at all. A move, a resize, a
 * rotation and a filter edit all change the picture but none of them changes
 * *geometry*, so none of them may start a generation: doing so posted the whole
 * project to the worker, cloned every result back, and made `composeIR` return
 * a new IR — which invalidated the preview's raster cache and re-rasterised
 * every primitive and filter on the main thread, once per pointermove.
 *
 * Derived rather than flagged. Callers cannot forget to set a "transform-only"
 * flag; they can only change the project, and this compares what actually
 * determines the engine's output.
 */

import { layerCacheKey, MAX_PRIMITIVES } from './pipeline'
import type { Project } from './schema'

/**
 * A signature covering every input `generateLayer` reads.
 *
 * Built from `layerCacheKey`, which is already memoised per `Layer` object. An
 * untouched layer keeps its identity, so its contribution is a cached string and
 * the whole signature costs one hash per layer plus the string joins — cheap
 * enough to evaluate on every commit.
 *
 * Deliberately excludes `Layer.transform`: the placement is applied to the CTM
 * at compose time (`composeIR`), never baked into geometry, so a moved layer
 * must keep hitting the same cache entry. This mirrors the note in
 * `layerCacheKey`, and the two are checked against each other by the regression
 * gate so they cannot drift.
 */
export function generationSignature(project: Project): string {
  const parts: string[] = [
    `${project.seed}`,
    `${project.canvas.w}x${project.canvas.h}`,
    // the palette reaches layers that link to it, so it is part of every
    // linked layer's cache key and needs no separate term here
  ]
  for (const l of project.layers) {
    parts.push(`${l.id}:${l.gen}:${l.visible ? 1 : 0}:${l.solo ? 1 : 0}:${l.locked ? 1 : 0}`)
    parts.push(layerCacheKey(l, project, MAX_PRIMITIVES))
  }
  return parts.join('|')
}