/**
 * Flow-field particles — curl-noise / Perlin driven paths.
 * Produces silk-like ribbons, marble veins and wind maps.
 */

import type { GeneratorDef } from '../schema'
import { sampleDistribution } from '../dist'
import { createNoise, curl } from '../noise'
import { solid, taperD, type Node } from '../ir'
import { colorOf, countParam, done, emitCount, int, num } from './kit'

export const flowGen: GeneratorDef = {
  id: 'flow',
  name: 'Flow field',
  icon: 'waves',
  family: 'particles',
  tags: ['curl noise', 'silk', 'marble', 'wind', 'streamlines'],
  description: 'Particles advected through a divergence-free noise field.',
  params: [
    countParam(320, 8000, 700),
    {
      key: 'steps',
      label: 'Path steps',
      type: 'int',
      min: 4,
      max: 240,
      step: 1,
      default: 64,
      section: 'shape',
      hint: 'Integration steps per particle — longer = silkier.',
      rand: { min: 24, max: 140 },
    },
    {
      key: 'stepSize',
      label: 'Step size',
      type: 'float',
      min: 0.5,
      max: 24,
      step: 0.5,
      default: 5,
      section: 'shape',
      unit: 'px',
    },
    {
      key: 'fieldScale',
      label: 'Field scale',
      type: 'float',
      min: 0.2,
      max: 12,
      step: 0.1,
      default: 2.4,
      section: 'shape',
      hint: 'Small = big slow swirls, large = busy turbulence.',
      rand: { min: 0.8, max: 6 },
    },
    {
      key: 'curlStrength',
      label: 'Field strength',
      type: 'float',
      min: 0.1,
      max: 4,
      step: 0.05,
      default: 1,
      section: 'shape',
    },
    {
      key: 'width',
      label: 'Ribbon width',
      type: 'float',
      min: 0.5,
      max: 60,
      step: 0.5,
      default: 4,
      section: 'style',
      unit: 'px',
      rand: { min: 1, max: 18 },
    },
    {
      key: 'taper',
      label: 'Taper',
      type: 'float',
      min: 0,
      max: 1.5,
      step: 0.01,
      default: 0.7,
      section: 'style',
      hint: 'Thin out toward the tail of each path.',
    },
    {
      key: 'alpha',
      label: 'Opacity',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
      section: 'style',
      rand: { min: 0.25, max: 0.95 },
    },
    {
      key: 'wander',
      label: 'Start wander',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      section: 'shape',
      hint: 'Randomise spawn points slightly so the grid disappears.',
    },
    {
      key: 'headDot',
      label: 'Head glow',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.3,
      section: 'style',
      hint: 'Bright point at the leading end of each path.',
    },
    {
      key: 'colorFlow',
      label: 'Colour drift along path',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      section: 'style',
      hint: 'Fade the stroke toward a second colour over its length.',
    },
  ],
  defaults: () => ({
    count: 320,
    steps: 64,
    stepSize: 5,
    fieldScale: 2.4,
    curlStrength: 1,
    width: 4,
    taper: 0.7,
    alpha: 0.6,
    wander: 0.35,
    headDot: 0.3,
    colorFlow: 0.5,
  }),
  density: (p) => num(p, 'count', 320) * 1.4,
  generate(p, ctx) {
    const count = emitCount(p, 320)
    const samples = sampleDistribution(ctx, count)
    const steps = Math.max(4, int(p, 'steps', 64))
    const step = num(p, 'stepSize', 5)
    const scale = num(p, 'fieldScale', 2.4)
    const strength = num(p, 'curlStrength', 1)
    const width = num(p, 'width', 4)
    const taper = num(p, 'taper', 0.7)
    const alpha = num(p, 'alpha', 0.6)
    const wander = num(p, 'wander', 0.35)
    const headDot = num(p, 'headDot', 0.3)
    const colorFlow = num(p, 'colorFlow', 0.5)

    const noise = createNoise(hashOf(ctx.seed))
    const nodes: Node[] = []
    const inv = scale / Math.max(1, Math.min(ctx.w, ctx.h))

    for (const s of samples) {
      let x = s.x + ctx.rng.normal(0, wander * ctx.minDim * 0.06)
      let y = s.y + ctx.rng.normal(0, wander * ctx.minDim * 0.06)
      const pts: number[] = [x, y]
      const speed = step * ctx.rng.range(0.7, 1.3)
      for (let i = 0; i < steps; i++) {
        const v = curl(noise, x * inv, y * inv, 0.6, 1)
        // slight forward bias keeps motion directional rather than cancelling
        const len = Math.hypot(v.x, v.y) || 1
        x += (v.x / len) * speed + strength * 0.15 * speed
        y += (v.y / len) * speed
        if (x < -ctx.w * 0.2 || x > ctx.w * 1.2 || y < -ctx.h * 0.2 || y > ctx.h * 1.2) break
        pts.push(x, y)
      }
      if (pts.length < 6) continue

      const c1 = colorOf(ctx, s, 0.3)
      const a = alpha * (s.mask ?? 1)
      const w = width * ctx.rng.range(0.6, 1.5)
      const d = taperD(pts, (t) => w * Math.pow(1 - t, taper) + w * 0.08, Math.min(48, steps))

      const x1 = pts[0]
      const y1 = pts[1]
      const x2 = pts[pts.length - 2]
      const y2 = pts[pts.length - 1]

      if (colorFlow > 0.02) {
        // second colour sampled from the palette by the far end of the path
        const c2 = colorOf(ctx, { ...s, x: x2, y: y2, t: (s.t + 0.5) % 1 }, 0.8)
        nodes.push({
          g: { k: 'path', d },
          fill: {
            k: 'linear',
            x1,
            y1,
            x2,
            y2,
            stops: [
              { t: 0, c: c1, o: a },
              { t: 0.55, c: mix(c1, c2, colorFlow * 0.6), o: a * 0.72 },
              { t: 1, c: c2, o: Math.max(0.02, a * (1 - colorFlow)) },
            ],
          },
          op: 1,
        })
      } else {
        nodes.push({
          g: { k: 'path', d },
          fill: solid(c1),
          op: a,
        })
      }

      if (headDot > 0.02) {
        const hr = Math.max(1, w * 0.9)
        nodes.push({
          g: { k: 'circle', x: pts[0], y: pts[1], r: hr },
          fill: {
            k: 'radial',
            cx: pts[0],
            cy: pts[1],
            r: hr,
            stops: [
              { t: 0, c: c1, o: a * headDot },
              { t: 0.4, c: c1, o: a * headDot * 0.5 },
              { t: 1, c: c1, o: 0 },
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

function hashOf(seed: number): number {
  return (seed >>> 0) / 4294967296
}

function mix(a: string, b: string, t: number): string {
  // cheap hex mix — palette colours are always hex here
  const pa = hex(a)
  const pb = hex(b)
  if (!pa || !pb) return a
  const k = Math.max(0, Math.min(1, t))
  const c = (i: number) => Math.round(pa[i] + (pb[i] - pa[i]) * k)
  return `#${[c(0), c(1), c(2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function hex(h: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
