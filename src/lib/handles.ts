/**
 * handles.ts — where a transform box's handles are, and what they point at.
 *
 * Pure: takes a quad, returns points and cursor names. No DOM, no store, so the
 * overlay and the drag maths read the same answer.
 *
 * A rotated box has no axis-aligned corners, so every handle is interpolated
 * along an edge of the quad rather than indexed into it. That also means the
 * resize maths works on a rotated box without ever converting to an
 * axis-aligned rectangle and back.
 */

import { applyMatrix, type Matrix, type Point, type Quad } from './transform'

/** Eight resize handles plus the rotation handle, in clockwise order from NW. */
export const HANDLE_IDS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type HandleId = (typeof HANDLE_IDS)[number]

/** The handle above the top edge that starts a rotation. */
export const ROTATE_HANDLE = 'rotate' as const
export type GestureHandle = HandleId | typeof ROTATE_HANDLE

/** The handle opposite `id` — the one that stays put during a resize. */
const OPPOSITE: Record<HandleId, HandleId> = {
  nw: 'se',
  n: 's',
  ne: 'sw',
  e: 'w',
  se: 'nw',
  s: 'n',
  sw: 'ne',
  w: 'e',
}

/**
 * Handle positions for a quad given in TL, TR, BR, BL order: the four corners,
 * then the midpoint of each edge, matching `HANDLE_IDS`.
 */
export function handlePoints(q: Quad): Record<HandleId, Point> {
  const [tl, tr, br, bl] = q
  const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  return {
    nw: tl,
    n: mid(tl, tr),
    ne: tr,
    e: mid(tr, br),
    se: br,
    s: mid(br, bl),
    sw: bl,
    w: mid(bl, tl),
  }
}

/** The anchor a resize keeps fixed: the opposite handle. */
export function anchorHandle(id: HandleId): HandleId {
  return OPPOSITE[id]
}

/** True when this handle only moves one axis, so Shift cannot un-proportion it. */
export function isEdgeHandle(id: HandleId): boolean {
  return id === 'n' || id === 'e' || id === 's' || id === 'w'
}

/**
 * The CSS cursor for a handle, rotated with the layer.
 *
 * A north-west handle on a box rotated 90° should offer the south-west cursor,
 * because that is the direction it actually points on screen. The base cursor is
 * the handle's compass angle (NW = 315°), so the box's own rotation is added and
 * the result snapped to the eight standard cursors.
 */
export function cursorForHandle(id: HandleId, boxAngleDeg: number): string {
  const BASE: Record<HandleId, number> = {
    nw: 315,
    n: 0,
    ne: 45,
    e: 90,
    se: 135,
    s: 180,
    sw: 225,
    w: 270,
  }
  const a = (((BASE[id] + boxAngleDeg) % 360) + 360) % 360
  const idx = Math.round(a / 45) % 8
  return ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'][idx % 4]
}

/** The cursor for the rotation handle. */
export const ROTATE_CURSOR = 'grab'

/** Map a client point into the space the overlay draws in. */
export function toStage(p: Point, view: { ox: number; oy: number; scale: number }): Point {
  return { x: view.ox + p.x * view.scale, y: view.oy + p.y * view.scale }
}

/** Map a stage point back into canvas units. */
export function fromStage(p: Point, view: { ox: number; oy: number; scale: number }): Point {
  return { x: (p.x - view.ox) / view.scale, y: (p.y - view.oy) / view.scale }
}

/** Where a handle sits in canvas space, given the box's matrix. */
export function handleInCanvas(local: Record<HandleId, Point>, m: Matrix): Record<HandleId, Point> {
  const out = {} as Record<HandleId, Point>
  for (const id of HANDLE_IDS) out[id] = applyMatrix(m, local[id])
  return out
}