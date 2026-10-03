/**
 * filters/distort/roughen.ts — Roughen edges.
 * Vector-safe via `feTurbulence` + `feDisplacementMap`.
 * Note: Illustrator has no `feTurbulence` — raster fallback there.
 */

import { clamp, fmt, num, sampleBilinear } from '../kit'
import { createNoise } from '../../noise'
import type { FilterDef } from '../types'

export const roughenDef: FilterDef = {
  type: 'roughen',
  label: 'Roughen',
  group: 'distort',
  description: 'Wobble edges with fractal noise displacement.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 6,
  spread: (p) => num(p, 'amount', 8),
  params: [
    { key: 'amount', label: 'Amount', type: 'float', min: 0, max: 60, step: 0.5, default: 8, rand: { min: 3, max: 14 } },
    { key: 'scale', label: 'Scale', type: 'float', min: 0.2, max: 12, step: 0.1, default: 3 },
    { key: 'seed', label: 'Seed', type: 'int', min: 0, max: 9999, step: 1, default: 7 },
  ],
  toSvg(params, ctx) {
    const amount = clamp(num(params, 'amount', 8), 0, 200)
    if (amount < 0.05) return null
    const scale = clamp(num(params, 'scale', 3), 0.1, 20)
    const seed = Math.round(num(params, 'seed', 7))
    const freq = fmt(0.02 * scale, 4)
    return (
      `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="${seed}" result="${ctx.output}-n"/>` +
      `<feDisplacementMap in="${ctx.input}" in2="${ctx.output}-n" scale="${fmt(amount)}" xChannelSelector="R" yChannelSelector="G" result="${ctx.output}"/>`
    )
  },
  apply(src, w, h, params, seed) {
    const amount = clamp(num(params, 'amount', 8), 0, 200)
    if (amount < 0.05) return src.slice()
    const scale = clamp(num(params, 'scale', 3), 0.1, 20)
    const s = Math.round(num(params, 'seed', 7)) + seed
    const n = createNoise(s)
    const out = new Uint8ClampedArray(src.length)
    const minDim = Math.max(1, Math.min(w, h))
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const fx = (x / minDim) * scale
        const fy = (y / minDim) * scale
        const dx = n.fbm(fx, fy, 3) * amount
        const dy = n.fbm(fx + 13.7, fy + 7.3, 3) * amount
        const [r, g, b, a] = sampleBilinear(src, w, h, x + dx, y + dy)
        const o = (y * w + x) * 4
        out[o] = r
        out[o + 1] = g
        out[o + 2] = b
        out[o + 3] = a
      }
    }
    return out
  },
}
