/**
 * filters/color/sepia.ts — Sepia tone.
 * Vector-safe via `feColorMatrix`.
 */

import { clamp, fmt, num } from '../kit'
import type { FilterDef } from '../types'

const SEPIA = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131]

export const sepiaDef: FilterDef = {
  type: 'sepia',
  label: 'Sepia',
  group: 'color',
  description: 'Warm vintage sepia with an amount mix.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 1,
  params: [
    { key: 'amount', label: 'Amount', type: 'float', min: 0, max: 1, step: 0.01, default: 0.8 },
  ],
  toSvg(params, ctx) {
    const a = clamp(num(params, 'amount', 0.8), 0, 1)
    if (a <= 0.001) return null
    // lerp identity → sepia by amount, expressed as one matrix
    const m = SEPIA.map((v, i) => {
      const row = Math.floor(i / 3)
      const col = i % 3
      const ident = row === col ? 1 : 0
      return fmt(ident + (v - ident) * a, 4)
    })
    return (
      `<feColorMatrix in="${ctx.input}" type="matrix" values="` +
      `${m[0]} ${m[1]} ${m[2]} 0 0 ${m[3]} ${m[4]} ${m[5]} 0 0 ${m[6]} ${m[7]} ${m[8]} 0 0 0 0 0 1 0" ` +
      `result="${ctx.output}"/>`
    )
  },
  apply(src, _w, _h, params) {
    const a = clamp(num(params, 'amount', 0.8), 0, 1)
    if (a <= 0.001) return src.slice()
    const out = new Uint8ClampedArray(src)
    for (let i = 0; i < out.length; i += 4) {
      const r = out[i]
      const g = out[i + 1]
      const b = out[i + 2]
      const sr = 0.393 * r + 0.769 * g + 0.189 * b
      const sg = 0.349 * r + 0.686 * g + 0.168 * b
      const sb = 0.272 * r + 0.534 * g + 0.131 * b
      out[i] = r + (sr - r) * a
      out[i + 1] = g + (sg - g) * a
      out[i + 2] = b + (sb - b) * a
    }
    return out
  },
}
