/**
 * filters/glow/drop-shadow.ts — Drop shadow (offset, blur, color, opacity).
 * Vector-safe via `feDropShadow`.
 */

import { clamp, escAttr, fmt, gaussianBlur, num, parseHex, str } from '../kit'
import type { FilterDef } from '../types'

export const dropShadowDef: FilterDef = {
  type: 'drop-shadow',
  label: 'Drop shadow',
  group: 'glow',
  description: 'Offset blurred shadow behind the layer content.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 5,
  spread: (p) => 3 * num(p, 'blur', 6) + Math.hypot(num(p, 'dx', 4), num(p, 'dy', 6)),
  params: [
    { key: 'dx', label: 'Offset X', type: 'float', min: -60, max: 60, step: 0.5, default: 4, rand: { min: 2, max: 10 } },
    { key: 'dy', label: 'Offset Y', type: 'float', min: -60, max: 60, step: 0.5, default: 6, rand: { min: 2, max: 12 } },
    { key: 'blur', label: 'Blur', type: 'float', min: 0, max: 40, step: 0.1, default: 6, rand: { min: 2, max: 10 } },
    { key: 'color', label: 'Color', type: 'color', default: '#000000' },
    { key: 'opacity', label: 'Opacity', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, rand: { min: 0.25, max: 0.6 } },
  ],
  toSvg(params, ctx) {
    const op = clamp(num(params, 'opacity', 0.5), 0, 1)
    if (op <= 0.001) return null
    const dx = fmt(clamp(num(params, 'dx', 4), -200, 200))
    const dy = fmt(clamp(num(params, 'dy', 6), -200, 200))
    const blur = fmt(clamp(num(params, 'blur', 6), 0, 100))
    const color = escAttr(str(params, 'color', '#000000').slice(0, 7))
    return (
      `<feDropShadow in="${ctx.input}" dx="${dx}" dy="${dy}" stdDeviation="${blur}" ` +
      `flood-color="${color}" flood-opacity="${fmt(op)}" result="${ctx.output}-s"/>` +
      `<feComposite in="${ctx.input}" in2="${ctx.output}-s" operator="over" result="${ctx.output}"/>`
    )
  },
  apply(src, w, h, params) {
    const op = clamp(num(params, 'opacity', 0.5), 0, 1)
    if (op <= 0.001) return src.slice()
    const dx = Math.round(clamp(num(params, 'dx', 4), -200, 200))
    const dy = Math.round(clamp(num(params, 'dy', 6), -200, 200))
    const blur = clamp(num(params, 'blur', 6), 0, 60)
    const [cr, cg, cb] = parseHex(str(params, 'color', '#000000'))
    let shadow: Uint8ClampedArray = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      shadow[o] = cr
      shadow[o + 1] = cg
      shadow[o + 2] = cb
      shadow[o + 3] = src[o + 3] * op
    }
    if (blur > 0.05) shadow = gaussianBlur(shadow, w, h, blur)
    const moved = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = x - dx
        const sy = y - dy
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue
        const s = (sy * w + sx) * 4
        const d = (y * w + x) * 4
        moved[d] = shadow[s]
        moved[d + 1] = shadow[s + 1]
        moved[d + 2] = shadow[s + 2]
        moved[d + 3] = shadow[s + 3]
      }
    }
    // composite source over shadow (premultiplied-safe "over")
    const out = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      const sa = src[o + 3] / 255
      const da = moved[o + 3] / 255
      const a = sa + da * (1 - sa)
      out[o + 3] = a * 255
      if (a > 0.001) {
        out[o] = (src[o] * sa + moved[o] * da * (1 - sa)) / a
        out[o + 1] = (src[o + 1] * sa + moved[o + 1] * da * (1 - sa)) / a
        out[o + 2] = (src[o + 2] * sa + moved[o + 2] * da * (1 - sa)) / a
      }
    }
    return out
  },
}
