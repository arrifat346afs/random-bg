/**
 * filters/distort/turbulence.ts — Turbulence displacement.
 * Vector-safe via `feTurbulence` + `feDisplacementMap`.
 */

import { clamp, fmt, num, sampleBilinear } from '../kit'
import { createNoise } from '../../noise'
import type { FilterDef } from '../types'

export const turbulenceDef: FilterDef = {
  type: 'turbulence',
  label: 'Turbulence',
  group: 'distort',
  description: 'Fractal-noise displacement (frequency, octaves, scale, seed).',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 7,
  spread: (p) => num(p, 'scale', 20),
  params: [
    { key: 'frequency', label: 'Frequency', type: 'float', min: 0.1, max: 10, step: 0.1, default: 2 },
    { key: 'octaves', label: 'Octaves', type: 'int', min: 1, max: 6, step: 1, default: 3 },
    { key: 'scale', label: 'Displacement', type: 'float', min: 0, max: 120, step: 1, default: 20, rand: { min: 8, max: 30 } },
    { key: 'seed', label: 'Seed', type: 'int', min: 0, max: 9999, step: 1, default: 11 },
  ],
  toSvg(params, ctx) {
    const scale = clamp(num(params, 'scale', 20), 0, 400)
    if (scale < 0.05) return null
    const freq = fmt(clamp(num(params, 'frequency', 2), 0.01, 20) * 0.02, 4)
    const oct = Math.max(1, Math.min(6, Math.round(num(params, 'octaves', 3))))
    const seed = Math.round(num(params, 'seed', 11))
    return (
      `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oct}" seed="${seed}" result="${ctx.output}-n"/>` +
      `<feDisplacementMap in="${ctx.input}" in2="${ctx.output}-n" scale="${fmt(scale)}" xChannelSelector="R" yChannelSelector="G" result="${ctx.output}"/>`
    )
  },
  apply(src, w, h, params, seed) {
    const scale = clamp(num(params, 'scale', 20), 0, 400)
    if (scale < 0.05) return src.slice()
    const freq = clamp(num(params, 'frequency', 2), 0.01, 20)
    const oct = Math.max(1, Math.min(6, Math.round(num(params, 'octaves', 3))))
    const s = Math.round(num(params, 'seed', 11)) + seed
    const n = createNoise(s)
    const out = new Uint8ClampedArray(src.length)
    const minDim = Math.max(1, Math.min(w, h))
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const fx = (x / minDim) * freq * 3
        const fy = (y / minDim) * freq * 3
        const dx = n.fbm(fx, fy, oct) * scale
        const dy = n.fbm(fx + 31.4, fy + 17.9, oct) * scale
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
