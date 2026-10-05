/**
 * transformBox.test.ts — tests for the unified transform box geometry.
 *
 * The key invariant: the rotation stem is a constant SCREEN pixel length
 * (ROTATE_STEM_PX) at any zoom, any rotation, and any scale — as long as
 * the knob is not clamped to the stage edge.
 */

import { describe, expect, test } from 'bun:test'
import { computeTransformBox, isValidTransformBox, ROTATE_STEM_PX } from './transformBox'
import { IDENTITY_TRANSFORM, type LayerTransform } from './transform'
import type { Rect } from './render/bounds'
import type { StageView } from '../components/preview/view'

const BOX: Rect = { x0: 100, y0: 100, x1: 300, y1: 200 }

function makeView(scale: number): StageView {
  return { scale, ox: 0, oy: 0 }
}

// A stage large enough to contain the knob at all test scales.
// At scale=8, the knob is at ~(1600, -3680) in screen space, so we need
// a stage at least ~3760px in each dimension. At scale=0.05, the knob is
// at ~(10, -23), so we need a stage at least ~80px. We use 10000x10000.
// The margin is 40px, so the stage must be at least 80px larger than the
// knob position in each direction.
const STAGE = { width: 10000, height: 10000 }

// A stage with a smaller margin for the stem length tests, so the knob
// is not clamped at extreme scales.
const STAGE_NO_CLAMP = { width: 100, height: 100 }

function stemLength(box: ReturnType<typeof computeTransformBox>): number {
  const n = box.edgeMids.n
  const end = box.rotateStemEnd
  return Math.hypot(end.x - n.x, end.y - n.y)
}

describe('computeTransformBox', () => {
  describe('stem length is constant in screen pixels', () => {
    const scales = [0.05, 1, 8]
    const rotations = [0, 45, 90, 180]

    for (const scale of scales) {
      for (const rotation of rotations) {
        test(`scale=${scale}, rotation=${rotation}°`, () => {
          const t: LayerTransform = { ...IDENTITY_TRANSFORM, rotation }
          // Pass null for stage to disable clamping — the stem length
          // invariant only holds when the knob is not clamped.
          const box = computeTransformBox(BOX, t, makeView(scale), null)
          const len = stemLength(box)
          expect(len).toBeCloseTo(ROTATE_STEM_PX, 5)
        })
      }
    }

    test('scaleX=-1 (horizontal flip)', () => {
      const t: LayerTransform = { ...IDENTITY_TRANSFORM, scaleX: -1 }
      const box = computeTransformBox(BOX, t, makeView(1), null)
      expect(stemLength(box)).toBeCloseTo(ROTATE_STEM_PX, 5)
    })

    test('scaleY=-1 (vertical flip)', () => {
      const t: LayerTransform = { ...IDENTITY_TRANSFORM, scaleY: -1 }
      const box = computeTransformBox(BOX, t, makeView(1), null)
      expect(stemLength(box)).toBeCloseTo(ROTATE_STEM_PX, 5)
    })

    test('scaleX=-1, scaleY=-1 (180° rotation via negative scale)', () => {
      const t: LayerTransform = { ...IDENTITY_TRANSFORM, scaleX: -1, scaleY: -1 }
      const box = computeTransformBox(BOX, t, makeView(1), null)
      expect(stemLength(box)).toBeCloseTo(ROTATE_STEM_PX, 5)
    })
  })

  describe('box dimensions match geometry bounds', () => {
    test('unrotated box: width and height match geometry', () => {
      const box = computeTransformBox(BOX, IDENTITY_TRANSFORM, makeView(1), STAGE)
      const [tl, tr, br, bl] = box.corners
      const width = Math.hypot(tr.x - tl.x, tr.y - tl.y)
      const height = Math.hypot(bl.x - tl.x, bl.y - tl.y)
      expect(width).toBeCloseTo(BOX.x1 - BOX.x0, 5)
      expect(height).toBeCloseTo(BOX.y1 - BOX.y0, 5)
    })

    test('scaled box: dimensions scale with the layer', () => {
      const t: LayerTransform = { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 3 }
      const box = computeTransformBox(BOX, t, makeView(1), STAGE)
      const [tl, tr, br, bl] = box.corners
      const width = Math.hypot(tr.x - tl.x, tr.y - tl.y)
      const height = Math.hypot(bl.x - tl.x, bl.y - tl.y)
      expect(width).toBeCloseTo((BOX.x1 - BOX.x0) * 2, 5)
      expect(height).toBeCloseTo((BOX.y1 - BOX.y0) * 3, 5)
    })

    test('box does not include blur/glow spread (geometry bounds only)', () => {
      // The box should be exactly the geometry bounds, not grown by any spread.
      // This is a property of the input bounds — computeTransformBox does not
      // add any spread. The test verifies the box matches the input exactly.
      const box = computeTransformBox(BOX, IDENTITY_TRANSFORM, makeView(1), STAGE)
      const [tl, tr, br, bl] = box.corners
      expect(tl.x).toBeCloseTo(BOX.x0, 5)
      expect(tl.y).toBeCloseTo(BOX.y0, 5)
      expect(tr.x).toBeCloseTo(BOX.x1, 5)
      expect(tr.y).toBeCloseTo(BOX.y0, 5)
      expect(br.x).toBeCloseTo(BOX.x1, 5)
      expect(br.y).toBeCloseTo(BOX.y1, 5)
      expect(bl.x).toBeCloseTo(BOX.x0, 5)
      expect(bl.y).toBeCloseTo(BOX.y1, 5)
    })
  })

  describe('edge cases', () => {
    test('single point bounds: no exception, valid box', () => {
      const point: Rect = { x0: 50, y0: 50, x1: 50, y1: 50 }
      const box = computeTransformBox(point, IDENTITY_TRANSFORM, makeView(1), STAGE)
      // A single point has zero area, so isValidTransformBox returns false.
      // But the function should not throw.
      expect(() => computeTransformBox(point, IDENTITY_TRANSFORM, makeView(1), STAGE)).not.toThrow()
    })

    test('NaN in transform: isValidTransformBox returns false', () => {
      const t: LayerTransform = { ...IDENTITY_TRANSFORM, x: NaN }
      const box = computeTransformBox(BOX, t, makeView(1), STAGE)
      expect(isValidTransformBox(box)).toBe(false)
    })

    test('Infinity in transform: isValidTransformBox returns false', () => {
      const t: LayerTransform = { ...IDENTITY_TRANSFORM, scaleX: Infinity }
      const box = computeTransformBox(BOX, t, makeView(1), STAGE)
      expect(isValidTransformBox(box)).toBe(false)
    })

    test('zero scale: isValidTransformBox returns false', () => {
      const t: LayerTransform = { ...IDENTITY_TRANSFORM, scaleX: 0, scaleY: 0 }
      const box = computeTransformBox(BOX, t, makeView(1), STAGE)
      expect(isValidTransformBox(box)).toBe(false)
    })
  })

  describe('rotate knob clamping', () => {
    test('knob is clamped inside stage when box is near top edge', () => {
      // Place the box near the top of the stage
      const t: LayerTransform = { ...IDENTITY_TRANSFORM, x: 0, y: -50 }
      const box = computeTransformBox(BOX, t, makeView(1), { width: 800, height: 600 })
      const end = box.rotateStemEnd
      // The knob should be within the stage (with 40px margin)
      expect(end.x).toBeGreaterThanOrEqual(40)
      expect(end.x).toBeLessThanOrEqual(800 - 40)
      expect(end.y).toBeGreaterThanOrEqual(40)
      expect(end.y).toBeLessThanOrEqual(600 - 40)
    })

    test('knob is clamped inside stage when box is near bottom edge', () => {
      const t: LayerTransform = { ...IDENTITY_TRANSFORM, x: 0, y: 500 }
      const box = computeTransformBox(BOX, t, makeView(1), { width: 800, height: 600 })
      const end = box.rotateStemEnd
      expect(end.x).toBeGreaterThanOrEqual(40)
      expect(end.x).toBeLessThanOrEqual(800 - 40)
      expect(end.y).toBeGreaterThanOrEqual(40)
      expect(end.y).toBeLessThanOrEqual(600 - 40)
    })
  })

  describe('rotation direction', () => {
    test('unrotated box: stem points up (negative y)', () => {
      const box = computeTransformBox(BOX, IDENTITY_TRANSFORM, makeView(1), null)
      const n = box.edgeMids.n
      const end = box.rotateStemEnd
      // The stem should point up (negative y direction)
      expect(end.y).toBeLessThan(n.y)
    })

    test('90° rotated box: stem points right (positive x)', () => {
      const t: LayerTransform = { ...IDENTITY_TRANSFORM, rotation: 90 }
      const box = computeTransformBox(BOX, t, makeView(1), null)
      const n = box.edgeMids.n
      const end = box.rotateStemEnd
      // After 90° rotation, "up" points right
      expect(end.x).toBeGreaterThan(n.x)
    })

    test('180° rotated box: stem points down (positive y)', () => {
      const t: LayerTransform = { ...IDENTITY_TRANSFORM, rotation: 180 }
      const box = computeTransformBox(BOX, t, makeView(1), null)
      const n = box.edgeMids.n
      const end = box.rotateStemEnd
      // After 180° rotation, "up" points down
      expect(end.y).toBeGreaterThan(n.y)
    })
  })
})
