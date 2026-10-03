/**
 * filters/color/posterize.ts — Posterize.
 * Vector-safe via `feComponentTransfer discrete`.
 */

import { fmt, num } from '../kit'
import type { FilterDef } from '../types'

export const posterizeDef: FilterDef = {
  type: 'posterize',
  label: 'Posterize',
  group: 'color',
  description: 'Reduce tonal levels per channel.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 1,
  params: [
    { key: 'levels', label: 'Levels', type: 'int', min: 2, max: 12, step: 1, default: 4, rand: { min: 3, max: 6 } },
  ],
  toSvg(params, ctx) {
    const levels = Math.max(2, Math.min(12, Math.round(num(params, 'levels', 4))))
    const table = Array.from({ length: levels }, (_, i) => fmt(i / (levels - 1), 3)).join(' ')
    return (
      `<feComponentTransfer in="${ctx.input}" result="${ctx.output}">` +
      `<feFuncR type="discrete" tableValues="${table}"/>` +
      `<feFuncG type="discrete" tableValues="${table}"/>` +
      `<feFuncB type="discrete" tableValues="${table}"/></feComponentTransfer>`
    )
  },
  apply(src, _w, _h, params) {
    const levels = Math.max(2, Math.min(12, Math.round(num(params, 'levels', 4))))
    if (levels >= 64) return src.slice()
    const out = new Uint8ClampedArray(src)
    const step = 255 / (levels - 1)
    // `type="discrete"` truncates towards the lower step; rounding here would
    // quantise up and put the canvas half a step above the SVG export.
    const bucket = (v: number): number =>
      Math.min(levels - 1, Math.floor((v / 255) * levels)) * step
    for (let i = 0; i < out.length; i += 4) {
      out[i] = bucket(out[i])
      out[i + 1] = bucket(out[i + 1])
      out[i + 2] = bucket(out[i + 2])
    }
    return out
  },
}
