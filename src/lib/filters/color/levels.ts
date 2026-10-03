/**
 * filters/color/levels.ts — Gamma / levels.
 * Vector-safe via `feComponentTransfer`.
 */

import { clamp, fmt, num } from '../kit'
import type { FilterDef } from '../types'

export const levelsDef: FilterDef = {
  type: 'levels',
  label: 'Gamma / levels',
  group: 'color',
  description: 'Input black/white points plus gamma.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 1,
  params: [
    { key: 'black', label: 'Black point', type: 'float', min: 0, max: 0.9, step: 0.01, default: 0 },
    { key: 'white', label: 'White point', type: 'float', min: 0.1, max: 1, step: 0.01, default: 1 },
    { key: 'gamma', label: 'Gamma', type: 'float', min: 0.2, max: 3, step: 0.01, default: 1, rand: { min: 0.8, max: 1.4 } },
  ],
  toSvg(params, ctx) {
    const black = clamp(num(params, 'black', 0), 0, 0.9)
    const white = clamp(num(params, 'white', 1), 0.1, 1)
    const gamma = clamp(num(params, 'gamma', 1), 0.2, 4)
    if (black <= 0.001 && white >= 0.999 && Math.abs(gamma - 1) < 0.005) return null
    const slope = 1 / Math.max(0.01, white - black)
    const intercept = -black * slope
    return (
      `<feComponentTransfer in="${ctx.input}" result="${ctx.output}">` +
      `<feFuncR type="gamma" amplitude="${fmt(slope)}" exponent="${fmt(gamma)}" offset="${fmt(intercept / slope)}"/>` +
      `<feFuncG type="gamma" amplitude="${fmt(slope)}" exponent="${fmt(gamma)}" offset="${fmt(intercept / slope)}"/>` +
      `<feFuncB type="gamma" amplitude="${fmt(slope)}" exponent="${fmt(gamma)}" offset="${fmt(intercept / slope)}"/></feComponentTransfer>`
    )
  },
  apply(src, _w, _h, params) {
    const black = clamp(num(params, 'black', 0), 0, 0.9)
    const white = clamp(num(params, 'white', 1), 0.1, 1)
    const gamma = clamp(num(params, 'gamma', 1), 0.2, 4)
    if (black <= 0.002 && white >= 0.998 && Math.abs(gamma - 1) < 0.005) return src.slice()
    const out = new Uint8ClampedArray(src)
    // Matches `feFuncR type="gamma" amplitude exponent offset`:
    //   out = amplitude * in^exponent + offset
    // which is *not* the same as normalising first and then taking the power
    // (that alternative made the canvas and the SVG export drift by ~5 levels).
    const amplitude = 1 / Math.max(0.01, white - black)
    const offset = -black
    for (let i = 0; i < out.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const v = out[i + c] / 255
        out[i + c] = (amplitude * Math.pow(v, gamma) + offset) * 255
      }
    }
    return out
  },
}
