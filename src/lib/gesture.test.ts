/**
 * gesture.test.ts — scale, rotate, handles, snapping and migration.
 *
 * Companion to `transform.test.ts`, which covers the matrix itself. Split so
 * neither file grows past the line budget; both share the same BOX fixture.
 */

import { describe, expect, test } from 'bun:test'
import {
  IDENTITY_TRANSFORM,
  applyMatrix,
  pivotOf,
  transformMatrix,
  type LayerTransform,
} from './transform'
import { rectToQuad, rotateTransform, scaleTransform } from './scaling'
import { handlePoints } from './handles'
import type { Rect } from './render/bounds'

const BOX: Rect = { x0: 100, y0: 100, x1: 300, y1: 200 }
const PIVOT = pivotOf(BOX) // { x: 200, y: 150 }

const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps

describe('scaleTransform', () => {
  const at = (x: number, y: number) => ({ x, y })

  /** Drag the 'se' handle to `p`, keeping or breaking the aspect ratio. */
  const dragSE = (p: { x: number; y: number }, proportional = true, fromCentre = false) =>
    scaleTransform({
      local: BOX,
      base: IDENTITY_TRANSFORM,
      pivot: PIVOT,
      handle: 'se',
      at: p,
      proportional,
      fromCentre,
    })

  test('dragging se to twice the distance doubles the scale', () => {
    // se is at (300,200); the anchor nw is at (100,100)
    const t = dragSE(at(500, 300))
    expect(near(t.scaleX, 2, 1e-9)).toBe(true)
    expect(near(t.scaleY, 2, 1e-9)).toBe(true)
  })

  test('the anchor does not move', () => {
    const t = dragSE(at(500, 300))
    const m = transformMatrix(t, PIVOT)
    const nw = applyMatrix(m, { x: BOX.x0, y: BOX.y0 })
    expect(near(nw.x, BOX.x0, 1e-6)).toBe(true)
    expect(near(nw.y, BOX.y0, 1e-6)).toBe(true)
  })

  test('the dragged handle lands under the pointer (free scale)', () => {
    // with the axes coupled the box follows the dominant axis, so exact landing
    // is only promised when they are independent
    const target = at(437, 288)
    const t = dragSE(target, false)
    const m = transformMatrix(t, PIVOT)
    const se = applyMatrix(m, { x: BOX.x1, y: BOX.y1 })
    expect(near(se.x, target.x, 1e-6)).toBe(true)
    expect(near(se.y, target.y, 1e-6)).toBe(true)
  })

  test('Shift frees the axes: x and y scale independently', () => {
    const t = dragSE(at(500, 250), false)
    expect(near(t.scaleX, 2, 1e-9)).toBe(true)
    expect(near(t.scaleY, 1.5, 1e-9)).toBe(true)
  })

  test('Alt scales about the centre, so both edges move', () => {
    const t = dragSE(at(500, 300), true, true)
    const m = transformMatrix(t, PIVOT)
    const nw = applyMatrix(m, { x: BOX.x0, y: BOX.y0 })
    // the opposite corner moved too — that is what "from centre" means
    expect(Math.abs(nw.x - BOX.x0)).toBeGreaterThan(1)
    expect(near(applyMatrix(m, PIVOT).x, PIVOT.x, 1e-6)).toBe(true)
  })

  test('an edge handle only moves its own axis', () => {
    const t = scaleTransform({
      local: BOX,
      base: IDENTITY_TRANSFORM,
      pivot: PIVOT,
      handle: 'e',
      at: at(400, 999),
      proportional: true,
      fromCentre: false,
    })
    expect(near(t.scaleY, 1, 1e-9)).toBe(true)
    expect(t.scaleX).toBeGreaterThan(1)
  })

  test('dragging a handle past its anchor flips the layer', () => {
    const t = dragSE(at(0, 0))
    expect(t.scaleX).toBeLessThan(0)
    expect(t.scaleY).toBeLessThan(0)
  })

  test('scaling an already-rotated layer about the pivot still holds the anchor', () => {
    const base: LayerTransform = { x: 10, y: -4, scaleX: 1.3, scaleY: 0.8, rotation: 28 }
    const m0 = transformMatrix(base, PIVOT)
    const anchor0 = applyMatrix(m0, { x: BOX.x0, y: BOX.y0 })
    const se0 = applyMatrix(m0, { x: BOX.x1, y: BOX.y1 })
    const t = scaleTransform({
      local: BOX,
      base,
      pivot: PIVOT,
      handle: 'se',
      at: { x: anchor0.x + (se0.x - anchor0.x) * 2, y: anchor0.y + (se0.y - anchor0.y) * 2 },
      proportional: true,
      fromCentre: false,
    })
    const m1 = transformMatrix(t, PIVOT)
    const anchor1 = applyMatrix(m1, { x: BOX.x0, y: BOX.y0 })
    expect(near(anchor1.x, anchor0.x, 1e-6)).toBe(true)
    expect(near(anchor1.y, anchor0.y, 1e-6)).toBe(true)
  })

  test('a zero scale is refused rather than collapsing the layer', () => {
    const t = dragSE(at(100, 100))
    expect(Number.isFinite(t.scaleX)).toBe(true)
    expect(Math.abs(t.scaleX)).toBeGreaterThan(0)
  })
})

describe('rotateTransform', () => {
  test('grabbing the top edge and swinging 90° rotates 90° about the pivot', () => {
    const q = rectToQuad(BOX)
    const start = handlePoints(q).n
    const t = rotateTransform({
      local: BOX,
      base: IDENTITY_TRANSFORM,
      pivot: PIVOT,
      at: { x: PIVOT.x + (start.y - PIVOT.y), y: PIVOT.y - (start.x - PIVOT.x) },
      snap: false,
    })
    expect(near(Math.abs(t.rotation), 90, 1e-6)).toBe(true)
  })

  test('the pivot does not move', () => {
    const t = rotateTransform({
      local: BOX,
      base: { x: 7, y: 9, scaleX: 1.4, scaleY: 0.6, rotation: 0 },
      pivot: PIVOT,
      at: { x: PIVOT.x + 120, y: PIVOT.y + 40 },
      snap: false,
    })
    const p = applyMatrix(transformMatrix(t, PIVOT), PIVOT)
    expect(near(p.x, PIVOT.x + 7, 1e-6)).toBe(true)
    expect(near(p.y, PIVOT.y + 9, 1e-6)).toBe(true)
  })

  test('Shift snaps to 15 degree steps', () => {
    const q = rectToQuad(BOX)
    const start = handlePoints(q).n
    const t = rotateTransform({
      local: BOX,
      base: IDENTITY_TRANSFORM,
      pivot: PIVOT,
      at: { x: PIVOT.x + (start.x - PIVOT.x) * 0.98, y: PIVOT.y + (start.y - PIVOT.y) + 6 },
      snap: true,
    })
    expect(near(t.rotation / 15, Math.round(t.rotation / 15), 1e-9)).toBe(true)
  })

  test('leaving the grip where it started is zero rotation, not a full turn', () => {
    // the reference is the grip, so holding still must read as 0 — measuring
    // from the box centre would degenerate to an undefined angle here
    const t = rotateTransform({
      local: BOX,
      base: IDENTITY_TRANSFORM,
      pivot: PIVOT,
      at: { x: PIVOT.x, y: PIVOT.y - 50 },
      snap: false,
    })
    expect(t.rotation).toBe(0)
  })

  test('the angle is normalised into (-180, 180]', () => {
    const t = rotateTransform({
      local: BOX,
      base: IDENTITY_TRANSFORM,
      pivot: PIVOT,
      at: { x: PIVOT.x, y: PIVOT.y + 50 },
      snap: false,
    })
    expect(t.rotation).toBeGreaterThan(-180)
    expect(t.rotation).toBeLessThanOrEqual(180)
  })
})
