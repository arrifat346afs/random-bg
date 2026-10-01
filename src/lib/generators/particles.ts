/**
 * Particle field — the base generator.
 * Points, discs, soft glows, rings, stars and 4/6/8-ray sparkles.
 */

import type { GeneratorDef } from '../schema'
import { sampleDistribution } from '../dist'
import { circle, glowPaint, type Node } from '../ir'
import {
  colorOf,
  countParam,
  done,
  emitCount,
  emitDot,
  int,
  num,
  bool,
  shapeOf,
  sizeParam,
  type DotStyle,
} from './kit'

const SHAPES: { value: string; label: string }[] = [
  { value: 'point', label: 'Point' },
  { value: 'disc', label: 'Soft disc' },
  { value: 'glow', label: 'Glow orb' },
  { value: 'ring', label: 'Ring' },
  { value: 'star', label: 'Star' },
  { value: 'sparkle', label: 'Sparkle' },
  { value: 'hex', label: 'Hexagon' },
]

export const particlesGen: GeneratorDef = {
  id: 'particles',
  name: 'Particle field',
  icon: 'sparkles',
  family: 'particles',
  tags: ['dust', 'glitter', 'stars', 'bokeh-adjacent'],
  description:
    'Scattered primitives — the workhorse layer. Combine with a radial or poisson distribution.',
  params: [
    countParam(600, 20000, 1200),
    {
      key: 'shape',
      label: 'Primitive',
      type: 'enum',
      options: SHAPES,
      default: 'disc',
      section: 'shape',
    },
    sizeParam(14, 1, 260),
    {
      key: 'sizeVary',
      label: 'Size variance',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
      section: 'shape',
      hint: 'How much depth spread affects size.',
      rand: { min: 0.2, max: 1 },
    },
    {
      key: 'softness',
      label: 'Softness',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.55,
      section: 'style',
      hint: 'Edge falloff of each primitive (0 = crisp, 1 = fully diffuse).',
      rand: { min: 0.25, max: 1 },
    },
    {
      key: 'rays',
      label: 'Rays',
      type: 'enum',
      options: [
        { value: 4, label: '4' },
        { value: 6, label: '6' },
        { value: 8, label: '8' },
      ],
      default: 4,
      section: 'shape',
      when: { key: 'shape', equals: 'sparkle' },
    },
    {
      key: 'ringWidth',
      label: 'Ring width',
      type: 'float',
      min: 0.05,
      max: 1,
      step: 0.01,
      default: 0.35,
      section: 'shape',
      when: { key: 'shape', equals: 'ring' },
    },
    {
      key: 'alpha',
      label: 'Opacity',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.85,
      section: 'style',
      rand: { min: 0.4, max: 1 },
    },
    {
      key: 'twinkle',
      label: 'Twinkle',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      section: 'motion',
      hint: 'Per-primitive opacity variation — reads as scintillation.',
      rand: { min: 0, max: 0.8 },
    },
    {
      key: 'rotate',
      label: 'Random rotation',
      type: 'bool',
      default: true,
      section: 'shape',
    },
    {
      key: 'hotCore',
      label: 'Hot core',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      section: 'style',
      hint: 'Adds an additive white centre so lights look lit, not painted.',
      rand: { min: 0, max: 0.9 },
    },
  ],
  defaults: () => ({
    count: 600,
    shape: 'disc',
    size: 14,
    sizeVary: 0.6,
    softness: 0.55,
    rays: 4,
    ringWidth: 0.35,
    alpha: 0.85,
    twinkle: 0.35,
    rotate: true,
    hotCore: 0.35,
  }),
  density: (p) => num(p, 'count', 600) * 1.6,
  generate(p, ctx) {
    const count = emitCount(p, 600)
    const samples = sampleDistribution(ctx, count)
    const nodes: Node[] = []
    const base = num(p, 'size', 14)
    const alpha = num(p, 'alpha', 0.85)
    const twinkle = num(p, 'twinkle', 0.35)
    const sizeVary = num(p, 'sizeVary', 0.6)
    const hot = num(p, 'hotCore', 0.35)
    const rotate = bool(p, 'rotate', true)
    const soft = num(p, 'softness', 0.55)

    const style: DotStyle = {
      shape: (str2(p.shape) ?? 'disc') as DotStyle['shape'],
      softness: soft,
      rays: int(p, 'rays', 4),
      ringWidth: num(p, 'ringWidth', 0.35),
    }

    for (const s of samples) {
      const depthScale = 1 - (s.z - 0.5) * sizeVary
      const { r, a: da, blur } = shapeOf(ctx.dist, s, base * depthScale)
      let a = alpha * da * (s.mask ?? 1)
      if (twinkle > 0) {
        a *= 1 - twinkle * ctx.rng.next() * 0.9
      }
      const c = colorOf(ctx, s, r / Math.max(1, ctx.minDim * 0.2))
      const rot = rotate ? ctx.rng.range(0, Math.PI * 2) : 0
      const extra: Partial<Node> = {}
      if (blur > 0.6) extra.blur = blur * 0.5

      emitDot(nodes, style, s.x, s.y, r, c, Math.min(1, a), rot, extra)

      if (hot > 0 && ctx.rng.next() < hot) {
        nodes.push(
          circle(
            s.x,
            s.y,
            Math.max(0.7, r * 0.45),
            glowPaint(s.x, s.y, Math.max(0.7, r * 0.45), '#ffffff', a * 0.55 * hot),
            { blend: 'plus-lighter', op: 1 },
          ),
        )
      }
    }
    return done(ctx.w, ctx.h, nodes)
  },
}

function str2(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}
