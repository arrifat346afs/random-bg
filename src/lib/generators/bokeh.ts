/**
 * Bokeh — out-of-focus highlight discs with depth of field.
 * Round / hexagonal / ring / onion-ring shapes, soft edges, bright rims.
 */

import type { GeneratorDef } from '../schema'
import { sampleDistribution } from '../dist'
import { circle, discPaint, ngonPts, solid, type Node, type Paint } from '../ir'
import { hexToHsl, hslToHex, mixColor } from '../palette'
import {
  bool,
  colorOf,
  countParam,
  done,
  emitCount,
  int,
  num,
  shapeOf,
  sizeParam,
} from './kit'

const SHAPES: { value: string; label: string }[] = [
  { value: 'round', label: 'Round' },
  { value: 'hex', label: 'Hexagonal' },
  { value: 'ring', label: 'Ring' },
  { value: 'onion', label: 'Onion ring' },
]

export const bokehGen: GeneratorDef = {
  id: 'bokeh',
  name: 'Bokeh',
  icon: 'circle-dot',
  family: 'light',
  tags: ['bokeh', 'camera', 'defocus', 'blur', 'highlights'],
  description: 'Defocused aperture highlights with rim glow and chromatic fringe.',
  params: [
    countParam(160, 6000, 420),
    sizeParam(60, 4, 400, 'Aperture size'),
    {
      key: 'shape',
      label: 'Aperture',
      type: 'enum',
      options: SHAPES,
      default: 'round',
      section: 'shape',
    },
    {
      key: 'softness',
      label: 'Edge softness',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.34,
      section: 'style',
      hint: 'Bokeh edges are usually fairly hard until fully defocused.',
      rand: { min: 0.1, max: 0.7 },
    },
    {
      key: 'rim',
      label: 'Rim glow',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.55,
      section: 'style',
      hint: 'Bright ring around the disc — the classic lens signature.',
      rand: { min: 0, max: 1 },
    },
    {
      key: 'rimWidth',
      label: 'Rim width',
      type: 'float',
      min: 0.01,
      max: 0.5,
      step: 0.01,
      default: 0.1,
      section: 'style',
      hint: 'Rim thickness as a fraction of the radius.',
    },
    {
      key: 'rings',
      label: 'Concentric rings',
      type: 'int',
      min: 1,
      max: 8,
      step: 1,
      default: 3,
      section: 'shape',
      when: { key: 'shape', equals: 'onion' },
    },
    {
      key: 'dof',
      label: 'Depth of field',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      section: 'depth',
      hint: 'Blurs primitives away from the focal plane.',
      rand: { min: 0.1, max: 1 },
    },
    {
      key: 'focal',
      label: 'Focal plane',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.4,
      section: 'depth',
    },
    {
      key: 'chroma',
      label: 'Chromatic fringe',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.25,
      section: 'style',
      hint: 'Subtle hue split on the rim, like real glass.',
      rand: { min: 0, max: 0.7 },
    },
    {
      key: 'alpha',
      label: 'Opacity',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.7,
      section: 'style',
      rand: { min: 0.3, max: 0.95 },
    },
    {
      key: 'hexRotate',
      label: 'Rotate hexagons',
      type: 'bool',
      default: true,
      section: 'shape',
      when: { key: 'shape', equals: 'hex' },
    },
    {
      key: 'sizeVary',
      label: 'Size variance',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.7,
      section: 'shape',
      rand: { min: 0.2, max: 1 },
    },
  ],
  defaults: () => ({
    count: 160,
    size: 60,
    shape: 'round',
    softness: 0.34,
    rim: 0.55,
    rimWidth: 0.1,
    rings: 3,
    dof: 0.5,
    focal: 0.4,
    chroma: 0.25,
    alpha: 0.7,
    hexRotate: true,
    sizeVary: 0.7,
  }),
  density: (p) => num(p, 'count', 160) * 3.2,
  generate(p, ctx) {
    const count = emitCount(p, 160)
    const samples = sampleDistribution(ctx, count)
    const nodes: Node[] = []
    const base = num(p, 'size', 60)
    const alpha = num(p, 'alpha', 0.7)
    const soft = num(p, 'softness', 0.34)
    const rim = num(p, 'rim', 0.55)
    const rimW = num(p, 'rimWidth', 0.1)
    const dof = num(p, 'dof', 0.5)
    const focal = num(p, 'focal', 0.4)
    const chroma = num(p, 'chroma', 0.25)
    const shape = typeof p.shape === 'string' ? p.shape : 'round'
    const rings = int(p, 'rings', 3)
    const hexRotate = bool(p, 'hexRotate', true)
    const vary = num(p, 'sizeVary', 0.7)

    for (const s of samples) {
      const depthScale = 1 - (s.z - 0.5) * vary
      const { r, a: da } = shapeOf(ctx.dist, s, base * depthScale)
      if (r < 0.6) continue
      const a = Math.min(1, alpha * da * (s.mask ?? 1))
      if (a <= 0.005) continue
      const c = colorOf(ctx, s, r / Math.max(1, ctx.minDim * 0.25))
      const rot = hexRotate ? ctx.rng.range(0, Math.PI * 3) : 0

      // defocus blur ∝ distance from focal plane
      const blur = dof * Math.abs(s.z - focal) * r * 1.4
      const extra: Partial<Node> = blur > 0.7 ? { blur } : {}

      if (shape === 'hex') {
        const paint: Paint = discPaint(s.x, s.y, r, c, a, Math.min(0.95, soft + 0.1))
        nodes.push({
          g: { k: 'poly', pts: ngonPts(s.x, s.y, r, 6, rot) },
          fill: paint,
          op: 1,
          ...extra,
        })
      } else if (shape === 'ring') {
        nodes.push(
          circle(s.x, s.y, r, ringPaint(s.x, s.y, r, c, a, 0.35 + soft * 0.4), extra),
        )
      } else if (shape === 'onion') {
        nodes.push(
          circle(s.x, s.y, r, discPaint(s.x, s.y, r, c, a * 0.35, soft), extra),
        )
        for (let i = 1; i <= rings; i++) {
          const rr = r * (i / (rings + 0.4))
          nodes.push(
            circle(
              s.x,
              s.y,
              rr,
              ringPaint(s.x, s.y, rr, c, a * (0.85 - i * 0.12), 0.18),
              extra,
            ),
          )
        }
      } else {
        nodes.push(circle(s.x, s.y, r, discPaint(s.x, s.y, r, c, a, soft), extra))
      }

      // bright rim
      if (rim > 0.02) {
        const rimColor = mixColor(c, '#ffffff', 0.45)
        const rw = Math.max(0.6, r * rimW)
        nodes.push({
          g: { k: 'circle', x: s.x, y: s.y, r },
          stroke: solid(rimColor),
          sw: rw,
          op: Math.min(1, a * rim),
          blend: 'plus-lighter',
          ...extra,
        })
      }

      // chromatic fringe — hue-split copy, offset a hair
      if (chroma > 0.03 && r > 6) {
        const [h, sat, l] = hexToHsl(c)
        const fringe = hslToHex(h + 28 * chroma, Math.min(100, sat + 20), l)
        nodes.push({
          g: { k: 'circle', x: s.x + r * 0.03, y: s.y - r * 0.03, r: r * 0.985 },
          stroke: solid(fringe),
          sw: Math.max(0.6, r * 0.06),
          op: a * chroma * 0.55,
          blend: 'screen',
          ...extra,
        })
      }
    }
    return done(ctx.w, ctx.h, nodes)
  },
}

/** Annulus paint: transparent centre, bright band, soft outer falloff. */
function ringPaint(
  cx: number,
  cy: number,
  r: number,
  c: string,
  a: number,
  innerFrac: number,
): Paint {
  const inner = Math.max(0, Math.min(0.92, 1 - innerFrac))
  return {
    k: 'radial',
    cx,
    cy,
    r,
    stops: [
      { t: 0, c, o: 0 },
      { t: inner * 0.75, c, o: 0 },
      { t: inner, c, o: a * 0.9 },
      { t: Math.min(0.99, inner + (1 - inner) * 0.45), c, o: a },
      { t: 1, c, o: 0 },
    ],
  }
}
