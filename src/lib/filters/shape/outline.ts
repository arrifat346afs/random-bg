/**
 * filters/shape/outline.ts — Outline / stroke around content.
 * Vector-safe via `feMorphology` + `feComposite`.
 */

import { clamp, escAttr, fmt, num, parseHex, str } from '../kit'
import type { FilterDef } from '../types'

export const outlineDef: FilterDef = {
  type: 'outline',
  label: 'Outline',
  group: 'shape',
  description: 'Stroke ring around the layer silhouette.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 3,
  spread: (p) => num(p, 'width', 3),
  params: [
    { key: 'width', label: 'Width', type: 'float', min: 0, max: 20, step: 0.5, default: 3, rand: { min: 1, max: 5 } },
    { key: 'color', label: 'Color', type: 'color', default: '#ffffff' },
    { key: 'opacity', label: 'Opacity', type: 'float', min: 0, max: 1, step: 0.01, default: 1 },
  ],
  toSvg(params, ctx) {
    const width = clamp(num(params, 'width', 3), 0, 40)
    if (width < 0.05) return null
    const color = escAttr(str(params, 'color', '#ffffff').slice(0, 7))
    const op = fmt(clamp(num(params, 'opacity', 1), 0, 1))
    return (
      `<feMorphology in="${ctx.input}" operator="dilate" radius="${fmt(width)}" result="${ctx.output}-d"/>` +
      // `flood ∩ dilated` is the whole grown silhouette, not a ring — painting
      // it over the source turned every shape solid white. `out` subtracts the
      // original and leaves exactly the annulus.
      `<feComposite in="${ctx.output}-d" in2="${ctx.input}" operator="out" result="${ctx.output}-r"/>` +
      `<feFlood flood-color="${color}" flood-opacity="${op}" result="${ctx.output}-f"/>` +
      `<feComposite in="${ctx.output}-f" in2="${ctx.output}-r" operator="in" result="${ctx.output}-s"/>` +
      `<feComposite in="${ctx.output}-s" in2="${ctx.input}" operator="over" result="${ctx.output}"/>`
    )
  },
  apply(src, w, h, params) {
    const width = clamp(num(params, 'width', 3), 0, 40)
    if (width < 0.05) return src.slice()
    const [cr, cg, cb] = parseHex(str(params, 'color', '#ffffff'))
    const op = clamp(num(params, 'opacity', 1), 0, 1)
    const r = Math.max(1, Math.round(width))
    const alpha = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) alpha[i] = src[i * 4 + 3] / 255
    const dil = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0
        for (let ky = -r; ky <= r && v < 1; ky++) {
          for (let kx = -r; kx <= r; kx++) {
            const xx = Math.min(w - 1, Math.max(0, x + kx))
            const yy = Math.min(h - 1, Math.max(0, y + ky))
            if (alpha[yy * w + xx] > 0.05) { v = 1; break }
          }
        }
        dil[y * w + x] = v
      }
    }
    const out = new Uint8ClampedArray(src)
    for (let i = 0; i < w * h; i++) {
      const sa = alpha[i]
      const ring = Math.max(0, dil[i] - sa) * op
      if (ring <= 0.001) continue
      const o = i * 4
      const a = sa + ring * (1 - sa)
      out[o] = (src[o] * sa + cr * ring * (1 - sa)) / Math.max(0.001, a)
      out[o + 1] = (src[o + 1] * sa + cg * ring * (1 - sa)) / Math.max(0.001, a)
      out[o + 2] = (src[o + 2] * sa + cb * ring * (1 - sa)) / Math.max(0.001, a)
      out[o + 3] = a * 255
    }
    return out
  },
}
