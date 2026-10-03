/**
 * filters/blur/feather.ts — Feather (soft edges).
 * Vector-safe: blur masked to the source alpha.
 */

import { clamp, fmt, gaussianBlur, num } from '../kit'
import type { FilterDef } from '../types'

export const featherDef: FilterDef = {
  type: 'feather',
  label: 'Feather',
  group: 'blur',
  description: 'Soften edges inward without spreading the shape.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 3,
  spread: (p) => 3 * num(p, 'amount', 3),
  params: [
    { key: 'amount', label: 'Feather', type: 'float', min: 0, max: 40, step: 0.1, default: 3, rand: { min: 0.5, max: 5 } },
  ],
  toSvg(params, ctx) {
    const a = clamp(num(params, 'amount', 3), 0, 100)
    if (a < 0.05) return null
    return (
      `<feGaussianBlur in="${ctx.input}" stdDeviation="${fmt(a)}" result="${ctx.output}-b"/>` +
      `<feComposite in="${ctx.output}-b" in2="${ctx.input}" operator="in" result="${ctx.output}"/>`
    )
  },
  apply(src, w, h, params) {
    const a = clamp(num(params, 'amount', 3), 0, 60)
    if (a < 0.05) return src.slice()
    const blurred = gaussianBlur(src, w, h, a)
    const out = new Uint8ClampedArray(src.length)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      const alpha = src[o + 3] / 255
      out[o] = blurred[o] * alpha + src[o] * (1 - alpha) * 0
      out[o + 1] = blurred[o + 1] * alpha
      out[o + 2] = blurred[o + 2] * alpha
      out[o + 3] = Math.min(src[o + 3], blurred[o + 3])
    }
    return out
  },
}
