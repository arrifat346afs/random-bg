/**
 * handles.test.ts — handle layout, cursors, snapping and legacy migration.
 *
 * Companion to `gesture.test.ts` (scale and rotate). Same BOX fixture, same
 * reason for the split: no file over the line budget.
 */

import { describe, expect, test } from 'bun:test'
import { IDENTITY_TRANSFORM, pivotOf, type LayerTransform } from './transform'
import { cursorForHandle, handlePoints, isEdgeHandle, anchorHandle } from './handles'
import { rectToQuad } from './scaling'
import { canvasRules, snapBox, snapValue } from './snap'
import { migrateLayer, migrateLayers } from './migrate'
import { transformFromOffset } from './transform'
import type { Rect } from './render/bounds'

const BOX: Rect = { x0: 100, y0: 100, x1: 300, y1: 200 }
void pivotOf

const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps

describe('handles', () => {
  test('every handle lands on its edge or corner', () => {
    const q = rectToQuad(BOX)
    const p = handlePoints(q)
    expect(p.nw).toEqual({ x: BOX.x0, y: BOX.y0 })
    expect(p.se).toEqual({ x: BOX.x1, y: BOX.y1 })
    expect(near(p.n.x, (BOX.x0 + BOX.x1) / 2)).toBe(true)
    expect(near(p.n.y, BOX.y0)).toBe(true)
    expect(near(p.e.x, BOX.x1)).toBe(true)
    expect(near(p.e.y, (BOX.y0 + BOX.y1) / 2)).toBe(true)
  })

  test('each handle has a distinct opposite', () => {
    expect(anchorHandle('nw')).toBe('se')
    expect(anchorHandle('se')).toBe('nw')
    expect(anchorHandle('n')).toBe('s')
    expect(anchorHandle('e')).toBe('w')
  })

  test('edge handles are recognised', () => {
    expect(isEdgeHandle('n')).toBe(true)
    expect(isEdgeHandle('e')).toBe(true)
    expect(isEdgeHandle('nw')).toBe(false)
  })

  test('cursors rotate with the layer', () => {
    expect(cursorForHandle('nw', 0)).toBe('nwse-resize')
    expect(cursorForHandle('e', 0)).toBe('ew-resize')
    expect(cursorForHandle('n', 0)).toBe('ns-resize')
    // rotating the box 45 deg puts the east handle where the se corner used to
    // be, so it must offer that corner's cursor
    expect(cursorForHandle('e', 45)).toBe(cursorForHandle('se', 0))
    // and a quarter turn lands on the diagonal the other way round
    expect(cursorForHandle('nw', 90)).toBe('nesw-resize')
  })
})

describe('snapping', () => {
  const rules = canvasRules(400, 300)

  test('canvas rules cover both edges and the centre on each axis', () => {
    expect(rules.filter((r) => r.axis === 'x').map((r) => r.at)).toEqual([0, 200, 400])
    expect(rules.filter((r) => r.axis === 'y').map((r) => r.at)).toEqual([0, 150, 300])
  })

  test('a value within tolerance snaps, and reports which rule fired', () => {
    const r = snapValue(203, 'x', rules, 6)
    expect(r.value).toBe(200)
    expect(r.rule?.at).toBe(200)
  })

  test('a value outside tolerance is left alone', () => {
    const r = snapValue(260, 'x', rules, 6)
    expect(r.value).toBe(260)
    expect(r.rule).toBeNull()
  })

  test('a box whose centre is near the canvas centre is nudged onto it', () => {
    const box = { x0: 10, y0: 140, x1: 396, y1: 156 }
    const s = snapBox(box, rules, 400, 300)
    expect(Math.abs(s.dy)).toBeGreaterThan(0)
    expect(s.dy).toBeCloseTo(150 - (box.y0 + box.y1) / 2, 6)
    expect(s.guides.length).toBeGreaterThan(0)
  })

  test('a box far from every rule is not nudged', () => {
    // 190 keeps the right edge clear of the 200 centre rule
    const s = snapBox({ x0: 90, y0: 100, x1: 190, y1: 140 }, rules, 400, 300)
    expect(s.dx).toBe(0)
    expect(s.dy).toBe(0)
    expect(s.guides).toHaveLength(0)
  })
})

describe('migration', () => {
  const base = { id: 'l1', name: 'L', gen: 'smoke' } as never

  test('a legacy offset becomes a transform with identity scale', () => {
    const l = migrateLayer({ ...(base as object), offset: { x: 12, y: -4 } } as never) as {
      transform: LayerTransform
      offset?: unknown
    }
    expect(l.transform).toEqual({ x: 12, y: -4, scaleX: 1, scaleY: 1, rotation: 0 })
    expect(l.offset).toBeUndefined()
  })

  test('an already-migrated layer is returned by identity', () => {
    const l = { ...(base as object), transform: { ...IDENTITY_TRANSFORM, x: 5 } } as never
    expect(migrateLayer(l as never)).toBe(l)
  })

  test('a transform wins over a stale offset', () => {
    const l = migrateLayer({
      ...(base as object),
      offset: { x: 999, y: 999 },
      transform: { ...IDENTITY_TRANSFORM, x: 1 },
    } as never) as { transform: LayerTransform }
    expect(l.transform.x).toBe(1)
  })

  test('migrating twice changes nothing', () => {
    const once = migrateLayer({ ...(base as object), offset: { x: 3, y: 3 } } as never)
    expect(migrateLayer(once as never)).toBe(once)
  })

  test('a project with no legacy offset is returned by identity', () => {
    const p = { layers: [{ ...(base as object) }] } as never
    expect(migrateLayers(p)).toBe(p)
  })

  test('transformFromOffset defaults scale and rotation', () => {
    expect(transformFromOffset({ x: 1, y: 2 })).toEqual({
      x: 1, y: 2, scaleX: 1, scaleY: 1, rotation: 0,
    })
    expect(transformFromOffset(null)).toEqual(IDENTITY_TRANSFORM)
  })
})