/**
 * select.ts — hit-testing and bounds for canvas selection.
 *
 * Two consumers: the selection box drawn over the preview, and click-to-select.
 * Both work from the same `nodeBounds` the blur-clipper already uses, so path
 * geometry is parsed once and memoised rather than per feature.
 *
 * Hit-testing is deliberately **bounding-box**, not exact-shape. A glow layer is
 * thousands of mostly-transparent particles; testing real containment would mean
 * parsing thousands of paths on every click, and a click landing in a gap
 * between particles inside a layer's extent still selects that layer — which is
 * what you want when the pixels there are 2% alpha.
 */

import { nodeBounds, type Rect } from './render/canvas'
import type { LayerResult } from './pipeline'
import { layerOffset, type Project } from './schema'
import type { Node } from './ir'

/**
 * Union of every node's extent, shifted by `dx, dy`.
 *
 * `dx, dy` is the owning layer's manual placement. It is a *parameter* rather
 * than read from the nodes because the store's `results` hold raw, untranslated
 * IR — `composeIR` is what stamps `tx`/`ty`, and selection runs against the
 * raw list. Nodes that already carry `tx` (a composed IR) still work, since the
 * two add up.
 */
export function boundsOfNodes(nodes: Node[], dx = 0, dy = 0): Rect | null {
  let out: Rect | null = null
  for (const n of nodes) {
    const b = nodeBounds(n)
    if (!b) continue
    const tx = (n.tx ?? 0) + dx
    const ty = (n.ty ?? 0) + dy
    if (!out) {
      out = { x0: b.x0 + tx, y0: b.y0 + ty, x1: b.x1 + tx, y1: b.y1 + ty }
      continue
    }
    if (b.x0 + tx < out.x0) out.x0 = b.x0 + tx
    if (b.y0 + ty < out.y0) out.y0 = b.y0 + ty
    if (b.x1 + tx > out.x1) out.x1 = b.x1 + tx
    if (b.y1 + ty > out.y1) out.y1 = b.y1 + ty
  }
  return out
}

/** Is (x, y) inside any node's extent? Coordinates are IR/canvas units. */
export function hitsNodes(nodes: Node[], x: number, y: number, dx = 0, dy = 0): boolean {
  for (const n of nodes) {
    const b = nodeBounds(n)
    if (!b) continue
    const px = x - ((n.tx ?? 0) + dx)
    const py = y - ((n.ty ?? 0) + dy)
    if (px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1) return true
  }
  return false
}

/** layerId → manual placement, for resolving offsets against raw results. */
function offsetMap(project: Project): Map<string, { x: number; y: number }> {
  return new Map(project.layers.map((l) => [l.id, layerOffset(l)]))
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
  const offsets = offsetMap(project)
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i]
    const o = offsets.get(r.layerId) ?? { x: 0, y: 0 }
    if (hitsNodes(r.ir.nodes, x, y, o.x, o.y)) return r.layerId
  }
  return null
}

/**
 * Bounds of one layer's result, or null when the layer is not in `results` —
 * which is the case for a hidden layer, or one excluded by solo.
 */
export function layerBoundsFor(
  results: LayerResult[],
  project: Project,
  layerId: string,
): Rect | null {
  const r = results.find((x) => x.layerId === layerId)
  if (!r) return null
  const o = offsetMap(project).get(layerId) ?? { x: 0, y: 0 }
  return boundsOfNodes(r.ir.nodes, o.x, o.y)
}

export { layerOffset }
