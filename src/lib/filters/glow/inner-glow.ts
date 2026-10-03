/**
 * filters/glow/inner-glow.ts — Inner glow.
 * Vector-safe: blurred flood clipped inside the source.
 */

import { clamp, escAttr, fmt, gaussianBlur, num, parseHex, str } from '../kit'
import type { FilterDef } from '../types'

export const innerGlowDef: FilterDef = {
  type: 'inner-glow',
  label: 'Inner glow',
  group: 'glow',
  description: 'Soft coloured light inside the layer edges.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 5,
  params: [
    { key: 'blur', label: 'Blur', type: 'float', min: 0, max: 40, step: 0.1, default: 6, rand: { min: 2, max: 9 } },
    { key: 'color', label: 'Color', type: 'color', default: '#ffffff' },
    { key: 'opacity', label: 'Opacity', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, rand: { min: 0.25, max: 0.6 } },
  ],
  toSvg(params, ctx) {
    const op = clamp(num(params, 'opacity', 0.5), 0, 1)
    if (op <= 0.001) return null
    const blur = fmt(clamp(num(params, 'blur', 6), 0, 100))
    const color = escAttr(str(params, 'color', '#ffffff').slice(0, 7))
    return (
      `<feGaussianBlur in="${ctx.input}" stdDeviation="${blur}" result="${ctx.output}-b"/>` +
      `<feFlood flood-color="${color}" flood-opacity="${fmt(op)}" result="${ctx.output}-f"/>` +
      `<feComposite in="${ctx.output}-f" in2="${ctx.output}-b" operator="in" result="${ctx.output}-g"/>` +
      `<feComposite in="${ctx.output}-g" in2="${ctx.input}" operator="in" result="${ctx.output}-i"/>` +
      `<feComposite in="${ctx.input}" in2="${ctx.output}-i" operator="over" result="${ctx.output}"/>`
    )
  },
  apply(src, w, h, params) {
    const op = clamp(num(params, 'opacity', 0.5), 0, 1)
    if (op <= 0.001) return src.slice()
    const blur = clamp(num(params, 'blur', 6), 0, 60)
    const [cr, cg, cb] = parseHex(str(params, 'color', '#ffffff'))
    const inverted = new Uint8ClampedArray(w * h * 4)
    let maxA = 0
    for (let i = 0; i < w * h; i++) maxA = Math.max(maxA, src[i * 4 + 3])
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      inverted[o] = cr
      inverted[o + 1] = cg
      inverted[o + 2] = cb
      inverted[o + 3] = (maxA - src[o + 3]) * op
    }
    const blurred = blur > 0.05 ? gaussianBlur(inverted, w, h, blur) : inverted
    const out = new Uint8ClampedArray(src)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      const sa = src[o + 3] / 255
      if (sa <= 0.001) continue
      const ga = clamp(blurred[o + 3] / 255, 0, 1) * sa
      const t = clamp(ga, 0, 1) * 0.85
      out[o] = src[o] + (cr - src[o]) * t
      out[o + 1] = src[o + 1] + (cg - src[o + 1]) * t
      out[o + 2] = src[o + 2] + (cb - src[o + 2]) * t
    }
    return out
  },
}
