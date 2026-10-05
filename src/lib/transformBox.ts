/**
 * transformBox.ts — the single source of truth for transform box geometry.
 *
 * Pure: no DOM, no React, no store. Computes every handle position in one
 * function so the picture (overlay) and the pointer logic (hit-testing,
 * dragging) can never disagree.
 *
 * The box follows the layer's GEOMETRY bounds (strokes included via
 * `contentBounds`, filters/glow excluded), transformed by the layer transform.
 * It is NOT clamped to the canvas.
 *
 * The rotation stem is a constant SCREEN pixel length (ROTATE_STEM_PX), measured
 * along the layer's "up" direction after rotation. This is the key invariant:
 * the stem is always the same length on screen regardless of zoom.
 */

import type { Rect } from './render/bounds'
import {
  applyMatrix,
  matrixAngleDeg,
  pivotOf,
  transformMatrix,
  transformQuad,
  type LayerTransform,
  type Point,
  type Quad,
} from './transform'
import type { StageView } from '../components/preview/view'

/** Rotation stem length in SCREEN pixels — constant at any zoom. */
export const ROTATE_STEM_PX = 28

/** Handle size in SCREEN pixels — constant at any zoom. */
export const HANDLE_PX = 8

/** The stage rectangle in screen pixels, used to clamp the rotate knob. */
export interface StageRect {
  width: number
  height: number
}

export interface TransformBox {
  /** The four corners of the box in screen space (TL, TR, BR, BL). */
  corners: [Point, Point, Point, Point]
  /** The four edge midpoints in screen space (N, E, S, W). */
  edgeMids: { n: Point; e: Point; s: Point; w: Point }
  /** The rotation knob position in screen space. */
  rotateStemEnd: Point
  /** The pivot point in screen space. */
  pivot: Point
  /** The box angle in degrees (for cursor rotation). */
  angleDeg: number
  /** The canvas-space quad (for hit-testing and dragging). */
  canvasQuad: Quad
  /** The canvas-space pivot (for hit-testing and dragging). */
  canvasPivot: Point
}

/**
 * Compute the full transform box geometry in one call.
 *
 * All returned points are in SCREEN space (ready for SVG), except `canvasQuad`
 * and `canvasPivot` which are in canvas space (for hit-testing).
 *
 * @param boundsInIR  The layer's geometry bounds in its own (untransformed) space.
 * @param transform   The layer's current placement.
 * @param view        The stage's screen transform (scale, ox, oy).
 * @param stage       The stage rectangle in screen pixels (for clamping the knob).
 */
export function computeTransformBox(
  boundsInIR: Rect,
  transform: LayerTransform,
  view: StageView,
  stage: StageRect | null,
): TransformBox {
  const pivot = pivotOf(boundsInIR)
  const m = transformMatrix(transform, pivot)
  const canvasQuad = transformQuad(boundsInIR, m)
  const angleDeg = matrixAngleDeg(m)

  // Map canvas-space points to screen space.
  const toScreen = (p: Point): Point => ({
    x: view.ox + p.x * view.scale,
    y: view.oy + p.y * view.scale,
  })

  const corners: [Point, Point, Point, Point] = [
    toScreen(canvasQuad[0]),
    toScreen(canvasQuad[1]),
    toScreen(canvasQuad[2]),
    toScreen(canvasQuad[3]),
  ]

  const edgeMids = {
    n: toScreen(midpoint(canvasQuad[0], canvasQuad[1])),
    e: toScreen(midpoint(canvasQuad[1], canvasQuad[2])),
    s: toScreen(midpoint(canvasQuad[2], canvasQuad[3])),
    w: toScreen(midpoint(canvasQuad[3], canvasQuad[0])),
  }

  const pivotScreen = toScreen(applyMatrix(m, pivot))

  // The rotation stem: a constant SCREEN pixel length along the layer's "up"
  // direction. The "up" direction in canvas space is the outward normal of the
  // top edge, which after rotation points away from the box.
  const rotateStemEnd = computeRotateStemEnd(canvasQuad, view, stage)

  return {
    corners,
    edgeMids,
    rotateStemEnd,
    pivot: pivotScreen,
    angleDeg,
    canvasQuad,
    canvasPivot: applyMatrix(m, pivot),
  }
}

/**
 * Compute the rotation knob position in screen space.
 *
 * The stem is ROTATE_STEM_PX screen pixels long, measured along the layer's
 * "up" direction (the outward normal of the top edge, rotated with the layer).
 *
 * If the knob would fall outside the stage, it is flipped to point the
 * opposite way (down) so it stays reachable. If both directions fall outside,
 * the knob is clamped to the stage edge.
 */
function computeRotateStemEnd(
  canvasQuad: Quad,
  view: StageView,
  stage: StageRect | null,
): Point {
  const [tl, tr] = canvasQuad
  const mid = midpoint(tl, tr)

  // The outward normal of the top edge in canvas space.
  // The quad is TL, TR, BR, BL (clockwise in canvas coordinates where y is
  // down). For a clockwise polygon, the outward normal of an edge is the edge
  // vector rotated 90° clockwise: (dx, dy) → (dy, -dx).
  // For an unrotated box, the top edge goes left-to-right (dx>0, dy=0), so
  // the normal is (0, -1) — pointing UP, away from the box. Correct.
  const dx = tr.x - tl.x
  const dy = tr.y - tl.y
  const len = Math.hypot(dx, dy)

  let nx: number
  let ny: number
  if (len < 1e-9) {
    // Degenerate top edge (single point or zero-scale): default to "up".
    nx = 0
    ny = -1
  } else {
    nx = dy / len
    ny = -dx / len
  }

  // The stem end in canvas space: mid + normal * (ROTATE_STEM_PX / scale).
  // We divide by scale because the normal is in canvas units, but we want
  // the stem to be ROTATE_STEM_PX in SCREEN pixels.
  const stemCanvas = ROTATE_STEM_PX / view.scale

  // Try the "up" direction first.
  let stemEndScreen = toScreenPoint(
    { x: mid.x + nx * stemCanvas, y: mid.y + ny * stemCanvas },
    view,
  )

  // If the knob is outside the stage, try flipping to "down".
  if (stage && !isInsideStage(stemEndScreen, stage)) {
    const flipped = toScreenPoint(
      { x: mid.x - nx * stemCanvas, y: mid.y - ny * stemCanvas },
      view,
    )
    if (isInsideStage(flipped, stage)) {
      stemEndScreen = flipped
    }
  }

  // If both directions are outside, clamp to the stage edge.
  if (stage && !isInsideStage(stemEndScreen, stage)) {
    const margin = 40
    stemEndScreen = {
      x: Math.max(margin, Math.min(stage.width - margin, stemEndScreen.x)),
      y: Math.max(margin, Math.min(stage.height - margin, stemEndScreen.y)),
    }
  }

  return stemEndScreen
}

/** Map a canvas-space point to screen space. */
function toScreenPoint(p: Point, view: StageView): Point {
  return { x: view.ox + p.x * view.scale, y: view.oy + p.y * view.scale }
}

/** Check if a screen-space point is inside the stage (with a small margin). */
function isInsideStage(p: Point, stage: StageRect): boolean {
  const margin = 40
  return (
    p.x >= margin &&
    p.x <= stage.width - margin &&
    p.y >= margin &&
    p.y <= stage.height - margin
  )
}

/** Midpoint of two points. */
function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Guard against NaN/Infinity in the transform box.
 * Returns true if the box is valid (all corners are finite and the box has
 * non-zero area — a zero-scale transform collapses all corners to one point).
 */
export function isValidTransformBox(box: TransformBox): boolean {
  if (
    !Number.isFinite(box.corners[0].x) ||
    !Number.isFinite(box.corners[0].y) ||
    !Number.isFinite(box.corners[1].x) ||
    !Number.isFinite(box.corners[1].y) ||
    !Number.isFinite(box.corners[2].x) ||
    !Number.isFinite(box.corners[2].y) ||
    !Number.isFinite(box.corners[3].x) ||
    !Number.isFinite(box.corners[3].y) ||
    !Number.isFinite(box.rotateStemEnd.x) ||
    !Number.isFinite(box.rotateStemEnd.y)
  ) {
    return false
  }
  // A zero-scale transform collapses all corners to one point.
  const [tl, tr, br, bl] = box.corners
  const width = Math.hypot(tr.x - tl.x, tr.y - tl.y)
  const height = Math.hypot(bl.x - tl.x, bl.y - tl.y)
  return width > 1e-9 && height > 1e-9
}
