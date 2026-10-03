/**
 * filters/blur/gaussian.ts — Gaussian blur (x/y sigma).
 * Vector-safe via `feGaussianBlur`.
 */

import { clamp, fmt, gaussianBlur, num } from '../kit'
import type { FilterDef } from '../types'

export const gaussianBlurDef: FilterDef = {
  type: 'gaussian-blur',
  label: 'Gaussian blur',
  group: 'blur',
  description: 'Soft gaussian blur with independent x/y sigma.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 4,
  spread: (p) => 3 * Math.max(num(p, 'sigmaX', 4), num(p, 'sigmaY', 4)),
  params: [
    { key: 'sigmaX', label: 'Blur X', type: 'float', min: 0, max: 40, step: 0.1, default: 4, rand: { min: 0.5, max: 6 } },
    { key: 'sigmaY', label: 'Blur Y', type: 'float', min: 0, max: 40, step: 0.1, default: 4, rand: { min: 0.5, max: 6 } },
  ],
  toSvg(params, ctx) {
    const sx = clamp(num(params, 'sigmaX', 4), 0, 100)
    const sy = clamp(num(params, 'sigmaY', 4), 0, 100)
    if (sx < 0.05 && sy < 0.05) return null
    const dev = sx === sy ? fmt(sx) : `${fmt(sx)} ${fmt(sy)}`
    return `<feGaussianBlur in="${ctx.input}" stdDeviation="${dev}" result="${ctx.output}"/>`
  },
  apply(src, w, h, params) {
    const sx = clamp(num(params, 'sigmaX', 4), 0, 60)
    const sy = clamp(num(params, 'sigmaY', 4), 0, 60)
    if (sx < 0.05 && sy < 0.05) return src.slice()
    const sigma = (sx + sy) / 2
    return gaussianBlur(src, w, h, sigma)
  },
}
