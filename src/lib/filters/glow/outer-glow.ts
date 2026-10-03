/**
 * filters/glow/outer-glow.ts — Outer glow.
 * Vector-safe: blurred flood clipped to outside the source.
 */

import { clamp, escAttr, fmt, gaussianBlur, num, parseHex, str } from '../kit'
import type { FilterDef } from '../types'

export const outerGlowDef: FilterDef = {
  type: 'outer-glow',
  label: 'Outer glow',
  group: 'glow',
  description: 'Soft coloured halo outside the layer content.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 5,
  spread: (p) => 3 * num(p, 'blur', 8),
  params: [
    { key: 'blur', label: 'Blur', type: 'float', min: 0, max: 40, step: 0.1, default: 8, rand: { min: 3, max: 12 } },
    { key: 'color', label: 'Color', type: 'color', default: '#ffffff' },
    { key: 'opacity', label: 'Opacity', type: 'float', min: 0, max: 1, step: 0.01, default: 0.6, rand: { min: 0.3, max: 0.7 } },
  ],
  toSvg(params, ctx) {
    const op = clamp(num(params, 'opacity', 0.6), 0, 1)
    if (op <= 0.001) return null
    const blur = fmt(clamp(num(params, 'blur', 8), 0, 100))
    const color = escAttr(str(params, 'color', '#ffffff').slice(0, 7))
    return (
      `<feGaussianBlur in="${ctx.input}" stdDeviation="${blur}" result="${ctx.output}-b"/>` +
      `<feFlood flood-color="${color}" flood-opacity="${fmt(op)}" result="${ctx.output}-f"/>` +
      `<feComposite in="${ctx.output}-f" in2="${ctx.output}-b" operator="in" result="${ctx.output}-g"/>` +
      `<feComposite in="${ctx.output}-g" in2="${ctx.input}" operator="out" result="${ctx.output}-o"/>` +
      `<feComposite in="${ctx.input}" in2="${ctx.output}-o" operator="over" result="${ctx.output}"/>`
    )
  },
  apply(src, w, h, params) {
    const op = clamp(num(params, 'opacity', 0.6), 0, 1)
    if (op <= 0.001) return src.slice()
    const blur = clamp(num(params, 'blur', 8), 0, 60)
    const [cr, cg, cb] = parseHex(str(params, 'color', '#ffffff'))
    let glow: Uint8ClampedArray = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      glow[o] = cr
      glow[o + 1] = cg
      glow[o + 2] = cb
      glow[o + 3] = src[o + 3] * op
    }
    if (blur > 0.05) glow = gaussianBlur(glow, w, h, blur)
    const out = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      const sa = src[o + 3] / 255
      // keep glow only outside the source
      const ga = (glow[o + 3] / 255) * (1 - sa)
      const a = sa + ga * (1 - sa)
      out[o + 3] = a * 255
      if (a > 0.001) {
        out[o] = (src[o] * sa + glow[o] * ga * (1 - sa)) / a
        out[o + 1] = (src[o + 1] * sa + glow[o + 1] * ga * (1 - sa)) / a
        out[o + 2] = (src[o + 2] * sa + glow[o + 2] * ga * (1 - sa)) / a
      }
    }
    return out
  },
}
