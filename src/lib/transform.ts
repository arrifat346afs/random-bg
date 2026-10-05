/**
 * transform.ts — a layer's placement, as pure math.
 *
 * No DOM, no React, no store: everything here is a function of its arguments,
 * so the renderer, the SVG compiler, the overlay and the tests all derive the
 * same matrix from the same five numbers and cannot drift apart.
 *
 * A layer's transform is, in canvas units:
 *
 *     translate(x, y) · translate(pivot) · rotate(rotation°) · scale(sx, sy) · translate(-pivot)
 *
 * The pivot defaults to the centre of the layer's **untransformed** geometry
 * bounds, so a layer scales and rotates about where it is rather than about the
 * canvas origin. `pivotOf` resolves it; everything else takes it as an argument.
 *
 * Transform lives on the CTM and is deliberately *absent* from the generation
 * cache key: moving or resizing a layer must never regenerate its geometry. The
 * renderer applies the matrix, and the exporters emit the equivalent SVG
 * `transform` — the pixels come out the same on all three paths.
 */

import type { Rect } from './render/bounds'
import type { TransformStamp } from './ir'

/** A layer's placement. All fields are canvas units / degrees. */
export interface LayerTransform {
  /** translation, canvas units */
  x: number
  y: number
  scaleX: number
  scaleY: number
  /** clockwise degrees, about the pivot */
  rotation: number
}

/** What a layer with no `transform` field gets. */
export const IDENTITY_TRANSFORM: LayerTransform = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
}

/** A pivot in canvas units. */
export interface Pivot {
  x: number
  y: number
}

export interface Point {
  x: number
  y: number
}

/** A 2×3 affine, matching the fields of `DOMMatrix`. */
export interface Matrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/**
 * A layer's transform, with defaults filled in.
 *
 * Accepts a partial because every field is optional in saved JSON: a project
 * written before transforms existed has no `transform` at all, and a hand-edited
 * one may have any subset.
 */
export function layerTransform(l: { transform?: Partial<LayerTransform> }): LayerTransform {
  const t = l.transform
  if (!t) return IDENTITY_TRANSFORM
  return {
    x: num(t.x, 0),
    y: num(t.y, 0),
    scaleX: num(t.scaleX, 1),
    scaleY: num(t.scaleY, 1),
    rotation: num(t.rotation, 0),
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** True when the transform would move nothing — the cheap "skip the work" test. */
export function isIdentityTransform(t: LayerTransform): boolean {
  return (
    t.x === 0 &&
    t.y === 0 &&
    t.scaleX === 1 &&
    t.scaleY === 1 &&
    t.rotation === 0
  )
}

/** Migrate a pre-transform project's `offset` into a full transform. */
export function transformFromOffset(
  o: { x?: number; y?: number } | null | undefined,
): LayerTransform {
  return { ...IDENTITY_TRANSFORM, x: num(o?.x, 0), y: num(o?.y, 0) }
}

/** The centre of a geometry rect — the default pivot. */
export function pivotOf(b: Rect | null): Pivot {
  if (!b) return { x: 0, y: 0 }
  return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }
}

const DEG = Math.PI / 180

/**
 * The affine for `t` about `pivot`.
 *
 * Composed as translate(t) · translate(pivot) · rotate · scale · translate(-pivot)
 * and folded into a single 2×3, which is the form both `ctx.transform` and the
 * bounds code want.
 */
export function transformMatrix(t: LayerTransform, pivot: Pivot): Matrix {
  const rad = t.rotation * DEG
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  // linear part: rotate ∘ scale
  const a = c * t.scaleX
  const b = s * t.scaleX
  const cc = -s * t.scaleY
  const d = c * t.scaleY
  // translation, with the pivot folded in
  return {
    a,
    b,
    c: cc,
    d,
    e: t.x + pivot.x - (a * pivot.x + cc * pivot.y),
    f: t.y + pivot.y - (b * pivot.x + d * pivot.y),
  }
}

/** Map one point through an affine. */
export function applyMatrix(m: Matrix, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }
}

/**
 * The affine a `composeIR` stamp represents: translation then, about the pivot,
 * rotate and scale.
 *
 * This is the one place a stamp becomes a matrix. The canvas applies it with
 * `ctx.transform` and the SVG backend writes the equivalent attribute list, and
 * the tests compare both against this — so a stamp cannot mean one thing on the
 * preview and another on export.
 */
export function stampMatrix(tx: number, ty: number, tr: TransformStamp): Matrix {
  const t: LayerTransform = {
    x: tx,
    y: ty,
    scaleX: tr.scaleX,
    scaleY: tr.scaleY,
    rotation: tr.rotation,
  }
  return transformMatrix(t, { x: tr.px, y: tr.py })
}

/** The identity affine. */
export const IDENTITY_MATRIX: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** True when the affine moves nothing. */
export function isIdentityMatrix(m: Matrix): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0
}

/** A quad: the four corners of a rect after an affine, in TL, TR, BR, BL order. */
export type Quad = [Point, Point, Point, Point]

/** Map a rect's four corners through an affine. */
export function transformQuad(r: Rect, m: Matrix): Quad {
  return [
    applyMatrix(m, { x: r.x0, y: r.y0 }),
    applyMatrix(m, { x: r.x1, y: r.y0 }),
    applyMatrix(m, { x: r.x1, y: r.y1 }),
    applyMatrix(m, { x: r.x0, y: r.y1 }),
  ]
}

/** Axis-aligned bounds of a quad. Rotation needs the hull, not two corners. */
export function quadBounds(q: Quad): Rect {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of q) {
    if (p.x < x0) x0 = p.x
    if (p.x > x1) x1 = p.x
    if (p.y < y0) y0 = p.y
    if (p.y > y1) y1 = p.y
  }
  return { x0, y0, x1, y1 }
}

/** The inverse of an affine, or null when it is singular (zero scale). */
export function invertMatrix(m: Matrix): Matrix | null {
  const det = m.a * m.d - m.b * m.c
  if (!det || !Number.isFinite(det)) return null
  const ia = m.d / det
  const ib = -m.b / det
  const ic = -m.c / det
  const id = m.a / det
  return {
    a: ia,
    b: ib,
    c: ic,
    d: id,
    e: -(ia * m.e + ic * m.f),
    f: -(ib * m.e + id * m.f),
  }
}

/** Angle in degrees of the affine's x axis — the box's on-screen orientation. */
export function matrixAngleDeg(m: Matrix): number {
  return Math.atan2(m.b, m.a) / DEG
}

/**
 * The SVG `transform` attribute for a layer, or '' when it is identity.
 *
 * A pure move emits exactly `translate(x y)` — the same string as before
 * transforms existed — so moving a layer leaves the export byte-identical. The
 * pivot translate/scale/translate sandwich is only emitted when there is actually
 * something to scale or rotate, which keeps plain moves free of noise that would
 * churn every preset's exported bytes.
 */
export function transformAttr(t: LayerTransform, pivot: Pivot): string {
  if (isIdentityTransform(t)) return ''
  if (t.scaleX === 1 && t.scaleY === 1 && t.rotation === 0) {
    return `translate(${r2(t.x)} ${r2(t.y)})`
  }
  const parts = [`translate(${r2(t.x)} ${r2(t.y)})`, `translate(${r2(pivot.x)} ${r2(pivot.y)})`]
  if (t.rotation !== 0) parts.push(`rotate(${r2(t.rotation)})`)
  if (t.scaleX !== 1 || t.scaleY !== 1) parts.push(`scale(${r4(t.scaleX)} ${r4(t.scaleY)})`)
  parts.push(`translate(${r2(-pivot.x)} ${r2(-pivot.y)})`)
  return parts.join(' ')
}

const r2 = (v: number): string => String(Number(v.toFixed(2)))
const r4 = (v: number): string => String(Number(v.toFixed(4)))