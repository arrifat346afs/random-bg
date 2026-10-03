/**
 * filters/shape/erode-dilate.ts — Erode / dilate.
 * Vector-safe via `feMorphology`.
 */

import { clamp, fmt, num } from '../kit'
import type { FilterDef } from '../types'

function morph(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
  mode: 'erode' | 'dilate',
): Uint8ClampedArray {
  const r = Math.max(1, Math.round(radius))
  const alpha = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) alpha[i] = src[i * 4 + 3]
  const out = new Uint8ClampedArray(src)
  // FeMorphology carries the colour of the pixel that won, so the grown edge
  // continues the artwork. Copying only the alpha left the new ring pixels at
  // whatever RGB the empty margin happened to hold — a black halo.
  const outAlpha = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = mode === 'erode' ? 255 : 0
      let sx = x
      let sy = y
      for (let ky = -r; ky <= r; ky++) {
        for (let kx = -r; kx <= r; kx++) {
          const xx = Math.min(w - 1, Math.max(0, x + kx))
          const yy = Math.min(h - 1, Math.max(0, y + ky))
          const a = alpha[yy * w + xx]
          if (mode === 'erode' ? a < v : a > v) {
            v = a
            sx = xx
            sy = yy
          }
        }
      }
      outAlpha[y * w + x] = v
      const o = (y * w + x) * 4
      const s = (sy * w + sx) * 4
      out[o] = src[s]
      out[o + 1] = src[s + 1]
      out[o + 2] = src[s + 2]
      out[o + 3] = v
    }
  }
  return out
}

export const erodeDilateDef: FilterDef = {
  type: 'erode-dilate',
  label: 'Erode / dilate',
  group: 'shape',
  description: 'Grow or shrink the alpha silhouette.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 3,
  spread: (p) => Math.abs(num(p, 'amount', 2)),
  params: [
    { key: 'amount', label: 'Amount', type: 'float', min: -8, max: 8, step: 0.5, default: 2, hint: 'Negative erodes, positive dilates.' },
  ],
  toSvg(params, ctx) {
    const amount = clamp(num(params, 'amount', 2), -20, 20)
    if (Math.abs(amount) < 0.05) return null
    const op = amount > 0 ? 'dilate' : 'erode'
    return `<feMorphology in="${ctx.input}" operator="${op}" radius="${fmt(Math.abs(amount))}" result="${ctx.output}"/>`
  },
  apply(src, w, h, params) {
    const amount = clamp(num(params, 'amount', 2), -20, 20)
    if (Math.abs(amount) < 0.05) return src.slice()
    return morph(src, w, h, Math.abs(amount), amount > 0 ? 'dilate' : 'erode')
  },
}
