/**
 * filters/color/invert.ts — Invert.
 * Vector-safe via `feComponentTransfer`.
 */

import { clamp, fmt, num } from '../kit'
import type { FilterDef } from '../types'

export const invertDef: FilterDef = {
  type: 'invert',
  label: 'Invert',
  group: 'color',
  description: 'Invert RGB channels with an amount mix.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 1,
  params: [
    { key: 'amount', label: 'Amount', type: 'float', min: 0, max: 1, step: 0.01, default: 1 },
  ],
  toSvg(params, ctx) {
    const a = clamp(num(params, 'amount', 1), 0, 1)
    if (a <= 0.001) return null
    // `type="table"` maps input 0 → tableValues[0] and input 1 → the last
    // entry, so an invert at full strength is "1 0" and the identity is
    // "0 1" — the reverse order is a silent no-op in every renderer.
    return (
      `<feComponentTransfer in="${ctx.input}" result="${ctx.output}">` +
      `<feFuncR type="table" tableValues="${fmt(a)} ${fmt(1 - a)}"/>` +
      `<feFuncG type="table" tableValues="${fmt(a)} ${fmt(1 - a)}"/>` +
      `<feFuncB type="table" tableValues="${fmt(a)} ${fmt(1 - a)}"/></feComponentTransfer>`
    )
  },
  apply(src, _w, _h, params) {
    const a = clamp(num(params, 'amount', 1), 0, 1)
    if (a <= 0.001) return src.slice()
    const out = new Uint8ClampedArray(src)
    for (let i = 0; i < out.length; i += 4) {
      out[i] = out[i] + (255 - 2 * out[i]) * a
      out[i + 1] = out[i + 1] + (255 - 2 * out[i + 1]) * a
      out[i + 2] = out[i + 2] + (255 - 2 * out[i + 2]) * a
    }
    return out
  },
}
