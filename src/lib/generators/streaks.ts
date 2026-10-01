/**
 * Streaks & light trails — bezier/spline bundles with tapered, fading strokes.
 */

import type { GeneratorDef } from '../schema'
import { sampleDistribution } from '../dist'
import { solid, splineD, taperD, type Node } from '../ir'
import { colorOf, countParam, done, emitCount, int, num } from './kit'

export const streaksGen: GeneratorDef = {
  id: 'streaks',
  name: 'Streaks & light trails',
  icon: 'wind',
  family: 'light',
  tags: ['trails', 'streaks', 'comet', 'motion', 'lines'],
  description: 'Tapered, fading strokes — shooting stars, light painting, speed lines.',
  params: [
    // exempt from MIN_EMIT: one trail is a legitimate streak
    countParam(48, 4000, 220, 1),
    {
      key: 'length',
      label: 'Length',
      type: 'float',
      min: 0.02,
      max: 1.6,
      step: 0.01,
      default: 0.55,
      section: 'shape',
      unit: '×',
      hint: 'As a fraction of the canvas diagonal.',
      rand: { min: 0.15, max: 1.1 },
    },
    {
      key: 'width',
      label: 'Width',
      type: 'float',
      min: 0.5,
      max: 90,
      step: 0.5,
      default: 7,
      section: 'style',
      unit: 'px',
      rand: { min: 1, max: 26 },
    },
    {
      key: 'taper',
      label: 'Taper',
      type: 'float',
      min: 0,
      max: 1.6,
      step: 0.01,
      default: 0.9,
      section: 'style',
      hint: 'How fast the stroke thins toward its tail.',
    },
    {
      key: 'curve',
      label: 'Curvature',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      section: 'shape',
      hint: '0 = straight beams, 1 = looping ribbons.',
      rand: { min: 0, max: 0.8 },
    },
    {
      key: 'angle',
      label: 'Direction',
      type: 'float',
      min: 0,
      max: 360,
      step: 1,
      default: 28,
      section: 'shape',
      unit: '°',
    },
    {
      key: 'spread',
      label: 'Direction spread',
      type: 'float',
      min: 0,
      max: 180,
      step: 1,
      default: 26,
      section: 'shape',
      unit: '°',
      hint: 'Random rotation around the base direction.',
    },
    {
      key: 'bundle',
      label: 'Bundle size',
      type: 'int',
      min: 1,
      max: 12,
      step: 1,
      default: 3,
      section: 'shape',
      hint: 'Parallel sub-strokes per streak — reads as a light bundle.',
      rand: { min: 1, max: 6 },
    },
    {
      key: 'fade',
      label: 'Head→tail fade',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.85,
      section: 'style',
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
      key: 'core',
      label: 'Bright core',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      section: 'style',
      hint: 'Additive centre line so the trail looks emissive.',
    },
    {
      key: 'segments',
      label: 'Path resolution',
      type: 'int',
      min: 6,
      max: 64,
      step: 1,
      default: 22,
      section: 'shape',
    },
  ],
  defaults: () => ({
    count: 48,
    length: 0.55,
    width: 7,
    taper: 0.9,
    curve: 0.35,
    angle: 28,
    spread: 26,
    bundle: 3,
    fade: 0.85,
    alpha: 0.8,
    core: 0.5,
    segments: 22,
  }),
  density: (p) => num(p, 'count', 48) * num(p, 'bundle', 3) * num(p, 'segments', 22) * 0.6,
  generate(p, ctx) {
    // a single streak is a valid (often intended) result — exempt from MIN_EMIT
    const count = emitCount(p, 48, 1)
    const samples = sampleDistribution(ctx, count)
    const nodes: Node[] = []
    const diag = Math.hypot(ctx.w, ctx.h)
    const baseLen = num(p, 'length', 0.55) * diag
    const width = num(p, 'width', 7)
    const taper = num(p, 'taper', 0.9)
    const curve = num(p, 'curve', 0.35)
    const angle0 = (num(p, 'angle', 28) * Math.PI) / 180
    const spread = (num(p, 'spread', 26) * Math.PI) / 180
    const bundle = Math.max(1, int(p, 'bundle', 3))
    const fade = num(p, 'fade', 0.85)
    const alpha = num(p, 'alpha', 0.8)
    const core = num(p, 'core', 0.5)
    const seg = Math.max(6, int(p, 'segments', 22))

    for (const s of samples) {
      const a = angle0 + ctx.rng.normal(0, spread)
      const len = baseLen * ctx.rng.range(0.55, 1.35)
      const c = colorOf(ctx, s, 0.5)
      const wScale = ctx.rng.range(0.6, 1.4)

      // control points along the base direction with lateral bow
      for (let b = 0; b < bundle; b++) {
        const off = (b - (bundle - 1) / 2) * width * 2.1
        const bow = ctx.rng.normal(0, curve * len * 0.35)
        const pts: number[] = []
        const ox = s.x - Math.cos(a) * len * 0.5 - Math.sin(a) * off
        const oy = s.y - Math.sin(a) * len * 0.5 + Math.cos(a) * off
        for (let i = 0; i <= seg; i++) {
          const t = i / seg
          const along = t * len
          const lateral = Math.sin(t * Math.PI) * bow + ctx.rng.normal(0, 0.6)
          const x = ox + Math.cos(a) * along - Math.sin(a) * lateral
          const y = oy + Math.sin(a) * along + Math.cos(a) * lateral
          pts.push(x, y)
        }

        const w = width * wScale * (1 - b * 0.12)
        const fadeStart = 1 - fade * (b === 0 ? 1 : 0.55)

        // tapered outline filled with a fading linear gradient along the stroke
        const d = taperD(pts, (t) => w * Math.pow(1 - t, taper) + w * 0.06, 20)
        const x1 = pts[0]
        const y1 = pts[1]
        const x2 = pts[pts.length - 2]
        const y2 = pts[pts.length - 1]
        nodes.push({
          g: { k: 'path', d },
          fill: {
            k: 'linear',
            x1,
            y1,
            x2,
            y2,
            stops: [
              { t: 0, c, o: alpha * fadeStart * (s.mask ?? 1) },
              { t: 0.45, c, o: alpha * fadeStart * 0.55 * (s.mask ?? 1) },
              { t: 1, c, o: Math.max(0.01, alpha * (1 - fade) * 0.35) },
            ],
          },
          op: 1,
          blend: b === 0 ? undefined : 'screen',
        })

        // spline-based bright core
        if (core > 0.02) {
          const coreW = Math.max(0.6, w * 0.28)
          nodes.push({
            g: { k: 'path', d: splineD(pts, false, 0.5) },
            stroke: solid(c),
            sw: coreW,
            cap: 'round',
            op: alpha * core,
            blend: 'plus-lighter',
            fade: { x1, y1, x2, y2, from: 1, to: 0.05 },
          })
        }
      }
    }
    return done(ctx.w, ctx.h, nodes)
  },
}
