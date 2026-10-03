/**
 * filters/color/grayscale.ts — Grayscale.
 * Vector-safe via `feColorMatrix saturate 0`.
 */

import { clamp, fmt, num } from '../kit'
import type { FilterDef } from '../types'

export const grayscaleDef: FilterDef = {
  type: 'grayscale',
  label: 'Grayscale',
  group: 'color',
  description: 'Desaturate toward luma, with an amount mix.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 1,
  params: [
    { key: 'amount', label: 'Amount', type: 'float', min: 0, max: 1, step: 0.01, default: 1 },
  ],
  toSvg(params, ctx) {
    const a = clamp(num(params, 'amount', 1), 0, 1)
    if (a <= 0.001) return null
    return `<feColorMatrix in="${ctx.input}" type="saturate" values="${fmt(1 - a)}" result="${ctx.output}"/>`
  },
  apply(src, _w, _h, params) {
    const a = clamp(num(params, 'amount', 1), 0, 1)
    if (a <= 0.001) return src.slice()
    const out = new Uint8ClampedArray(src)
    for (let i = 0; i < out.length; i += 4) {
      const luma = 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2]
      out[i] = out[i] + (luma - out[i]) * a
      out[i + 1] = out[i + 1] + (luma - out[i + 1]) * a
      out[i + 2] = out[i + 2] + (luma - out[i + 2]) * a
    }
    return out
  },
}
