/**
 * select.ts — hit-testing and boxes for the canvas overlay.
 *
 * Two rectangles, deliberately distinct, both derived from the same
 * `renderBounds` family so they cannot drift:
 *
 *   layerGeometryBox  the layer's **geometry**, transformed, *unclamped*. This is
 *                     what the transform box and its handles attach to — handles
 *                     must hug the artwork, and a box clamped to the canvas
 *                     cannot express a layer dragged half off the edge.
 *   layerBoundsFor    content grown by stroke, blur and every filter's spread,
 *                     clamped to the canvas. This is the *renderer's* rectangle:
 *                     it is what a clip is sized from, so it is the honest
 *                     answer to "how much of this layer is visible".
 *
 * Hit-testing stays on the cheaper `contentBounds`, deliberately **bounding box**,
 * not exact-shape. A glow layer is thousands of mostly-transparent particles;
 * testing real containment would mean parsing thousands of paths on every click,
 * and a click landing in a gap between particles inside a layer's extent still
 * selects that layer — which is what you want when the pixels there are 2 % alpha.
 */

import { contentBounds } from './render/bounds'
import { nodesContentBounds, renderBounds } from './render/reach'
import { activeFilters } from './filters/stack'
import type { LayerResult } from './pipeline'
import { layerTransformOf, type Layer, type Project } from './schema'
import { pivotOf, transformMatrix, transformQuad, quadBounds, type Matrix, type Quad } from './transform'
import type { Node } from './ir'

/** Union of a node list's geometry, in its own (untransformed) space. */
export function boundsOfNodes(nodes: Node[], dx = 0, dy = 0) {
  return nodesContentBounds(nodes, dx, dy)
}

/**
 * Inverse of a layer's placement: maps a canvas point back into the layer's own
 * geometry space, so a hit test can compare against untransformed bounds.
 */
function layerMatrix(l: Layer, nodes: Node[]): Matrix {
  const local = nodesContentBounds(nodes)
  return transformMatrix(layerTransformOf(l), pivotOf(local))
}

/** Is (x, y) inside any node's extent, in the layer's own space? */
function hitsLocal(nodes: Node[], x: number, y: number): boolean {
  for (const n of nodes) {
    const b = contentBounds(n)
    if (!b) continue
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return true
  }
  return false
}

/**
 * Topmost layer whose extent covers the point.
 *
 * Walks results back-to-front so the visually topmost layer wins, mirroring how
 * the nodes were composited. Locked layers are still hit — you can select and
 * look at them, just not move them (the drag handler checks that separately).
 */
export function hitTestLayers(
  results: LayerResult[],
  project: Project,
  x: number,
  y: number,
): string | null {
  const byId = new Map(project.layers.map((l) => [l.id, l]))
  const inv = new Map<string, Matrix | null>()
  for (const r of results) {
    const l = byId.get(r.layerId)
    if (!l) continue
    inv.set(r.layerId, invert(layerMatrix(l, r.ir.nodes)))
  }
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i]
    const m = inv.get(r.layerId)
    // a singular transform (zero scale) has no inverse; fall back to the
    // untransformed bounds so the layer stays clickable rather than vanishing
    const local = m ? { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f } : { x, y }
    if (hitsLocal(r.ir.nodes, local.x, local.y)) return r.layerId
  }
  return null
}

/** The layer's `LayerResult`, or null when hidden or excluded by solo. */
function resultFor(results: LayerResult[], layerId: string): LayerResult | null {
  return results.find((x) => x.layerId === layerId) ?? null
}

/**
 * The layer's geometry in its **own** space, before any placement.
 *
 * This is the one measurement the transform overlay needs: cache it once and
 * apply whichever transform is current — the committed one, or the live one
 * mid-gesture — with `transformQuad`. Nothing re-measures geometry per frame.
 */
export function layerLocalBounds(results: LayerResult[], layerId: string) {
  const r = resultFor(results, layerId)
  return r ? nodesContentBounds(r.ir.nodes) : null
}

/**
 * The transform box: the layer's geometry after its placement, as four corners.
 *
 * Unclamped on purpose — a layer dragged off the canvas still shows its box, the
 * way it does in a paint app. The stage does not clip the overlay.
 */
export function layerGeometryQuad(
  results: LayerResult[],
  project: Project,
  layerId: string,
): Quad | null {
  const r = resultFor(results, layerId)
  if (!r) return null
  const layer = project.layers.find((l) => l.id === layerId)
  if (!layer) return null
  const local = nodesContentBounds(r.ir.nodes)
  if (!local) return null
  return transformQuad(local, layerMatrix(layer, r.ir.nodes))
}

/** Axis-aligned bounds of `layerGeometryQuad`. */
export function layerGeometryBox(results: LayerResult[], project: Project, layerId: string) {
  const q = layerGeometryQuad(results, project, layerId)
  return q ? quadBounds(q) : null
}

/**
 * How much of the layer is visible: content grown by stroke, blur and every
 * filter's spread, clamped to the canvas — the renderer's own rectangle.
 */
export function layerBoundsFor(
  results: LayerResult[],
  project: Project,
  layerId: string,
) {
  const r = resultFor(results, layerId)
  if (!r) return null
  const layer = project.layers.find((l) => l.id === layerId)
  // bounds must be measured in the layer's own space and mapped afterwards:
  // a spread that grows *after* the transform would be scaled twice.
  const local = renderBounds(r.ir.nodes, {
    filters: layer ? activeFilters(layer) : [],
    spreadCtx: { width: project.canvas.w, height: project.canvas.h },
  })
  if (!local) return null
  const m = layer ? layerMatrix(layer, r.ir.nodes) : null
  const mapped = m ? quadBounds(transformQuad(local, m)) : local
  return clamp(mapped, project.canvas.w, project.canvas.h)
}

function clamp(r: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number) {
  return {
    x0: Math.max(0, Math.min(w, r.x0)),
    y0: Math.max(0, Math.min(h, r.y0)),
    x1: Math.max(0, Math.min(w, r.x1)),
    y1: Math.max(0, Math.min(h, r.y1)),
  }
}

function invert(m: Matrix): Matrix | null {
  const det = m.a * m.d - m.b * m.c
  if (!det || !Number.isFinite(det)) return null
  const a = m.d / det
  const b = -m.b / det
  const c = -m.c / det
  const d = m.a / det
  return { a, b, c, d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) }
}