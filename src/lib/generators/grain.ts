/**
 * Texture overlay — film grain, vignette, scanlines and dust.
 * The finishing layer that makes vector output feel photographic.
 */

import type { GeneratorDef } from '../schema'
import { circle, glowPaint, solid, type Node } from '../ir'
import { done, int, num, str } from './kit'

const MODES = [
  { value: 'grain', label: 'Film grain' },
  { value: 'vignette', label: 'Vignette' },
  { value: 'both', label: 'Grain + vignette' },
  { value: 'scanlines', label: 'Scanlines' },
  { value: 'dust', label: 'Dust & specks' },
]

export const grainGen: GeneratorDef = {
  id: 'grain',
  name: 'Noise & vignette',
  icon: 'scan-line',
  family: 'texture',
  tags: ['grain', 'noise', 'vignette', 'texture', 'film', 'overlay'],
  description: 'Grain, halation-free vignette, scanlines and dust specks.',
  params: [
    { key: 'mode', label: 'Texture', type: 'enum', options: MODES, default: 'grain', section: 'shape' },
    {
      key: 'density',
      label: 'Grain density',
      type: 'float',
      min: 0.1,
      max: 12,
      step: 0.1,
      default: 3.4,
      section: 'shape',
      hint: 'Thousands of specks per megapixel.',
      rand: { min: 1, max: 8 },
    },
    {
      key: 'grainSize',
      label: 'Grain size',
      type: 'float',
      min: 0.4,
      max: 8,
      step: 0.1,
      default: 1.3,
      section: 'shape',
      unit: 'px',
    },
    {
      key: 'amount',
      label: 'Grain opacity',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      section: 'style',
      rand: { min: 0.1, max: 0.7 },
    },
    {
      key: 'colorNoise',
      label: 'Colour grain',
      type: 'bool',
      default: false,
      section: 'style',
      hint: 'Chromatic specks instead of monochrome.',
    },
    {
      key: 'grainBlend',
      label: 'Grain blend',
      type: 'enum',
      options: [
        { value: 'normal', label: 'Normal' },
        { value: 'screen', label: 'Screen (lifts)' },
        { value: 'overlay', label: 'Overlay' },
        { value: 'multiply', label: 'Multiply (darkens)' },
      ],
      default: 'overlay',
      section: 'style',
    },
    {
      key: 'vignette',
      label: 'Vignette strength',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.55,
      section: 'style',
      rand: { min: 0.2, max: 0.85 },
    },
    {
      key: 'vignetteSoft',
      label: 'Vignette softness',
      type: 'float',
      min: 0.05,
      max: 1,
      step: 0.01,
      default: 0.55,
      section: 'style',
      hint: 'Where the falloff starts (0 = corners only).',
    },
    {
      key: 'vignetteColor',
      label: 'Vignette colour',
      type: 'color',
      default: '#000000',
      section: 'style',
    },
    {
      key: 'scanGap',
      label: 'Scanline gap',
      type: 'int',
      min: 2,
      max: 40,
      step: 1,
      default: 5,
      section: 'shape',
      when: { key: 'mode', equals: 'scanlines' },
    },
    {
      key: 'scanOpacity',
      label: 'Scanline opacity',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.3,
      section: 'style',
      when: { key: 'mode', equals: 'scanlines' },
    },
    {
      key: 'dustCount',
      label: 'Dust count',
      type: 'int',
      min: 5,
      max: 800,
      step: 1,
      default: 90,
      section: 'shape',
      when: { key: 'mode', equals: 'dust' },
    },
    {
      key: 'dustSize',
      label: 'Dust size',
      type: 'float',
      min: 0.5,
      max: 20,
      step: 0.5,
      default: 3,
      section: 'shape',
      when: { key: 'mode', equals: 'dust' },
      unit: 'px',
    },
  ],
  defaults: () => ({
    mode: 'grain',
    density: 3.4,
    grainSize: 1.3,
    amount: 0.35,
    colorNoise: false,
    grainBlend: 'overlay',
    vignette: 0.55,
    vignetteSoft: 0.55,
    vignetteColor: '#000000',
    scanGap: 5,
    scanOpacity: 0.3,
    dustCount: 90,
    dustSize: 3,
  }),
  density: (p) => num(p, 'density', 3.4) * 1200 + num(p, 'dustCount', 90),
  generate(p, ctx) {
    const mode = str(p, 'mode', 'grain')
    const nodes: Node[] = []
    const w = ctx.w
    const h = ctx.h
    const mp = (w * h) / 1e6
    const amount = num(p, 'amount', 0.35)
    const grainSize = num(p, 'grainSize', 1.3)
    const colorNoise = p.colorNoise === true
    const blend = str(p, 'grainBlend', 'overlay') as Node['blend']
    const vignette = num(p, 'vignette', 0.55)

    const wantsGrain = mode === 'grain' || mode === 'both'
    const wantsVignette = mode === 'vignette' || mode === 'both'

    if (wantsGrain) {
      const count = Math.min(60000, Math.round(num(p, 'density', 3.4) * 1000 * mp))
      for (let i = 0; i < count; i++) {
        const x = ctx.rng.next() * w
        const y = ctx.rng.next() * h
        const r = grainSize * ctx.rng.range(0.5, 1.35)
        const a = amount * ctx.rng.range(0.25, 1)
        let c: string
        if (colorNoise) {
          const base = ctx.rng.next() < 0.5 ? 255 : 0
          const jitter = ctx.rng.range(-40, 40)
          c = rgb(base + jitter, base + jitter, base + jitter)
        } else {
          const v = ctx.rng.next() < 0.5 ? 20 : 235
          c = rgb(v, v, v)
        }
        nodes.push({
          g: { k: 'circle', x, y, r },
          fill: solid(c),
          op: a,
          blend,
        })
      }
    }

    if (mode === 'scanlines') {
      const gap = Math.max(2, int(p, 'scanGap', 5))
      const op = num(p, 'scanOpacity', 0.3)
      for (let y = 0; y < h; y += gap) {
        nodes.push({
          g: { k: 'rect', x: 0, y, w, h: 1 },
          fill: solid('#000000'),
          op: op,
        })
      }
    }

    if (mode === 'dust') {
      const n = int(p, 'dustCount', 90)
      const size = num(p, 'dustSize', 3)
      for (let i = 0; i < n; i++) {
        const x = ctx.rng.next() * w
        const y = ctx.rng.next() * h
        const r = size * ctx.rng.range(0.3, 1.4)
        const bright = ctx.rng.next() < 0.75
        nodes.push(
          circle(
            x,
            y,
            r,
            glowPaint(x, y, r, bright ? '#ffffff' : '#000000', ctx.rng.range(0.25, 0.75)),
            { blend: bright ? 'plus-lighter' : 'normal' },
          ),
        )
      }
    }

    if (vignette > 0.01 && (wantsVignette || mode === 'scanlines' || mode === 'dust')) {
      const soft = num(p, 'vignetteSoft', 0.55)
      const col = str(p, 'vignetteColor', '#000000')
      const cx = w / 2
      const cy = h / 2
      const r = Math.hypot(cx, cy)
      const inner = Math.max(0, Math.min(0.95, soft)) * r
      nodes.push({
        g: { k: 'rect', x: 0, y: 0, w, h: h },
        fill: {
          k: 'radial',
          cx,
          cy,
          r,
          stops: [
            { t: 0, c: col, o: 0 },
            { t: inner / r, c: col, o: 0 },
            { t: Math.min(0.995, inner / r + (1 - inner / r) * 0.55), c: col, o: vignette * 0.45 },
            { t: 1, c: col, o: vignette },
          ],
        },
        op: 1,
      })
    }

    return done(w, h, nodes)
  },
}

function rgb(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}
