/**
 * render/bounds.ts — geometry measurement and the `Rect` primitives.
 *
 * Pure: no DOM, no React, no store. This half of the bounds answer is "what
 * geometry does this node paint" — the part that depends only on the node. Its
 * companion `./reach` answers "how far past that geometry can the pixels land",
 * and combines the two into the single `renderBounds` every consumer must use.
 *
 * The bug these exist to prevent: a clip area derived from this geometry alone,
 * with no room for the blur, glow, shadow or displacement on top of it, so a
 * glowing layer was sliced off along the shape's own rectangle.
 */

import type { Geo, Node } from '../ir'
import { drawSvgPath, type PathSink } from './path'

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function makeRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x0, y0, x1, y1 }
}

/** Grow `a` in place to also contain `b`. */
export function growRect(a: Rect, b: Rect): void {
  if (b.x0 < a.x0) a.x0 = b.x0
  if (b.y0 < a.y0) a.y0 = b.y0
  if (b.x1 > a.x1) a.x1 = b.x1
  if (b.y1 > a.y1) a.y1 = b.y1
}

export function rectWidth(r: Rect): number {
  return r.x1 - r.x0
}

export function rectHeight(r: Rect): number {
  return r.y1 - r.y0
}

export function rectArea(r: Rect): number {
  return Math.max(0, rectWidth(r)) * Math.max(0, rectHeight(r))
}

/** Grow `r` by `pad` on every side. */
export function padRect(r: Rect, pad: number): Rect {
  return { x0: r.x0 - pad, y0: r.y0 - pad, x1: r.x1 + pad, y1: r.y1 + pad }
}

/** True when `outer` fully contains `inner`. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    outer.x0 <= inner.x0 && outer.y0 <= inner.y0 && outer.x1 >= inner.x1 && outer.y1 >= inner.y1
  )
}

/* ---- Content bounds ------------------------------------------------------ */

const boundsMemo = new WeakMap<Node, Rect | null>()

/**
 * Conservative extent of one node's geometry in IR units (control points bound
 * curves, which over-estimates — the safe direction).
 *
 * Memoised on the Node object: with per-node clipping this is asked twice per
 * draw (once for the clip, once to price the filter budget), and replaying a
 * long path through the parser twice is not free. Safe as a cache only because
 * generators emit immutable nodes — every transform allocates a new one.
 */
export function contentBounds(n: Node): Rect | null {
  const hit = boundsMemo.get(n)
  if (hit !== undefined) return hit
  const r = computeContentBounds(n.g)
  boundsMemo.set(n, r)
  return r
}

function computeContentBounds(g: Geo): Rect | null {
  switch (g.k) {
    case 'circle':
      return { x0: g.x - g.r, y0: g.y - g.r, x1: g.x + g.r, y1: g.y + g.r }
    case 'ellipse': {
      const m = Math.max(g.rx, g.ry)
      return { x0: g.x - m, y0: g.y - m, x1: g.x + m, y1: g.y + m }
    }
    case 'rect':
      return {
        x0: Math.min(g.x, g.x + g.w),
        y0: Math.min(g.y, g.y + g.h),
        x1: Math.max(g.x, g.x + g.w),
        y1: Math.max(g.y, g.y + g.h),
      }
    case 'poly': {
      const p = g.pts
      if (p.length < 4) return null
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (let i = 0; i + 1 < p.length; i += 2) {
        if (p[i] < x0) x0 = p[i]
        if (p[i] > x1) x1 = p[i]
        if (p[i + 1] < y0) y0 = p[i + 1]
        if (p[i + 1] > y1) y1 = p[i + 1]
      }
      return { x0, y0, x1, y1 }
    }
    case 'path':
      return pathBounds(g.d)
  }
}

/**
 * Bounds of SVG path data, by replaying the parser onto a recording sink.
 * Control points over-estimate the extent, which is the safe direction.
 */
export function pathBounds(d: string): Rect | null {
  const b: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  const pt = (x: number, y: number) => {
    if (!(Number.isFinite(x) && Number.isFinite(y))) return
    if (x < b.x0) b.x0 = x
    if (x > b.x1) b.x1 = x
    if (y < b.y0) b.y0 = y
    if (y > b.y1) b.y1 = y
  }
  const rec: PathSink = {
    moveTo: pt,
    lineTo: pt,
    closePath: () => {},
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => {
      pt(cx, cy)
      pt(x, y)
    },
    bezierCurveTo: (a1: number, b1: number, a2: number, b2: number, x: number, y: number) => {
      pt(a1, b1)
      pt(a2, b2)
      pt(x, y)
    },
    ellipse: (x: number, y: number, rx: number, ry: number) => {
      pt(x - rx, y - ry)
      pt(x + rx, y + ry)
    },
  }
  try {
    drawSvgPath(rec, d)
  } catch {
    return null
  }
  if (!Number.isFinite(b.x0) || !Number.isFinite(b.y0)) return null
  return b
}