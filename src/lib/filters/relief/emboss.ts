/**
 * filters/relief/emboss.ts — Emboss.
 * Vector-safe via `feConvolveMatrix`.
 */

import { clamp, convolve3x3, fmt, num } from '../kit'
import type { FilterDef } from '../types'

export const embossDef: FilterDef = {
  type: 'emboss',
  label: 'Emboss',
  group: 'relief',
  description: 'Directional relief lighting.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 3,
  params: [
    { key: 'strength', label: 'Strength', type: 'float', min: 0, max: 2, step: 0.01, default: 1 },
    { key: 'angle', label: 'Angle', type: 'float', min: 0, max: 360, step: 1, default: 135, unit: '°' },
  ],
  toSvg(params, ctx) {
    const s = clamp(num(params, 'strength', 1), 0, 3)
    if (s <= 0.001) return null
    const k = fmt(s, 3)
    return (
      `<feConvolveMatrix in="${ctx.input}" order="3" preserveAlpha="true" bias="0.5" ` +
      `kernelMatrix="-${k} 0 0 0 0 0 0 0 ${k}" result="${ctx.output}"/>`
    )
  },
  apply(src, w, h, params) {
    const s = clamp(num(params, 'strength', 1), 0, 3)
    if (s <= 0.001) return src.slice()
    void num(params, 'angle', 135)
    return convolve3x3(src, w, h, [-s, 0, 0, 0, 0, 0, 0, 0, s], 1, 128)
  },
}
