/**
 * filters/raster/pixelate.ts — Pixelate / mosaic (raster-only).
 */

import { num } from '../kit'
import type { FilterDef } from '../types'

export const pixelateDef: FilterDef = {
  type: 'pixelate',
  label: 'Pixelate',
  group: 'raster',
  description: 'Mosaic blocks. Raster-only.',
  isVectorSafe: false,
  rasterOnly: true,
  cost: 2,
  params: [
    { key: 'size', label: 'Block size', type: 'int', min: 2, max: 64, step: 1, default: 12, rand: { min: 6, max: 20 } },
  ],
  toSvg() {
    return null
  },
  apply(src, w, h, params) {
    const size = Math.max(2, Math.min(64, Math.round(num(params, 'size', 12))))
    if (size <= 1) return src.slice()
    const out = new Uint8ClampedArray(src)
    for (let by = 0; by < h; by += size) {
      for (let bx = 0; bx < w; bx += size) {
        let r = 0
        let g = 0
        let b = 0
        let a = 0
        let n = 0
        for (let y = by; y < Math.min(h, by + size); y++) {
          for (let x = bx; x < Math.min(w, bx + size); x++) {
            const o = (y * w + x) * 4
            r += src[o]
            g += src[o + 1]
            b += src[o + 2]
            a += src[o + 3]
            n++
          }
        }
        if (!n) continue
        r /= n
        g /= n
        b /= n
        a /= n
        for (let y = by; y < Math.min(h, by + size); y++) {
          for (let x = bx; x < Math.min(w, bx + size); x++) {
            const o = (y * w + x) * 4
            out[o] = r
            out[o + 1] = g
            out[o + 2] = b
            out[o + 3] = a
          }
        }
      }
    }
    return out
  },
}
