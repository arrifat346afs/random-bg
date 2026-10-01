/**
 * Emitters — physically motivated particle motion.
 * fountain · burst · rising embers · falling rain/snow/glitter · spiral ·
 * vortex · along-a-path. Each particle leaves a tapered trail.
 */

import type { GeneratorDef } from '../schema'
import { sampleDistribution } from '../dist'
import { solid, taperD, type Node } from '../ir'
import { colorOf, countParam, done, emitCount, int, num, str } from './kit'

const TYPES = [
  { value: 'fountain', label: 'Fountain' },
  { value: 'burst', label: 'Burst' },
  { value: 'embers', label: 'Rising embers' },
  { value: 'falling', label: 'Falling (rain/snow/glitter)' },
  { value: 'spiral', label: 'Spiral' },
  { value: 'vortex', label: 'Vortex' },
  { value: 'path', label: 'Along a path' },
]

export const emittersGen: GeneratorDef = {
  id: 'emitters',
  name: 'Emitters',
  icon: 'flame',
  family: 'particles',
  tags: ['embers', 'fountain', 'rain', 'snow', 'burst', 'sparks', 'particles'],
  description: 'Motion with gravity, drag and swirl — sparks, rain, confetti rain.',
  params: [
    { key: 'type', label: 'Emitter', type: 'enum', options: TYPES, default: 'embers', section: 'shape' },
    countParam(260, 6000, 500),
    {
      key: 'life',
      label: 'Life',
      type: 'int',
      min: 4,
      max: 200,
      step: 1,
      default: 46,
      section: 'motion',
      hint: 'Simulated frames per particle (trail length).',
      rand: { min: 18, max: 110 },
    },
    {
      key: 'speed',
      label: 'Speed',
      type: 'float',
      min: 0.2,
      max: 40,
      step: 0.5,
      default: 8,
      section: 'motion',
      unit: 'px/f',
      rand: { min: 2, max: 22 },
    },
    {
      key: 'spread',
      label: 'Spread',
      type: 'float',
      min: 0,
      max: 180,
      step: 1,
      default: 42,
      section: 'motion',
      unit: '°',
    },
    {
      key: 'gravity',
      label: 'Gravity',
      type: 'float',
      min: -6,
      max: 6,
      step: 0.05,
      default: 1.4,
      section: 'motion',
      hint: 'Negative = things float upward (embers, bubbles).',
      rand: { min: -3, max: 3 },
    },
    {
      key: 'drag',
      label: 'Drag',
      type: 'float',
      min: 0,
      max: 0.2,
      step: 0.005,
      default: 0.03,
      section: 'motion',
    },
    {
      key: 'wobble',
      label: 'Wobble',
      type: 'float',
      min: 0,
      max: 3,
      step: 0.05,
      default: 0.6,
      section: 'motion',
      hint: 'Sinusoidal side-to-side wander.',
    },
    {
      key: 'size',
      label: 'Size',
      type: 'float',
      min: 0.5,
      max: 80,
      step: 0.5,
      default: 5,
      section: 'shape',
      unit: 'px',
      rand: { min: 1.5, max: 24 },
    },
    {
      key: 'trail',
      label: 'Trail fade',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.75,
      section: 'style',
      hint: 'How quickly the tail disappears.',
    },
    {
      key: 'headGlow',
      label: 'Head glow',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
      section: 'style',
      hint: 'Hot point at the front of each particle.',
    },
    {
      key: 'alpha',
      label: 'Opacity',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.8,
      section: 'style',
      rand: { min: 0.35, max: 1 },
    },
    {
      key: 'spin',
      label: 'Angular speed',
      type: 'float',
      min: -3,
      max: 3,
      step: 0.05,
      default: 0.35,
      section: 'motion',
      hint: 'Swirl for spiral/vortex emitters.',
    },
    {
      key: 'arc',
      label: 'Path curvature',
      type: 'float',
      min: 0,
      max: 3,
      step: 0.05,
      default: 1.2,
      section: 'motion',
      when: { key: 'type', equals: 'path' },
    },
  ],
  defaults: () => ({
    type: 'embers',
    count: 260,
    life: 46,
    speed: 8,
    spread: 42,
    gravity: 1.4,
    drag: 0.03,
    wobble: 0.6,
    size: 5,
    trail: 0.75,
    headGlow: 0.6,
    alpha: 0.8,
    spin: 0.35,
    arc: 1.2,
  }),
  density: (p) => num(p, 'count', 260) * 2.2,
  generate(p, ctx) {
    const type = str(p, 'type', 'embers')
    const count = emitCount(p, 260)
    const life = Math.max(4, int(p, 'life', 46))
    const speed = num(p, 'speed', 8)
    const spread = (num(p, 'spread', 42) * Math.PI) / 180
    const gravity = num(p, 'gravity', 1.4)
    const drag = num(p, 'drag', 0.03)
    const wobble = num(p, 'wobble', 0.6)
    const size = num(p, 'size', 5)
    const trail = num(p, 'trail', 0.75)
    const headGlow = num(p, 'headGlow', 0.6)
    const alpha = num(p, 'alpha', 0.8)
    const spin = num(p, 'spin', 0.35)
    const arc = num(p, 'arc', 1.2)

    // spawn region by emitter type
    const samples = sampleDistribution(ctx, count)
    const nodes: Node[] = []
    const cx = ctx.w / 2
    const cy = ctx.h / 2

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]
      let x = s.x
      let y = s.y
      let vx = 0
      let vy = 0
      const phase = ctx.rng.range(0, Math.PI * 2)

      switch (type) {
        case 'fountain': {
          const a = -Math.PI / 2 + ctx.rng.normal(0, spread * 0.5)
          const sp = speed * ctx.rng.range(0.6, 1.4)
          vx = Math.cos(a) * sp
          vy = Math.sin(a) * sp
          break
        }
        case 'burst': {
          const a = ctx.rng.range(0, Math.PI * 2)
          const sp = speed * ctx.rng.range(0.25, 1.5)
          vx = Math.cos(a) * sp
          vy = Math.sin(a) * sp
          break
        }
        case 'embers': {
          const a = -Math.PI / 2 + ctx.rng.normal(0, spread * 0.35)
          const sp = speed * ctx.rng.range(0.3, 1.1)
          vx = Math.cos(a) * sp * 0.4
          vy = Math.sin(a) * sp
          break
        }
        case 'falling': {
          x = ctx.rng.next() * ctx.w
          y = ctx.rng.range(-ctx.h * 0.15, ctx.h * 0.6)
          vx = ctx.rng.normal(0, speed * 0.15)
          vy = speed * ctx.rng.range(0.5, 1.4)
          break
        }
        case 'spiral': {
          const r = Math.min(ctx.w, ctx.h) * ctx.rng.range(0.06, 0.42)
          const a = ctx.rng.range(0, Math.PI * 2)
          x = cx + Math.cos(a) * r
          y = cy + Math.sin(a) * r
          vx = -Math.sin(a) * speed * 0.5
          vy = Math.cos(a) * speed * 0.5
          break
        }
        case 'vortex': {
          const r = Math.min(ctx.w, ctx.h) * ctx.rng.range(0.1, 0.48)
          const a = ctx.rng.range(0, Math.PI * 2)
          x = cx + Math.cos(a) * r
          y = cy + Math.sin(a) * r
          vx = -Math.sin(a) * speed
          vy = Math.cos(a) * speed
          break
        }
        case 'path': {
          // start parameter along a lissajous track; motion handled below
          break
        }
      }

      const pts: number[] = []
      const sub = 2 // sub-steps per frame for smoother trails
      for (let f = 0; f < life; f++) {
        for (let k = 0; k < sub; k++) {
          if (type === 'path') {
            const t = (f / life) * Math.PI * 2 * arc + phase
            const rx = ctx.w * 0.34
            const ry = ctx.h * 0.3
            x = cx + Math.sin(t * 2 + phase) * rx
            y = cy + Math.sin(t * 3 + phase * 1.7) * ry
            break
          }
          // drag + gravity
          vx *= 1 - drag
          vy = vy * (1 - drag) + gravity * 0.25
          if (wobble > 0) {
            vx += Math.cos(f * 0.35 + phase) * wobble * 0.35
          }
          if ((type === 'spiral' || type === 'vortex') && spin !== 0) {
            const dx = x - cx
            const dy = y - cy
            const a = spin * 0.06
            const cos = Math.cos(a)
            const sin = Math.sin(a)
            x = cx + dx * cos - dy * sin
            y = cy + dx * sin + dy * cos
            if (type === 'vortex') {
              x += -dy * 0.008 * (speed / 8)
              y += dx * 0.008 * (speed / 8)
            }
          }
          x += vx / sub
          y += vy / sub
        }
        if (f % 2 === 0) pts.push(x, y)
        if (x < -ctx.w * 0.3 || x > ctx.w * 1.3 || y < -ctx.h * 0.3 || y > ctx.h * 1.3) break
      }
      if (pts.length < 4) continue

      const c = colorOf(ctx, s, size / 60)
      const a = alpha * (s.mask ?? 1)
      const w = size * ctx.rng.range(0.5, 1.6)

      nodes.push({
        g: { k: 'path', d: taperD(pts, (t) => w * (1 - trail * t) + w * 0.1, 22) },
        fill: solid(c),
        op: Math.min(1, a),
        blend: 'screen',
      })

      if (headGlow > 0.02) {
        const hx = pts[pts.length - 2]
        const hy = pts[pts.length - 1]
        const hr = Math.max(1, w * 1.6)
        nodes.push({
          g: { k: 'circle', x: hx, y: hy, r: hr },
          fill: {
            k: 'radial',
            cx: hx,
            cy: hy,
            r: hr,
            stops: [
              { t: 0, c: c, o: a * headGlow },
              { t: 0.35, c: c, o: a * headGlow * 0.5 },
              { t: 1, c: c, o: 0 },
            ],
          },
          op: 1,
          blend: 'plus-lighter',
        })
      }
    }
    return done(ctx.w, ctx.h, nodes)
  },
}
