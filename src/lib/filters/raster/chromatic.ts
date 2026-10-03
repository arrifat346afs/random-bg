/**
 * filters/raster/chromatic.ts — Chromatic aberration (raster-only).
 */

import { clamp, num, sampleBilinear } from '../kit'
import type { FilterDef } from '../types'

export const chromaticDef: FilterDef = {
  type: 'chromatic',
  label: 'Chromatic aberration',
  group: 'raster',
  description: 'Radial RGB channel split. Raster-only.',
  isVectorSafe: false,
  rasterOnly: true,
  cost: 3,
  params: [
    { key: 'amount', label: 'Amount', type: 'float', min: 0, max: 12, step: 0.1, default: 2.5, rand: { min: 1, max: 4 } },
  ],
  // Each channel is sampled `amount` px away, in opposite directions.
  spread: (p) => clamp(num(p, 'amount', 2.5), 0, 24),
  toSvg() {
    return null
  },
  apply(src, w, h, params) {
    const amount = clamp(num(params, 'amount', 2.5), 0, 24)
    if (amount < 0.05) return src.slice()
    const cx = w / 2
    const cy = h / 2
    const maxR = Math.hypot(cx, cy) || 1
    const out = new Uint8ClampedArray(src.length)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x - cx) / maxR
        const dy = (y - cy) / maxR
        const r = Math.hypot(dx, dy)
        const shift = amount * r
        const len = Math.hypot(dx, dy) || 1
        const ux = dx / len
        const uy = dy / len
        const [rr] = sampleBilinear(src, w, h, x + ux * shift, y + uy * shift)
        const [, gg] = sampleBilinear(src, w, h, x, y)
        const [, , bb] = sampleBilinear(src, w, h, x - ux * shift, y - uy * shift)
        const o = (y * w + x) * 4
        out[o] = rr
        out[o + 1] = gg
        out[o + 2] = bb
        out[o + 3] = src[o + 3]
      }
    }
    return out
  },
}
