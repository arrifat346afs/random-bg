/**
 * filters/raster/motion-blur.ts — Motion blur (raster-only).
 * Directional accumulation; no faithful single-pass SVG equivalent.
 */

import { clamp, num, sampleBilinear } from '../kit'
import type { FilterDef } from '../types'

export const motionBlurDef: FilterDef = {
  type: 'motion-blur',
  label: 'Motion blur',
  group: 'raster',
  description: 'Directional streak blur. Raster-only.',
  isVectorSafe: false,
  rasterOnly: true,
  cost: 7,
  params: [
    { key: 'angle', label: 'Angle', type: 'float', min: 0, max: 360, step: 1, default: 0, unit: '°' },
    { key: 'distance', label: 'Distance', type: 'float', min: 0, max: 80, step: 1, default: 12, rand: { min: 6, max: 20 } },
  ],
  // No SVG primitive smears along a direction, so this one rasterises: the
  // exporter embeds the layer as an <image> instead of compiling a `<filter>`.
  toSvg() {
    return null
  },
  // A directional smear reaches `distance` past the content on the far side.
  spread: (p) => clamp(num(p, 'distance', 12), 0, 80),
  apply(src, w, h, params) {
    const dist = clamp(num(params, 'distance', 12), 0, 160)
    if (dist < 0.5) return src.slice()
    const ang = (clamp(num(params, 'angle', 0), 0, 360) * Math.PI) / 180
    const ux = Math.cos(ang)
    const uy = Math.sin(ang)
    const steps = Math.min(24, Math.max(3, Math.round(dist / 2)))
    const out = new Float32Array(src.length)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0
        let g = 0
        let b = 0
        let a = 0
        for (let s = 0; s < steps; s++) {
          const t = (s / (steps - 1) - 0.5) * dist
          const [rr, gg, bb, aa] = sampleBilinear(src, w, h, x + ux * t, y + uy * t)
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
