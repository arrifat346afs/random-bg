/**
 * gesturePlacement.ts — the gesture blit's placement, as pure math.
 *
 * The live artwork during a drag must land exactly where the committed render
 * will: at `applyMatrix(transformMatrix(t, pivot), p)` for every point `p`.
 * `transformMatrix` already folds the pivot into `e,f`, so the blit applies
 * the matrix ONCE (`ctx.transform(m.a,…,m.f)`). Applying `translate(m.e,m.f)`
 * + `transform(linear)` + `translate(-pivot)` counts the pivot twice and
 * displaces the artwork by `-L*pivot` (the drag/snaps-back bug).
 *
 * The self snapshot covers the layer's untransformed render bounds — geometry
 * grown by stroke/blur/filter spread, NOT clamped to the canvas — so content
 * overflowing the canvas survives the gesture and can be dragged into view.
 * The snapshot canvas's origin in canvas units travels with the surfaces; the
 * blit draws the image at that origin under the live matrix.
 *
 * Pure: no DOM, no React, no store. The preview, the tests and the bounds code
 * all derive from the same functions.
 */

import type { FilterInstance } from './filters/types'
import type { Node } from './ir'
import type { Rect } from './render/bounds'
import { nodesContentBounds, renderBounds } from './render/reach'
import {
  applyMatrix,
  quadBounds,
  transformMatrix,
  transformQuad,
  type LayerTransform,
  type Matrix,
  type Pivot,
  type Point,
} from './transform'

/**
 * The matrix the gesture blit must apply for the dragged layer.
 * Single application: the pivot is already inside `e,f`.
 */
export function gestureSelfMatrix(t: LayerTransform, pivot: Pivot): Matrix {
  return transformMatrix(t, pivot)
}

/** Where a layer-local point lands on canvas under the live transform. */
export function gestureLivePoint(t: LayerTransform, pivot: Pivot, p: Point): Point {
  return applyMatrix(gestureSelfMatrix(t, pivot), p)
}

/**
 * The canvas-units rect the self snapshot must cover: untransformed render
 * bounds (spread included), never clamped to the canvas. Falls back to raw
 * content bounds, then to the full canvas when nothing is measurable.
 */
export function selfSnapshotBounds(
  nodes: readonly Node[],
  filters: readonly FilterInstance[],
  canvasW: number,
  canvasH: number,
): Rect {
  const spreadCtx = { width: canvasW, height: canvasH }
  const expanded = renderBounds(nodes, {
    filters,
    spreadCtx,
  })
  const content = expanded ?? nodesContentBounds(nodes)
  if (!content) return { x0: 0, y0: 0, x1: canvasW, y1: canvasH }
  // Floor/ceil + 1px antialias slack so edge pixels are never sliced by rounding.
  return {
    x0: Math.floor(content.x0) - 1,
    y0: Math.floor(content.y0) - 1,
    x1: Math.ceil(content.x1) + 1,
    y1: Math.ceil(content.y1) + 1,
  }
}

/** Pixel size of a snapshot rect at a raster unit. */
export function snapshotPixelSize(r: Rect, unit: number): { w: number; h: number } {
  return {
    w: Math.max(1, Math.round((r.x1 - r.x0) * unit)),
    h: Math.max(1, Math.round((r.y1 - r.y0) * unit)),
  }
}

/**
 * Parity helper: the gesture path and the committed `composeIR`/`drawIR` path
 * agree when the gesture matrix equals the committed matrix and the layer's
 * transformed quad matches the transform box within tolerance.
 */
export function gestureParityQuad(local: Rect, t: LayerTransform, pivot: Pivot): Rect {
  return quadBounds(transformQuad(local, gestureSelfMatrix(t, pivot)))
}
