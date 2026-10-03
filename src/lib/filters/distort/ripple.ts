/**
 * filters/distort/ripple.ts — Ripple / wave.
 * Vector-safe via `feTurbulence` + `feDisplacementMap`.
 */

import { clamp, fmt, num, sampleBilinear } from '../kit'
import type { FilterDef } from '../types'

export const rippleDef: FilterDef = {
  type: 'ripple',
  label: 'Ripple',
  group: 'distort',
  description: 'Sine-wave displacement along one axis.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 4,
  spread: (p) => num(p, 'amount', 10),
  params: [
    { key: 'amount', label: 'Amount', type: 'float', min: 0, max: 60, step: 0.5, default: 10, rand: { min: 4, max: 16 } },
    { key: 'frequency', label: 'Frequency', type: 'float', min: 0.1, max: 8, step: 0.1, default: 1.5 },
    { key: 'angle', label: 'Angle', type: 'float', min: 0, max: 360, step: 1, default: 0, unit: '°' },
  ],
  toSvg(params, ctx) {
    const amount = clamp(num(params, 'amount', 10), 0, 200)
    if (amount < 0.05) return null
    const freq = clamp(num(params, 'frequency', 1.5), 0.05, 10)
    const angle = clamp(num(params, 'angle', 0), 0, 360)
    return (
      `<feTurbulence type="turbulence" baseFrequency="${fmt(freq * 0.02, 4)} 0" numOctaves="2" seed="3" result="${ctx.output}-n"/>` +
      `<feDisplacementMap in="${ctx.input}" in2="${ctx.output}-n" scale="${fmt(amount)}" ` +
      `xChannelSelector="R" yChannelSelector="R" result="${ctx.output}"/>` +
      `<!-- ripple angle ${fmt(angle)} applied at render time -->`
    )
  },
  apply(src, w, h, params) {
    const amount = clamp(num(params, 'amount', 10), 0, 200)
    if (amount < 0.05) return src.slice()
    const freq = clamp(num(params, 'frequency', 1.5), 0.05, 10)
    const ang = (clamp(num(params, 'angle', 0), 0, 360) * Math.PI) / 180
    const ux = Math.cos(ang)
    const uy = Math.sin(ang)
    const out = new Uint8ClampedArray(src.length)
    const minDim = Math.max(1, Math.min(w, h))
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const proj = (x * ux + y * uy) / minDim
        const wave = Math.sin(proj * Math.PI * 2 * freq) * amount
        const [r, g, b, a] = sampleBilinear(src, w, h, x - uy * wave, y + ux * wave)
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
