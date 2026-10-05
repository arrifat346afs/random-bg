/**
 * scaling.ts — turn a handle drag into a transform.
 *
 * Pure: geometry in, `LayerTransform` out. The renderer never sees a pointer
 * event and the overlay never does the arithmetic, so a resize cannot drift
 * between what is drawn and what is stored.
 *
 * All of it works in the box's **local** (untransformed) space. The anchor is a
 * fixed point of that space, the pointer is mapped into it through the inverse of
 * the current matrix, and the scale is the ratio of two vectors that share an
 * origin. That is what makes the maths correct for a rotated box without ever
 * converting to an axis-aligned rectangle and back — and it is why the pivot
 * falls out for free: the anchor is simply the point held still.
 */

import type { Rect } from './render/bounds'
import {
  applyMatrix,
  invertMatrix,
  transformMatrix,
  type LayerTransform,
  type Matrix,
  type Pivot,
  type Point,
} from './transform'
import { anchorHandle, handlePoints, isEdgeHandle, type HandleId } from './handles'

/** Rotation snaps to this many degrees while Shift is held. */
export const ROTATE_SNAP_DEG = 15

/** Below this the scale is treated as degenerate (the pointer crossed the anchor). */
const MIN_SCALE = 1e-3

export interface ScaleArgs {
  /** the layer's geometry bounds, in its own space */
  local: Rect
  /** the layer's current placement */
  base: LayerTransform
  /** the box's pivot in local space */
  pivot: Pivot
  /** which handle is being dragged */
  handle: HandleId
  /** pointer position, canvas units */
  at: Point
  /** keep the aspect ratio (corners only) */
  proportional: boolean
  /** scale about the centre instead of the opposite handle */
  fromCentre: boolean
}

/** The placement a scale drag produces. */
export function scaleTransform(args: ScaleArgs): LayerTransform {
  const { local, base, pivot, handle, at, proportional, fromCentre } = args
  const m = transformMatrix(base, pivot)
  const inv = invertMatrix(m)
  if (!inv) return base

  // Anchor: the opposite handle normally, the centre under Alt.
  const pts = handlePoints(rectToQuad(local))
  const anchorLocal = fromCentre ? centreOf(local) : pts[anchorHandle(handle)]
  const startLocal = pts[handle]

  const anchorCanvas = applyMatrix(m, anchorLocal)
  const pointerLocal = applyMatrix(inv, at)

  const dx0 = startLocal.x - anchorLocal.x
  const dy0 = startLocal.y - anchorLocal.y
  const dx1 = pointerLocal.x - anchorLocal.x
  const dy1 = pointerLocal.y - anchorLocal.y

  // A handle on one axis must not move the other, and a handle dragged exactly
  // onto its anchor has no direction to scale along.
  let sx = Math.abs(dx0) < MIN_SCALE ? 1 : dx1 / dx0
  let sy = Math.abs(dy0) < MIN_SCALE ? 1 : dy1 / dy0

  // An edge handle only ever drives its own axis, so it is never coupled to the
  // other one. Enforced here rather than left to the caller, because this is the
  // invariant the maths guarantees.
  const coupled = proportional && !isEdgeHandle(handle)
  if (coupled) {
    // Use the larger magnitude, so the box follows the pointer's dominant axis
    // rather than drifting under it (Figma's behaviour).
    const k = Math.max(Math.abs(sx), Math.abs(sy))
    sx = Math.sign(sx || 1) * k
    sy = Math.sign(sy || 1) * k
  }

  const scaleX = clampScale(base.scaleX * sx)
  const scaleY = clampScale(base.scaleY * sy)

  // Hold the anchor still: the new matrix must map the anchor to exactly where it
  // already is on screen, which fixes the translation.
  const moved = transformMatrix({ ...base, x: 0, y: 0, scaleX, scaleY }, pivot)
  const landed = applyMatrix(moved, anchorLocal)
  return {
    ...base,
    scaleX,
    scaleY,
    x: anchorCanvas.x - landed.x,
    y: anchorCanvas.y - landed.y,
  }
}

export interface RotateArgs {
  local: Rect
  base: LayerTransform
  pivot: Pivot
  /** pointer position, canvas units */
  at: Point
  /** snap to `ROTATE_SNAP_DEG` steps */
  snap: boolean
}

/**
 * The rotation a rotate drag produces.
 *
 * The reference direction is the **rotate handle** — the top edge's midpoint —
 * not the box centre. For an unrotated box those two are on the same vertical
 * line through the pivot, and the centre sits *on* the pivot, so measuring from
 * it gives a zero-length vector and an undefined start angle. Measuring from the
 * handle is also what makes the gesture not jump when the user grabs the grip
 * slightly off-centre.
 */
export function rotateTransform(args: RotateArgs): LayerTransform {
  const { local, base, pivot, at, snap } = args
  const m = transformMatrix(base, pivot)
  const anchorCanvas = applyMatrix(m, pivot)
  const gripCanvas = applyMatrix(m, handlePoints(rectToQuad(local)).n)
  const startAngle = Math.atan2(gripCanvas.y - anchorCanvas.y, gripCanvas.x - anchorCanvas.x)
  const nowAngle = Math.atan2(at.y - anchorCanvas.y, at.x - anchorCanvas.x)
  let deg = base.rotation + ((nowAngle - startAngle) * 180) / Math.PI
  if (snap) deg = Math.round(deg / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG
  // normalised to (-180, 180] so the readout and the stored number agree
  deg = ((((deg + 180) % 360) + 360) % 360) - 180
  if (deg <= -180) deg += 360
  return { ...base, rotation: deg === 0 ? 0 : deg }
}

/** The four corners of a rect, in the order `handlePoints` expects. */
export function rectToQuad(r: Rect): [Point, Point, Point, Point] {
  return [
    { x: r.x0, y: r.y0 },
    { x: r.x1, y: r.y0 },
    { x: r.x1, y: r.y1 },
    { x: r.x0, y: r.y1 },
  ]
}

/** A rect's midpoint — the Alt anchor for a resize. */
export function centreOf(r: Rect): Point {
  return { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }
}

/** Keep a scale away from zero and negative-collapse. */
function clampScale(v: number): number {
  if (!Number.isFinite(v)) return 1
  return Math.abs(v) < MIN_SCALE ? MIN_SCALE * Math.sign(v || 1) : v
}

/** The matrix a transform produces about a pivot — exported for the overlay. */
export function matrixOf(t: LayerTransform, pivot: Pivot): Matrix {
  return transformMatrix(t, pivot)
}