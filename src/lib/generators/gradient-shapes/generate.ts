/**
 * gradient-shapes/generate.ts — Turn params into IR nodes.
 *
 * Slots come from `layout.ts`, colours from the layer mapping, gradients
 * from `gradient.ts`. Dense packs are dimmed with `alphaForLoad` so overlap
 * does not clip to white. Pure, no DOM.
 */

import type { GenContext, Params } from '../../schema'
import { rampColor } from '../../palette'
import type { Sample } from '../../dist'
import { type Node } from '../../ir'
import { colorOf, done, emitCount, num, str } from '../kit'
import { alphaForLoad } from '../density'
import { darkenHex, lightenHex } from '../shade'
import { isLayoutKind, layoutSlots, type LayoutKind } from './layout'
import { DRAWABLE_SHAPES, isShapeKind, shapeNode, type ShapeKind } from './shapes'
import { shapeGradient, type GradientKind } from './gradient'

/** Overlap guard budget for packed layouts. */
const SHAPE_LOAD_BUDGET = 10

export function generateGradientShapes(p: Params, ctx: GenContext): ReturnType<typeof done> {
  const rawShape: string = str(p, 'shape', 'mixed')
  const shapeOpt: ShapeKind | 'mixed' = rawShape === 'mixed' ? 'mixed' : isShapeKind(rawShape) ? rawShape : 'mixed'
  const rawLayout: string = str(p, 'layout', 'offsetCols')
  const layout: LayoutKind = isLayoutKind(rawLayout) ? rawLayout : 'offsetCols'
  // a single shape is a valid result — exempt from MIN_EMIT
  const count: number = emitCount(p, 18, 1)
  const sizeMin: number = Math.max(4, num(p, 'sizeMin', 90))
  const sizeMax: number = Math.max(sizeMin + 4, num(p, 'sizeMax', 260))
  const overlap: number = num(p, 'overlap', 0.35)
  const angleMode: string = str(p, 'angleMode', 'aligned')
  const fixedAngle: number = (num(p, 'angle', 135) * Math.PI) / 180
  const rawGrad: string = str(p, 'gradientKind', 'mixed')
  const gradOpt: GradientKind | 'mixed' = rawGrad === 'linear' || rawGrad === 'radial' ? rawGrad : 'mixed'
  const contrast: number = num(p, 'contrast', 0.65)
  const softness: number = num(p, 'softness', 0.25)
  const alpha: number = num(p, 'alpha', 0.95)

  const guarded: number = alphaForLoad(alpha, count * (0.4 + overlap), SHAPE_LOAD_BUDGET)
  const slots = layoutSlots(layout, ctx.rng.fork('layout'), count, ctx.w, ctx.h, sizeMin, sizeMax, overlap)
  const nodes: Node[] = []
  const colors: string[] = ctx.color.palette.colors.length ? ctx.color.palette.colors : ['#ffffff']

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const shape: ShapeKind =
      shapeOpt === 'mixed' ? DRAWABLE_SHAPES[i % DRAWABLE_SHAPES.length] : shapeOpt
    const sample: Sample = { x: slot.x, y: slot.y, z: 0.5, t: slot.t, edge: 0, mask: 1 }
    const base: string = colorOf(ctx, sample, slot.size / Math.max(1, ctx.minDim))
    // two stops around the base colour: lightness span set by contrast
    const span: number = 0.15 + contrast * 0.6
    const from: string = lightenHex(base, span * 0.5)
    const to: string = darkenHex(rampColor(colors, (slot.t + 0.35) % 1), span * 0.5)
    const grad: GradientKind =
      gradOpt === 'mixed' ? (i % 2 === 0 ? 'linear' : 'radial') : gradOpt
    const angle: number =
      angleMode === 'fixed' ? fixedAngle : angleMode === 'random' ? ctx.rng.fork('angle', i).range(0, Math.PI * 2) : slot.dir
    const paint = shapeGradient(grad, slot.x, slot.y, slot.size, angle, from, to, 1, softness)
    const rot: number = ctx.rng.fork('rot', i).range(0, Math.PI * 2)
    // concentric paints back-to-front so the smallest sits on top
    shapeNode(nodes, shape, slot.x, slot.y, slot.size, paint, guarded, rot, softness)
  }
  if (layout === 'concentric') nodes.reverse()
  return done(ctx.w, ctx.h, nodes)
}
