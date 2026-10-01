/**
 * Light rays, god rays, lens flares and anamorphic streaks.
 */

import type { GeneratorDef } from '../schema'
import { sampleDistribution } from '../dist'
import { circle, glowPaint, type Node, type Paint } from '../ir'
import { colorOf, done, emitCount, int, num, str } from './kit'

const MODES = [
  { value: 'godRays', label: 'God rays' },
  { value: 'flare', label: 'Lens flare' },
  { value: 'anamorphic', label: 'Anamorphic streak' },
  { value: 'starburst', label: 'Starburst' },
]

export const raysGen: GeneratorDef = {
  id: 'rays',
  name: 'Rays & flares',
  icon: 'sun',
  family: 'light',
  tags: ['god rays', 'flare', 'anamorphic', 'sunburst', 'light'],
  description: 'Shafts of light, camera flare ghosts and horizontal blue streaks.',
  params: [
    { key: 'mode', label: 'Type', type: 'enum', options: MODES, default: 'godRays', section: 'shape' },
    {
      key: 'count',
      label: 'Rays',
      type: 'int',
      min: 1,
      max: 160,
      step: 1,
      default: 26,
      section: 'shape',
      rand: { min: 8, max: 70 },
    },
    {
      key: 'origin',
      label: 'Origin',
      type: 'enum',
      options: [
        { value: 'distribution', label: 'From distribution' },
        { value: 'center', label: 'Canvas centre' },
        { value: 'corner', label: 'Corner' },
      ],
      default: 'distribution',
      section: 'shape',
    },
    {
      key: 'angle',
      label: 'Base angle',
      type: 'float',
      min: 0,
      max: 360,
      step: 1,
      default: 0,
      section: 'shape',
      unit: '°',
    },
    {
      key: 'spread',
      label: 'Angular spread',
      type: 'float',
      min: 0,
      max: 180,
      step: 1,
      default: 180,
      section: 'shape',
      unit: '°',
      hint: '180 = rays fan across a half turn.',
    },
    {
      key: 'length',
      label: 'Length',
      type: 'float',
      min: 0.05,
      max: 2,
      step: 0.01,
      default: 0.85,
      section: 'shape',
      unit: '×',
      hint: 'Fraction of canvas diagonal.',
    },
    {
      key: 'width',
      label: 'Width',
      type: 'float',
      min: 0.5,
      max: 120,
      step: 0.5,
      default: 16,
      section: 'style',
      unit: 'px',
      rand: { min: 2, max: 46 },
    },
    {
      key: 'taper',
      label: 'Taper to tip',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.75,
      section: 'style',
    },
    {
      key: 'intensity',
      label: 'Intensity',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
      section: 'style',
      rand: { min: 0.25, max: 1 },
    },
    {
      key: 'ghosts',
      label: 'Flare ghosts',
      type: 'int',
      min: 0,
      max: 10,
      step: 1,
      default: 5,
      section: 'shape',
      when: { key: 'mode', equals: 'flare' },
    },
    {
      key: 'coreSize',
      label: 'Core size',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.45,
      section: 'style',
      hint: 'Bright centre of the source.',
    },
    {
      key: 'jitter',
      label: 'Length jitter',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.55,
      section: 'shape',
    },
    {
      key: 'alpha',
      label: 'Opacity',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.75,
      section: 'style',
    },
  ],
  defaults: () => ({
    mode: 'godRays',
    count: 26,
    origin: 'distribution',
    angle: 0,
    spread: 180,
    length: 0.85,
    width: 16,
    taper: 0.75,
    intensity: 0.6,
    ghosts: 5,
    coreSize: 0.45,
    jitter: 0.55,
    alpha: 0.75,
  }),
  density: (p) => num(p, 'count', 26) * 4 + num(p, 'ghosts', 5) * 3,
  generate(p, ctx) {
    const mode = str(p, 'mode', 'godRays')
    // flares / hero rays: one ray is the point — exempt from MIN_EMIT
    const count = emitCount(p, 26, 1)
    const angle0 = (num(p, 'angle', 0) * Math.PI) / 180
    const spread = (num(p, 'spread', 180) * Math.PI) / 180
    const length = num(p, 'length', 0.85) * Math.hypot(ctx.w, ctx.h)
    const width = num(p, 'width', 16)
    const taper = num(p, 'taper', 0.75)
    const intensity = num(p, 'intensity', 0.6)
    const alpha = num(p, 'alpha', 0.75)
    const jitter = num(p, 'jitter', 0.55)
    const coreSize = num(p, 'coreSize', 0.45)
    const origin = str(p, 'origin', 'distribution')
    const nodes: Node[] = []

    // source position
    const samples = sampleDistribution(ctx, Math.max(1, origin === 'distribution' ? count : 1))
    const originOf = (i: number) => {
      if (origin === 'center') return { x: ctx.w / 2, y: ctx.h / 2 }
      if (origin === 'corner') return { x: ctx.w * 0.06, y: ctx.h * 0.08 }
      const s = samples[Math.min(samples.length - 1, i)]
      return { x: s.x, y: s.y, c: s }
    }

    if (mode === 'anamorphic') {
      const { x, y } = originOf(0)
      const c = colorOf(ctx, { x, y, z: 0.5, t: 0.5, edge: 0, mask: 1 }, 0.5)
      const w = ctx.w * 0.92
      const h = Math.max(2, width * 2.2)
      // horizontal bar with a soft vertical + horizontal falloff
      nodes.push({
        g: { k: 'rect', x: x - w / 2, y: y - h / 2, w, h },
        fill: {
          k: 'radial',
          cx: x,
          cy: y,
          r: w / 2,
          stops: [
            { t: 0, c, o: alpha },
            { t: 0.12, c, o: alpha * 0.7 },
            { t: 0.45, c, o: alpha * 0.22 },
            { t: 1, c, o: 0 },
          ],
        },
        blend: 'plus-lighter',
        op: 1,
      })
      nodes.push(
        circle(
          x,
          y,
          Math.max(4, width * 3),
          glowPaint(x, y, Math.max(4, width * 3), c, alpha * intensity),
          { blend: 'plus-lighter', op: 1 },
        ),
      )
      // thin vertical ghost
      nodes.push({
        g: { k: 'rect', x: x - Math.max(2, width * 0.35), y: y - ctx.h * 0.4, w: Math.max(4, width * 0.7), h: ctx.h * 0.8 },
        fill: {
          k: 'radial',
          cx: x,
          cy: y,
          r: ctx.h * 0.45,
          stops: [
            { t: 0, c, o: alpha * 0.6 },
            { t: 0.6, c, o: alpha * 0.12 },
            { t: 1, c, o: 0 },
          ],
        },
        blend: 'plus-lighter',
        op: 1,
      })
      return done(ctx.w, ctx.h, nodes)
    }

    if (mode === 'flare') {
      const o = originOf(0)
      const sx = o.x
      const sy = o.y
      const c = colorOf(ctx, { x: sx, y: sy, z: 0.5, t: 0.5, edge: 0, mask: 1 }, 0.5)
      // source
      const coreR = Math.max(6, Math.min(ctx.w, ctx.h) * 0.09 * coreSize * 2)
      nodes.push(
        circle(sx, sy, coreR * 3.2, glowPaint(sx, sy, coreR * 3.2, c, alpha * 0.75), {
          blend: 'plus-lighter',
          op: 1,
        }),
      )
      nodes.push(
        circle(sx, sy, coreR, glowPaint(sx, sy, coreR, '#ffffff', alpha * intensity), {
          blend: 'plus-lighter',
          op: 1,
        }),
      )
      // starburst spokes
      const spokes = Math.max(4, count)
      for (let i = 0; i < spokes; i++) {
        const a = angle0 + (i / spokes) * Math.PI * 2
        const len = length * 0.5 * ctx.rng.range(1 - jitter * 0.5, 1 + jitter * 0.5)
        pushBeam(nodes, sx, sy, a, len, width * 0.5, taper, c, alpha * intensity * 0.75, 16)
      }
      // horizontal anamorphic bar
      nodes.push({
        g: { k: 'rect', x: sx - ctx.w * 0.4, y: sy - width * 0.5, w: ctx.w * 0.8, h: width },
        fill: {
          k: 'linear',
          x1: sx - ctx.w * 0.4,
          y1: sy,
          x2: sx + ctx.w * 0.4,
          y2: sy,
          stops: [
            { t: 0, c, o: 0 },
            { t: 0.5, c, o: alpha * intensity * 0.75 },
            { t: 1, c, o: 0 },
          ],
        },
        blend: 'plus-lighter',
        op: 1,
      })
      // ghosts along the line through the canvas centre
      const cx = ctx.w / 2
      const cy = ctx.h / 2
      const ghosts = int(p, 'ghosts', 5)
      for (let i = 1; i <= ghosts; i++) {
        const t = (i / (ghosts + 1)) * 1.8 - 0.4
        const gx = sx + (cx - sx) * 2 * t
        const gy = sy + (cy - sy) * 2 * t
        const rr = Math.max(3, coreR * (0.2 + ctx.rng.range(0, 0.75)))
        const gc = i % 3 === 0 ? '#8ef0ff' : i % 3 === 1 ? c : '#ffd9a0'
        const ring = i % 2 === 0
        nodes.push(
          ring
            ? {
                g: { k: 'circle', x: gx, y: gy, r: rr },
                fill: ringPaint(gx, gy, rr, gc, alpha * 0.35),
                op: 1,
                blend: 'screen',
              }
            : circle(gx, gy, rr, glowPaint(gx, gy, rr, gc, alpha * 0.3), {
                blend: 'screen',
                op: 1,
              }),
        )
      }
      return done(ctx.w, ctx.h, nodes)
    }

    // godRays / starburst
    const n = mode === 'starburst' ? Math.max(4, count) : count
    for (let i = 0; i < n; i++) {
      const o = originOf(i)
      const a =
        mode === 'starburst'
          ? angle0 + (i / n) * Math.PI * 2
          : angle0 + ((i + 0.5) / n - 0.5) * spread + ctx.rng.normal(0, spread * 0.04)
      const len = length * ctx.rng.range(1 - jitter * 0.7, 1 + jitter * 0.7)
      const c = colorOf(
        ctx,
        o.c ?? { x: o.x, y: o.y, z: 0.5, t: i / n, edge: 0, mask: 1 },
        i / n,
      )
      pushBeam(nodes, o.x, o.y, a, len, width * ctx.rng.range(0.6, 1.4), taper, c, alpha * intensity, 18)
    }

    // source core for god rays
    if (origin !== 'distribution' || coreSize > 0) {
      const o = originOf(0)
      const c = colorOf(ctx, { x: o.x, y: o.y, z: 0.5, t: 0.5, edge: 0, mask: 1 }, 0.5)
      const r = Math.max(4, Math.min(ctx.w, ctx.h) * 0.12 * coreSize)
      nodes.push(
        circle(o.x, o.y, r, glowPaint(o.x, o.y, r, c, alpha * 0.9), {
          blend: 'plus-lighter',
          op: 1,
        }),
      )
      if (coreSize > 0.15) {
        nodes.push(
          circle(o.x, o.y, r * 0.4, glowPaint(o.x, o.y, r * 0.4, '#ffffff', alpha * 0.8), {
            blend: 'plus-lighter',
            op: 1,
          }),
        )
      }
    }

    return done(ctx.w, ctx.h, nodes)
  },
}

/** Wedge-shaped beam with a fading gradient from origin to tip. */
function pushBeam(
  nodes: Node[],
  x: number,
  y: number,
  a: number,
  len: number,
  width: number,
  taper: number,
  c: string,
  alpha: number,
  samples = 16,
): void {
  const dx = Math.cos(a)
  const dy = Math.sin(a)
  const nx = -dy
  const ny = dx
  const left: number[] = []
  const right: number[] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const hw = (width / 2) * Math.pow(1 - t, taper)
    const px = x + dx * len * t
    const py = y + dy * len * t
    left.push(px + nx * hw, py + ny * hw)
    right.push(px - nx * hw, py - ny * hw)
  }
  right.reverse()
  const pts = [...left, ...right]
  let d = `M${pts[0].toFixed(2)} ${pts[1].toFixed(2)}`
  for (let i = 2; i < pts.length; i += 2) d += `L${pts[i].toFixed(2)} ${pts[i + 1].toFixed(2)}`
  const tipX = x + dx * len
  const tipY = y + dy * len
  const fill: Paint = {
    k: 'linear',
    x1: x,
    y1: y,
    x2: tipX,
    y2: tipY,
    stops: [
      { t: 0, c, o: alpha },
      { t: 0.35, c, o: alpha * 0.5 },
      { t: 1, c, o: alpha * 0.04 },
    ],
  }
  nodes.push({
    g: { k: 'path', d: d + 'Z' },
    fill,
    op: 1,
    blend: 'plus-lighter',
  })
}

function ringPaint(x: number, y: number, r: number, c: string, a: number): Paint {
  return {
    k: 'radial',
    cx: x,
    cy: y,
    r,
    stops: [
      { t: 0, c, o: 0 },
      { t: 0.6, c, o: 0 },
      { t: 0.85, c, o: a },
      { t: 1, c, o: 0 },
    ],
  }
}
