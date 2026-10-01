/**
 * Smoke / haze / nebula — layered soft radial blobs warped by fractal noise.
 * Stacking many low-alpha blobs with a bit of domain warping gives real
 * volumetric depth without any raster textures.
 */

import type { GeneratorDef } from '../schema'
import { sampleDistribution } from '../dist'
import { createNoise } from '../noise'
import { circle, glowPaint, type Node } from '../ir'
import { colorOf, countParam, done, emitCount, int, num, str } from './kit'
import { hexToHsl, hslToHex } from '../palette'

const BLENDS = [
  { value: 'screen', label: 'Screen (glowing)' },
  { value: 'normal', label: 'Normal (soft)' },
  { value: 'multiply', label: 'Multiply (shadow)' },
  { value: 'lighten', label: 'Lighten' },
]

export const smokeGen: GeneratorDef = {
  id: 'smoke',
  name: 'Smoke & haze',
  icon: 'cloud',
  family: 'atmosphere',
  tags: ['smoke', 'haze', 'fog', 'nebula', 'cloud', 'atmosphere'],
  description: 'Volumetric puffs built from noise-warped radial gradients.',
  params: [
    countParam(90, 3000, 260),
    {
      key: 'radius',
      label: 'Puff radius',
      type: 'float',
      min: 4,
      max: 400,
      step: 1,
      default: 74,
      section: 'shape',
      unit: 'px',
      rand: { min: 20, max: 200 },
    },
    {
      key: 'sub',
      label: 'Detail blobs',
      type: 'int',
      min: 1,
      max: 10,
      step: 1,
      default: 4,
      section: 'shape',
      hint: 'Sub-blobs per puff — more = crisper internal structure.',
      rand: { min: 1, max: 8 },
    },
    {
      key: 'warp',
      label: 'Noise warp',
      type: 'float',
      min: 0,
      max: 2,
      step: 0.01,
      default: 0.85,
      section: 'shape',
      hint: 'Scatter sub-blobs along a noise field instead of randomly.',
      rand: { min: 0.2, max: 1.6 },
    },
    {
      key: 'noiseScale',
      label: 'Noise scale',
      type: 'float',
      min: 0.2,
      max: 10,
      step: 0.1,
      default: 2.6,
      section: 'shape',
    },
    {
      key: 'alpha',
      label: 'Blob opacity',
      type: 'float',
      min: 0.01,
      max: 1,
      step: 0.01,
      default: 0.16,
      section: 'style',
      hint: 'Keep low — the volume comes from accumulation.',
      rand: { min: 0.05, max: 0.4 },
    },
    {
      key: 'blend',
      label: 'Blend',
      type: 'enum',
      options: BLENDS,
      default: 'screen',
      section: 'style',
    },
    {
      key: 'elongation',
      label: 'Stretch',
      type: 'float',
      min: 0.3,
      max: 3,
      step: 0.05,
      default: 1.15,
      section: 'shape',
      hint: 'Aspect ratio of each puff.',
    },
    {
      key: 'hueSpread',
      label: 'Hue spread',
      type: 'float',
      min: 0,
      max: 90,
      step: 1,
      default: 18,
      section: 'style',
      unit: '°',
      hint: 'Colour variation across puffs — nebula feel.',
    },
    {
      key: 'coreBoost',
      label: 'Core boost',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      section: 'style',
      hint: 'Brighter centre on a fraction of blobs so it reads as lit.',
    },
    {
      key: 'depthMix',
      label: 'Depth fade',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      section: 'depth',
    },
    {
      key: 'softness',
      label: 'Softness',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.8,
      section: 'style',
      hint: 'Edge falloff of each blob.',
    },
  ],
  defaults: () => ({
    count: 90,
    radius: 74,
    sub: 4,
    warp: 0.85,
    noiseScale: 2.6,
    alpha: 0.16,
    blend: 'screen',
    elongation: 1.15,
    hueSpread: 18,
    coreBoost: 0.35,
    depthMix: 0.5,
    softness: 0.8,
  }),
  density: (p) => num(p, 'count', 90) * num(p, 'sub', 4) * 1.1,
  generate(p, ctx) {
    const count = emitCount(p, 90)
    const samples = sampleDistribution(ctx, count)
    const radius = num(p, 'radius', 74)
    const sub = Math.max(1, int(p, 'sub', 4))
    const warp = num(p, 'warp', 0.85)
    const nScale = num(p, 'noiseScale', 2.6)
    const alpha = num(p, 'alpha', 0.16)
    const blend = str(p, 'blend', 'screen') as 'screen' | 'normal' | 'multiply' | 'lighten'
    const elong = num(p, 'elongation', 1.15)
    const hueSpread = num(p, 'hueSpread', 18)
    const coreBoost = num(p, 'coreBoost', 0.35)
    const depthMix = num(p, 'depthMix', 0.5)
    const soft = num(p, 'softness', 0.8)

    const noise = createNoise((ctx.seed ^ 0x5eed) >>> 0)
    const nodes: Node[] = []
    const inv = nScale / Math.max(1, ctx.minDim)

    for (const s of samples) {
      let c = colorOf(ctx, s, 0.5)
      if (hueSpread > 0) {
        const [h, sat, l] = hexToHsl(c)
        c = hslToHex(h + ctx.rng.normal(0, hueSpread * 0.5), sat, l)
      }
      const baseR = radius * ctx.rng.range(0.55, 1.45) * (1 - s.z * depthMix * 0.5)
      const baseA = alpha * (1 - s.z * depthMix) * (s.mask ?? 1)
      const stretchA = ctx.rng.range(0, Math.PI)

      for (let i = 0; i < sub; i++) {
        // noise-warped sub-blob offset → wispy internal structure
        const u = i / sub
        const nx = noise.fbm(s.x * inv + u * 3.1, s.y * inv, 3)
        const ny = noise.fbm(s.x * inv + 11.7, s.y * inv + u * 3.1, 3)
        const ox = nx * warp * baseR * 0.9 + ctx.rng.normal(0, baseR * 0.25)
        const oy = ny * warp * baseR * 0.9 + ctx.rng.normal(0, baseR * 0.25)
        const x = s.x + ox
        const y = s.y + oy
        const r = baseR * ctx.rng.range(0.4, 1) * (1 - u * 0.35)
        const a = Math.min(0.95, baseA * ctx.rng.range(0.6, 1.25))
        if (a <= 0.004 || r < 1) continue

        const isCore = coreBoost > 0 && i === 0 && ctx.rng.next() < coreBoost
        const col = isCore ? lighten(c, 0.35) : c

        // `softness` sets how much of the radius holds full alpha
        const coreFrac = Math.max(0, (1 - soft) * 0.55)
        const paint = glowPaint(x, y, r, col, a, coreFrac)
        if (Math.abs(elong - 1) > 0.02) {
          // stretch by using an ellipse-cropped gradient approximation:
          // draw a scaled ellipse with the same gradient
          nodes.push({
            g: { k: 'ellipse', x, y, rx: r * elong, ry: r, rot: stretchA },
            fill: paint,
            op: 1,
            blend,
          })
        } else {
          nodes.push(circle(x, y, r, paint, { blend, op: 1 }))
        }
      }
    }
    return done(ctx.w, ctx.h, nodes)
  },
}

function lighten(c: string, t: number): string {
  if (!c.startsWith('#')) return c
  const [h, s, l] = hexToHsl(c)
  return hslToHex(h, s, Math.min(96, l + t * 60))
}
