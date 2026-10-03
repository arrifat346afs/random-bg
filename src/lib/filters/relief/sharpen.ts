/**
 * filters/relief/sharpen.ts — Sharpen.
 * Vector-safe via `feConvolveMatrix`.
 */

import { clamp, convolve3x3, fmt, num } from '../kit'
import type { FilterDef } from '../types'

export const sharpenDef: FilterDef = {
  type: 'sharpen',
  label: 'Sharpen',
  group: 'relief',
  description: 'Unsharp-mask style sharpen.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 3,
  params: [
    { key: 'amount', label: 'Amount', type: 'float', min: 0, max: 2, step: 0.01, default: 0.6, rand: { min: 0.2, max: 0.9 } },
  ],
  toSvg(params, ctx) {
    const a = clamp(num(params, 'amount', 0.6), 0, 3)
    if (a <= 0.001) return null
    const c = fmt(-a / 4, 4)
    const core = fmt(1 + a, 4)
    return (
      `<feConvolveMatrix in="${ctx.input}" order="3" preserveAlpha="true" ` +
      `kernelMatrix="0 ${c} 0 ${c} ${core} ${c} 0 ${c} 0" result="${ctx.output}"/>`
    )
  },
  apply(src, w, h, params) {
    const a = clamp(num(params, 'amount', 0.6), 0, 3)
    if (a <= 0.001) return src.slice()
    const c = -a / 4
    return convolve3x3(src, w, h, [0, c, 0, c, 1 + a, c, 0, c, 0])
  },
}
