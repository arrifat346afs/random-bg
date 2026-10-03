/**
 * render/reach.ts — "how far past its geometry can this layer put pixels?"
 *
 * Pure: no DOM, no React, no store. Composes `./bounds` (geometry) with the
 * filter stacks' declared reach, and provides `renderBounds` — the single
 * function every consumer must use to size a clip, an offscreen surface, an
 * SVG `<filter>` region or the selection box:
 *
 *   renderBounds = union(geometry) grown by max(node spread, filter stack spread),
 *                  clamped to the canvas, and to nothing else.
 *
 * A clip derived from the geometry alone is the bug this prevents: a blur, glow,
 * shadow or displacement reaches the edge of that rectangle and is cut off with
 * a hard, straight seam instead of fading out. Nothing here may return a
 * rectangle smaller than the content it covers.
 */

import type { Node } from '../ir'
import { stackSpread, type SpreadCtx } from '../filters/stack'
import type { FilterInstance } from '../filters/types'
import { contentBounds, padRect, type Rect } from './bounds'

/**
 * A blur kernel is visually gone by ~3σ (the tail there is 0.1 % of peak). Every
 * radius expressed as "how far can this push a pixel" is a multiple of this.
 */
export const BLUR_SIGMA_SPREAD = 3

/** A stroke paints `sw / 2` outside the path on every side. */
export const STROKE_SPREAD = 0.5

/** One device pixel of antialias slack, added to device-space clips. */
export const ANTIALIAS_SLACK_PX = 1

/** The 2D matrix fields this module needs (DOMMatrix satisfies it). */
export interface MatrixLike {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/**
 * How far this node's own paint can reach beyond its geometry: its stroke
 * half-width plus the reach of its own `blur`.
 */
export function nodeSpread(n: Node): number {
  return (n.blur ?? 0) * BLUR_SIGMA_SPREAD + (n.sw ?? 0) * STROKE_SPREAD
}

/** The largest node spread across a run — what the union has to grow by. */
export function maxNodeSpread(nodes: readonly Node[]): number {
  let out = 0
  for (const n of nodes) {
    const s = nodeSpread(n)
    if (s > out) out = s
  }
  return out
}

/**
 * One node's geometry grown by its own stroke and blur, in its **own**
 * coordinate space — `tx`/`ty` are deliberately excluded, because by the time a
 * per-node clip is set the layer's translate is already in the CTM.
 *
 * The per-draw counterpart of `renderBounds`: a single node has no filter
 * stack, so the stack spread does not apply to it.
 */
export function nodeLocalBounds(n: Node): Rect | null {
  const b = contentBounds(n)
  if (!b) return null
  return padRect(b, nodeSpread(n))
}

/**
 * Union of a run's geometry with each node's manual placement applied.
 * `dx, dy` is an extra translation (the owning layer's placement) for callers
 * holding raw, un-composed node lists.
 */
export function nodesContentBounds(nodes: readonly Node[], dx = 0, dy = 0): Rect | null {
  let out: Rect | null = null
  for (const n of nodes) {
    const b = contentBounds(n)
    if (!b) continue
    const tx = (n.tx ?? 0) + dx
    const ty = (n.ty ?? 0) + dy
    const r: Rect = { x0: b.x0 + tx, y0: b.y0 + ty, x1: b.x1 + tx, y1: b.y1 + ty }
    if (out) {
      if (r.x0 < out.x0) out.x0 = r.x0
      if (r.y0 < out.y0) out.y0 = r.y0
      if (r.x1 > out.x1) out.x1 = r.x1
      if (r.y1 > out.y1) out.y1 = r.y1
    } else out = r
  }
  return out
}

export interface RenderBoundsOpts {
  /** the layer's enabled filter stack — its spread is summed in */
  filters?: readonly FilterInstance[]
  /** canvas size in IR units; when given, the result is clamped to it */
  width?: number
  height?: number
  /** extra translation in IR units, for raw (un-composed) node lists */
  dx?: number
  dy?: number
  /** canvas dims handed to canvas-relative filters (radial / zoom blur) */
  spreadCtx?: SpreadCtx
}

/**
 * THE function: where a layer's pixels can land. Content bounds grown by every
 * node's own stroke and blur, by every filter in the stack, then clamped to the
 * canvas — and to nothing else, ever.
 *
 * Returns null only when no node's extent is determinable.
 */
export function renderBounds(nodes: readonly Node[], opts: RenderBoundsOpts = {}): Rect | null {
  const content = nodesContentBounds(nodes, opts.dx ?? 0, opts.dy ?? 0)
  if (!content) return null
  let spread = maxNodeSpread(nodes)
  const fs = opts.filters
    ? stackSpread(opts.filters, opts.spreadCtx ?? { width: 0, height: 0 })
    : 0
  if (Number.isFinite(fs) && fs > spread) spread = fs
  const out = padRect(content, spread)
  if (opts.width === undefined || opts.height === undefined) return out
  return clampToCanvas(out, opts.width, opts.height)
}

/** Clamp to the canvas rectangle; never expands. */
export function clampToCanvas(r: Rect, width: number, height: number): Rect {
  return {
    x0: Math.max(0, Math.min(width, r.x0)),
    y0: Math.max(0, Math.min(height, r.y0)),
    x1: Math.max(0, Math.min(width, r.x1)),
    y1: Math.max(0, Math.min(height, r.y1)),
  }
}

/* ---- Device space -------------------------------------------------------- */

/**
 * Map a rect through a 2D matrix. All four corners are mapped, so a rotation
 * bounds the result rather than being approximated by the hull of two corners.
 */
export function deviceBounds(r: Rect, m: MatrixLike): Rect {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let k = 0; k < 4; k++) {
    const px = k === 0 || k === 2 ? r.x0 : r.x1
    const py = k < 2 ? r.y0 : r.y1
    const x = m.a * px + m.c * py + m.e
    const y = m.b * px + m.d * py + m.f
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return { x0, y0, x1, y1 }
}

/**
 * The largest uniform scale a matrix applies to either axis.
 *
 * Radii must be scaled by this rather than by `m.a`: under a rotation `m.a` is a
 * projection that can be far smaller than the true scale, which silently
 * shrank every filter spread and clipped the layer it was meant to protect.
 */
export function matrixScale(m: MatrixLike): number {
  return Math.hypot(m.a, m.b) || Math.hypot(m.c, m.d) || 1
}

/**
 * An integral, canvas-clamped device rect for an offscreen surface or a clip.
 * Returns null when the rect has no area inside the canvas.
 */
export function surfaceRect(r: Rect, cw: number, ch: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x0))
  const y0 = Math.max(0, Math.floor(r.y0))
  const x1 = Math.min(cw, Math.ceil(r.x1))
  const y1 = Math.min(ch, Math.ceil(r.y1))
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null
  return { x0, y0, x1, y1 }
}