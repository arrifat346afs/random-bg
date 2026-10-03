/**
 * filters/color/duotone.ts — Duotone / gradient map (palette-driven).
 * Vector-safe: luma → two/three-stop transfer.
 */

import { fmt, num, parseHex, str } from '../kit'
import type { FilterDef } from '../types'

export const duotoneDef: FilterDef = {
  type: 'duotone',
  label: 'Duotone',
  group: 'color',
  description: 'Map luma onto a dark → light palette.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 2,
  params: [
    { key: 'dark', label: 'Shadows', type: 'color', default: '#1a1033' },
    { key: 'light', label: 'Highlights', type: 'color', default: '#ffd66e' },
    { key: 'amount', label: 'Amount', type: 'float', min: 0, max: 1, step: 0.01, default: 1 },
  ],
  toSvg(params, ctx) {
    const amount = num(params, 'amount', 1)
    if (amount <= 0.001) return null
    const [r1, g1, b1] = parseHex(str(params, 'dark', '#1a1033'))
    const [r2, g2, b2] = parseHex(str(params, 'light', '#ffd66e'))
    const stops = 5
    const table = (c1: number, c2: number): string => {
      const vals: string[] = []
      for (let i = 0; i < stops; i++) {
        const t = i / (stops - 1)
        vals.push(fmt((c1 + (c2 - c1) * t) / 255, 4))
      }
      return vals.join(' ')
    }
    // Desaturate first so R, G and B all carry the same luminance. Writing the
    // luminance into R only (the obvious `feColorMatrix` luma trick) leaves
    // G and B at 0, and `feFuncG`/`feFuncB` then read *black* and emit the
    // dark stop of the ramp instead of the gradient.
    return (
      `<feColorMatrix in="${ctx.input}" type="saturate" values="0" result="${ctx.output}-l"/>` +
      `<feComponentTransfer in="${ctx.output}-l" result="${ctx.output}">` +
      `<feFuncR type="table" tableValues="${table(r1, r2)}"/>` +
      `<feFuncG type="table" tableValues="${table(g1, g2)}"/>` +
      `<feFuncB type="table" tableValues="${table(b1, b2)}"/></feComponentTransfer>`
    )
  },
  apply(src, _w, _h, params) {
    const amount = num(params, 'amount', 1)
    if (amount <= 0.001) return src.slice()
    const [r1, g1, b1] = parseHex(str(params, 'dark', '#1a1033'))
    const [r2, g2, b2] = parseHex(str(params, 'light', '#ffd66e'))
    const out = new Uint8ClampedArray(src)
    for (let i = 0; i < out.length; i += 4) {
      const luma = (0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2]) / 255
      const r = r1 + (r2 - r1) * luma
      const g = g1 + (g2 - g1) * luma
      const b = b1 + (b2 - b1) * luma
      out[i] = out[i] + (r - out[i]) * amount
      out[i + 1] = out[i + 1] + (g - out[i + 1]) * amount
      out[i + 2] = out[i + 2] + (b - out[i + 2]) * amount
    }
    return out
  },
}
