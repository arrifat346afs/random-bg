/**
 * transform.test.ts — the pure maths behind Free Transform.
 *
 * These are the parts that cannot be checked by looking at the screen: the
 * composition order, the anchors, the modifier behaviour and the migration. A
 * resize that is 3 % out still *looks* plausible, so the assertions are numeric.
 */

import { describe, expect, test } from 'bun:test'
import {
  IDENTITY_TRANSFORM,
  applyMatrix,
  invertMatrix,
  isIdentityTransform,
  layerTransform,
  matrixAngleDeg,
  pivotOf,
  quadBounds,
  stampMatrix,
  transformAttr,
  transformMatrix,
  transformQuad,
  type LayerTransform,
} from './transform'
import type { Rect } from './render/bounds'

const BOX: Rect = { x0: 100, y0: 100, x1: 300, y1: 200 }
const PIVOT = pivotOf(BOX) // { x: 200, y: 150 }

const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps
function expectMatrixClose(
  got: { a: number; b: number; c: number; d: number; e: number; f: number },
  want: { a: number; b: number; c: number; d: number; e: number; f: number },
): void {
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
    if (!near(got[k], want[k])) {
      throw new Error(`matrix.${k}: got ${got[k]}, want ${want[k]}`)
    }
  }
}

describe('transformMatrix', () => {
  test('identity leaves every point alone', () => {
    expectMatrixClose(transformMatrix(IDENTITY_TRANSFORM, PIVOT), {
      a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
    })
  })

  test('the pivot is the fixed point of scale and rotation', () => {
    const m = transformMatrix(
      { x: 0, y: 0, scaleX: 3, scaleY: 3, rotation: 37 },
      PIVOT,
    )
    const p = applyMatrix(m, PIVOT)
    expect(near(p.x, PIVOT.x)).toBe(true)
    expect(near(p.y, PIVOT.y)).toBe(true)
  })

  test('scaling by 2 about the pivot doubles the distance from it', () => {
    const m = transformMatrix({ x: 0, y: 0, scaleX: 2, scaleY: 2, rotation: 0 }, PIVOT)
    const corner = applyMatrix(m, { x: BOX.x1, y: BOX.y1 })
    expect(near(corner.x - PIVOT.x, (BOX.x1 - PIVOT.x) * 2)).toBe(true)
    expect(near(corner.y - PIVOT.y, (BOX.y1 - PIVOT.y) * 2)).toBe(true)
  })

  test('rotation is clockwise degrees about the pivot', () => {
    const m = transformMatrix({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 90 }, PIVOT)
    const p = applyMatrix(m, { x: BOX.x1, y: PIVOT.y })
    // a point to the right of the pivot swings down by 90°
    expect(near(p.x, PIVOT.x)).toBe(true)
    expect(near(p.y, PIVOT.y + (BOX.x1 - PIVOT.x))).toBe(true)
    expect(near(matrixAngleDeg(m), 90)).toBe(true)
  })

  test('translation is applied after scale and rotation', () => {
    const m = transformMatrix({ x: 5, y: -7, scaleX: 2, scaleY: 2, rotation: 0 }, PIVOT)
    const p = applyMatrix(m, PIVOT)
    expect(near(p.x, PIVOT.x + 5)).toBe(true)
    expect(near(p.y, PIVOT.y - 7)).toBe(true)
  })

  test('invert undoes apply', () => {
    const m = transformMatrix({ x: 3, y: 4, scaleX: 2, scaleY: 0.5, rotation: 22 }, PIVOT)
    const inv = invertMatrix(m)
    expect(inv).not.toBeNull()
    const p = { x: 137, y: -44 }
    const round = applyMatrix(inv!, applyMatrix(m, p))
    expect(near(round.x, p.x, 1e-6)).toBe(true)
    expect(near(round.y, p.y, 1e-6)).toBe(true)
  })

  test('a singular matrix has no inverse', () => {
    expect(invertMatrix({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 })).toBeNull()
  })

  test('transformQuad maps all four corners and quadBounds hulls them', () => {
    const m = transformMatrix({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 45 }, PIVOT)
    const q = transformQuad(BOX, m)
    expect(q).toHaveLength(4)
    const hull = quadBounds(q)
    // a 45° rotation makes the hull strictly larger than the source
    expect(hull.x1 - hull.x0).toBeGreaterThan(BOX.x1 - BOX.x0)
    for (const corner of q) {
      expect(corner.x).toBeGreaterThanOrEqual(hull.x0)
      expect(corner.x).toBeLessThanOrEqual(hull.x1)
    }
  })

  test('stampMatrix agrees with transformMatrix for a composed stamp', () => {
    const t: LayerTransform = { x: 11, y: 22, scaleX: 1.5, scaleY: 2.5, rotation: 33 }
    expectMatrixClose(
      stampMatrix(t.x, t.y, { scaleX: t.scaleX, scaleY: t.scaleY, rotation: t.rotation, px: PIVOT.x, py: PIVOT.y }),
      transformMatrix(t, PIVOT),
    )
  })
})

describe('layerTransform defaults', () => {
  test('a missing transform is the identity', () => {
    expect(layerTransform({})).toEqual(IDENTITY_TRANSFORM)
    expect(isIdentityTransform(layerTransform({}))).toBe(true)
  })

  test('a partial transform is filled in', () => {
    expect(layerTransform({ transform: { scaleX: 2 } })).toEqual({
      x: 0, y: 0, scaleX: 2, scaleY: 1, rotation: 0,
    })
  })

  test('a non-finite value falls back rather than propagating', () => {
    const t = layerTransform({ transform: { x: Number.NaN, rotation: Infinity } })
    expect(t.x).toBe(0)
    expect(t.rotation).toBe(0)
  })
})

describe('transformAttr', () => {
  test('identity emits nothing', () => {
    expect(transformAttr(IDENTITY_TRANSFORM, PIVOT)).toBe('')
  })

  test('a pure move is a plain translate — the pre-transform byte pattern', () => {
    expect(transformAttr({ x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 0 }, PIVOT)).toBe(
      'translate(100 50)',
    )
  })

  test('scale and rotation carry the pivot sandwich', () => {
    const attr = transformAttr({ x: 0, y: 0, scaleX: 2, scaleY: 2, rotation: 45 }, PIVOT)
    expect(attr).toContain('rotate(45)')
    expect(attr).toContain('scale(2 2)')
    expect(attr).toContain(`translate(${PIVOT.x} ${PIVOT.y})`)
  })
})
