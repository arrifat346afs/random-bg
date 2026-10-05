/**
 * gesturePlacement.test.ts — the gesture blit lands where the commit lands.
 *
 * Pure (no DOM): every assertion is matrix/bounds arithmetic through
 * `gesturePlacement.ts`, `transform.ts` and `transformBox.ts`.
 */

import { describe, expect, test } from 'bun:test'
import {
  applyMatrix,
  pivotOf,
  stampMatrix,
  transformMatrix,
  type LayerTransform,
} from './transform'
import { computeTransformBox } from './transformBox'
import {
  gestureLivePoint,
  gestureParityQuad,
  gestureSelfMatrix,
  selfSnapshotBounds,
  snapshotPixelSize,
} from './gesturePlacement'
import type { Rect } from './render/bounds'
import { buildIR, circle } from './ir'

const BOX: Rect = { x0: 100, y0: 100, x1: 300, y1: 200 }
const PIVOT = pivotOf(BOX)

const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps

function expectPointClose(
  got: { x: number; y: number },
  want: { x: number; y: number },
  eps = 1e-9,
): void {
  if (!near(got.x, want.x, eps) || !near(got.y, want.y, eps)) {
    throw new Error(`point: got (${got.x},${got.y}), want (${want.x},${want.y})`)
  }
}

describe('gestureSelfMatrix placement', () => {
  const cases: Array<[string, LayerTransform]> = [
    ['translate', { x: 37, y: -42, scaleX: 1, scaleY: 1, rotation: 0 }],
    ['scale about the pivot', { x: 0, y: 0, scaleX: 2, scaleY: 0.5, rotation: 0 }],
    ['rotation 45', { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 45 }],
    ['rotation 90', { x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 90 }],
    ['rotation 180', { x: -5, y: 8, scaleX: 1, scaleY: 1, rotation: 180 }],
    ['negative scale', { x: 0, y: 0, scaleX: -1.5, scaleY: -2, rotation: 0 }],
    ['combined', { x: 12, y: -7, scaleX: 1.6, scaleY: 0.7, rotation: 33 }],
  ]

  for (const [name, t] of cases) {
    test(`a point lands at applyMatrix(transformMatrix(t, pivot), p): ${name}`, () => {
      for (const p of [
        { x: BOX.x0, y: BOX.y0 },
        { x: BOX.x1, y: BOX.y1 },
        PIVOT,
        { x: 0, y: 0 },
      ]) {
        expectPointClose(gestureLivePoint(t, PIVOT, p), applyMatrix(transformMatrix(t, PIVOT), p))
      }
    })
  }

  test('the matrix is applied once: it equals transformMatrix exactly', () => {
    const t: LayerTransform = { x: 12, y: -7, scaleX: 1.6, scaleY: 0.7, rotation: 33 }
    const m = gestureSelfMatrix(t, PIVOT)
    const want = transformMatrix(t, PIVOT)
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
      if (!near(m[k], want[k])) throw new Error(`matrix.${k}: got ${m[k]}, want ${want[k]}`)
    }
  })

  test('the old double-pivot blit would be off by L*pivot', () => {
    // Buggy blit: T(e,f)·L·T(-pivot) = [L | e − L·pivot]; correct is [L | e].
    const t: LayerTransform = { x: 12, y: -7, scaleX: 1.6, scaleY: 0.7, rotation: 33 }
    const m = transformMatrix(t, PIVOT)
    const buggyE = m.e - (m.a * PIVOT.x + m.c * PIVOT.y)
    const buggyF = m.f - (m.b * PIVOT.x + m.d * PIVOT.y)
    // Non-degenerate pivot sandwich must actually displace something.
    expect(Math.hypot(m.e - buggyE, m.f - buggyF)).toBeGreaterThan(1)
    // The fixed path keeps the pivot at tx,ty + pivot.
    expectPointClose(applyMatrix(m, PIVOT), { x: PIVOT.x + t.x, y: PIVOT.y + t.y }, 1e-6)
  })
})

describe('gesture/commit parity', () => {
  test('gesture matrix equals the committed stampMatrix', () => {
    const t: LayerTransform = { x: 10, y: 20, scaleX: 2, scaleY: 3, rotation: 90 }
    const gesture = gestureSelfMatrix(t, PIVOT)
    const committed = stampMatrix(t.x, t.y, {
      scaleX: t.scaleX,
      scaleY: t.scaleY,
      rotation: t.rotation,
      px: PIVOT.x,
      py: PIVOT.y,
    })
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
      if (!near(gesture[k], committed[k], 1e-9)) {
        throw new Error(`matrix.${k}: gesture ${gesture[k]} vs commit ${committed[k]}`)
      }
    }
  })

  test("the layer's bounding box matches the transform box quad within 1px", () => {
    const t: LayerTransform = { x: 10, y: 20, scaleX: 2, scaleY: 1.5, rotation: 45 }
    const view = { scale: 1.25, ox: 33, oy: -17 }
    const box = computeTransformBox(BOX, t, view, null)
    const parity = gestureParityQuad(BOX, t, PIVOT)
    const corners = box.canvasQuad
    const qs = [parity]
    void qs
    for (let i = 0; i < 4; i++) {
      const fromBox = corners[i]
      const c = [
        { x: BOX.x0, y: BOX.y0 },
        { x: BOX.x1, y: BOX.y0 },
        { x: BOX.x1, y: BOX.y1 },
        { x: BOX.x0, y: BOX.y1 },
      ][i]
      const fromParity = applyMatrix(gestureSelfMatrix(t, PIVOT), c)
      expect(Math.abs(fromBox.x - fromParity.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(fromBox.y - fromParity.y)).toBeLessThanOrEqual(1)
    }
  })
})

describe('self snapshot overflow', () => {
  test('content outside the canvas is kept via an offset snapshot', () => {
    // A disc centred at x=-60 with r=40: fully left of a 400-wide canvas.
    const nodes = [circle(-60, 150, 40, { k: 'solid', c: '#ffffff' })]
    void buildIR
    const bounds = selfSnapshotBounds(nodes, [], 400, 300)
    // Canvas-clamped paint would start at x=0 and lose the disc; the snapshot
    // must start left of it (minus slack) and still contain its far edge.
    expect(bounds.x0).toBeLessThan(-60 - 40)
    expect(bounds.x1).toBeGreaterThan(-60 + 40)
    expect(bounds.x0).toBeLessThan(0)
    const px = snapshotPixelSize(bounds, 0.5)
    expect(px.w).toBeGreaterThanOrEqual(1)
    expect(px.h).toBeGreaterThanOrEqual(1)
    // The disc centre survives inside the snapshot rect.
    expect(-60).toBeGreaterThanOrEqual(bounds.x0)
    expect(-60).toBeLessThanOrEqual(bounds.x1)
  })
})
