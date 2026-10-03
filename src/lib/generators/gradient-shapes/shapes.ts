/**
 * gradient-shapes/shapes.ts — Geometry for one gradient shape.
 *
 * Circles, half-discs, rectangles, rounded rects and rings. Half-discs are
 * path arcs; rings are stroked circles so the gradient follows the band.
 * All deterministic and SVG-safe (no canvas-only constructs).
 */

import { polyD, type Node } from '../../ir'
import type { Paint } from '../../ir'

/** Shape families. */
export type ShapeKind = 'circle' | 'halfDisc' | 'rect' | 'roundRect' | 'ring'

/** True for every valid shape id. */
export function isShapeKind(v: string): v is ShapeKind {
  return v === 'circle' || v === 'halfDisc' || v === 'rect' || v === 'roundRect' || v === 'ring'
}

/** All drawable kinds (everything but `mixed`). */
export const DRAWABLE_SHAPES: ShapeKind[] = ['circle', 'halfDisc', 'rect', 'roundRect', 'ring']

/**
 * Emit one shape centred at (x, y) with the given gradient paint.
 */
export function shapeNode(
  nodes: Node[],
  shape: ShapeKind,
  x: number,
  y: number,
  size: number,
  paint: Paint,
  op: number,
  rot: number,
  softness: number,
): void {
  const r: number = Math.max(2, size / 2)
  switch (shape) {
    case 'circle':
      nodes.push({ g: { k: 'circle', x, y, r }, fill: paint, op })
      break
    case 'halfDisc': {
      // upper half-disc rotated by `rot`
      const steps = 24
      const pts: number[] = []
      for (let i = 0; i <= steps; i++) {
        const a: number = (i / steps) * Math.PI
        pts.push(Math.cos(a) * r, -Math.sin(a) * r)
      }
      const cos: number = Math.cos(rot)
      const sin: number = Math.sin(rot)
      const moved: number[] = []
      for (let i = 0; i < pts.length; i += 2) {
        const px: number = pts[i]
        const py: number = pts[i + 1]
        moved.push(x + px * cos - py * sin, y + px * sin + py * cos)
      }
      nodes.push({ g: { k: 'path', d: polyD(moved) }, fill: paint, op })
      break
    }
    case 'rect':
      nodes.push({ g: { k: 'rect', x: x - r, y: y - r * 0.7, w: r * 2, h: r * 1.4 }, fill: paint, op })
      break
    case 'roundRect':
      nodes.push({ g: { k: 'rect', x: x - r, y: y - r * 0.7, w: r * 2, h: r * 1.4, r: r * 0.35 }, fill: paint, op })
      break
    case 'ring': {
      const sw: number = Math.max(1.5, r * (0.12 + softness * 0.12))
      nodes.push({ g: { k: 'circle', x, y, r: r - sw / 2 }, stroke: paint, sw, cap: 'round', fill: null, op })
      break
    }
  }
}
