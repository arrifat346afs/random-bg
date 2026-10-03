/**
 * filters/raster/radial-blur.ts — Radial blur (raster-only).
 */

import { clamp, cornerRadius, num, sampleBilinear } from '../kit'
import type { FilterDef } from '../types'

export const radialBlurDef: FilterDef = {
  type: 'radial-blur',
  label: 'Radial blur',
  group: 'raster',
  description: 'Zoom-from-centre streaks. Raster-only.',
  isVectorSafe: false,
  rasterOnly: true,
  cost: 8,
  params: [
    { key: 'amount', label: 'Amount', type: 'float', min: 0, max: 1, step: 0.01, default: 0.3, rand: { min: 0.1, max: 0.4 } },
    { key: 'centerX', label: 'Centre X', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'centerY', label: 'Centre Y', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  toSvg() {
    return null
  },
  // Samples out to `amount × distance-to-farthest-corner` from the centre, so a
  // surface sized to the content alone would cut the streaks at its edge.
  spread: (p, ctx) =>
    clamp(num(p, 'amount', 0.3), 0, 1) *
    cornerRadius(ctx, num(p, 'centerX', 0.5), num(p, 'centerY', 0.5)),
  apply(src, w, h, params) {
    const amount = clamp(num(params, 'amount', 0.3), 0, 1)
    if (amount <= 0.005) return src.slice()
    const cx = clamp(num(params, 'centerX', 0.5), 0, 1) * w
    const cy = clamp(num(params, 'centerY', 0.5), 0, 1) * h
    const steps = 12
    const out = new Float32Array(src.length)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx
        const dy = y - cy
        let r = 0
        let g = 0
        let b = 0
        let a = 0
        for (let s = 0; s < steps; s++) {
          const t = (s / (steps - 1) - 0.5) * amount * 0.35
          const [rr, gg, bb, aa] = sampleBilinear(src, w, h, x + dx * t, y + dy * t)
          r += rr
          g += gg
          b += bb
          a += aa
        }
        const o = (y * w + x) * 4
        out[o] = r / steps
        out[o + 1] = g / steps
        out[o + 2] = b / steps
        out[o + 3] = a / steps
      }
    }
    return new Uint8ClampedArray(out)
  },
}
