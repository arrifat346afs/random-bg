/**
 * filters/raster/zoom-blur.ts — Zoom blur (raster-only).
 */

import { clamp, cornerRadius, num, sampleBilinear } from '../kit'
import type { FilterDef } from '../types'

export const zoomBlurDef: FilterDef = {
  type: 'zoom-blur',
  label: 'Zoom blur',
  group: 'raster',
  description: 'Radial zoom streaks. Raster-only.',
  isVectorSafe: false,
  rasterOnly: true,
  cost: 8,
  params: [
    { key: 'amount', label: 'Amount', type: 'float', min: 0, max: 1, step: 0.01, default: 0.35, rand: { min: 0.15, max: 0.45 } },
  ],
  toSvg() {
    return null
  },
  // Streaks are sampled from a scaled copy, reaching `amount ×` the farthest
  // corner radius from the centre.
  spread: (p, ctx) => clamp(num(p, 'amount', 0.35), 0, 1) * cornerRadius(ctx, 0.5, 0.5),
  apply(src, w, h, params) {
    const amount = clamp(num(params, 'amount', 0.35), 0, 1)
    if (amount <= 0.005) return src.slice()
    const cx = w / 2
    const cy = h / 2
    const steps = 14
    const out = new Float32Array(src.length)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x - cx) / Math.max(1, w)
        const dy = (y - cy) / Math.max(1, h)
        let r = 0
        let g = 0
        let b = 0
        let a = 0
        for (let s = 0; s < steps; s++) {
          const t = 1 + ((s / (steps - 1) - 0.5) * amount * 0.6)
          const [rr, gg, bb, aa] = sampleBilinear(src, w, h, cx + dx * Math.max(1, w) * t, cy + dy * Math.max(1, h) * t)
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
