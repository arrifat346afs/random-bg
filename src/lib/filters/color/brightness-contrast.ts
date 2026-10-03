/**
 * filters/color/brightness-contrast.ts — Brightness / contrast.
 * Vector-safe via `feComponentTransfer`.
 */

import { clamp, fmt, num } from '../kit'
import type { FilterDef } from '../types'

export const brightnessContrastDef: FilterDef = {
  type: 'brightness-contrast',
  label: 'Brightness / contrast',
  group: 'color',
  description: 'Linear brightness and contrast around mid-grey.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 1,
  params: [
    { key: 'brightness', label: 'Brightness', type: 'float', min: -1, max: 1, step: 0.01, default: 0, rand: { min: -0.15, max: 0.15 } },
    { key: 'contrast', label: 'Contrast', type: 'float', min: -1, max: 1, step: 0.01, default: 0, rand: { min: -0.2, max: 0.3 } },
  ],
  toSvg(params, ctx) {
    const b = clamp(num(params, 'brightness', 0), -1, 1)
    const c = clamp(num(params, 'contrast', 0), -1, 1)
    if (Math.abs(b) < 0.001 && Math.abs(c) < 0.001) return null
    // Deliberately *not* an `feColorMatrix`. Brightness/contrast is a per-channel
    // affine map, so the matrix has three identical colour rows — a form Chrome
    // and librsvg both mis-evaluate (they apply the row to (R,0,0,0,A), which
    // turns the whole image grey). `feComponentTransfer type="linear"` is the
    // exact same maths expressed per channel and is rendered correctly.
    const slope = 1 + c
    // out = slope*in + (b - c/2)  around mid-grey
    const intercept = b - c * 0.5
    const k = `type="linear" slope="${fmt(slope)}" intercept="${fmt(intercept)}"`
    return (
      `<feComponentTransfer in="${ctx.input}" result="${ctx.output}">` +
      `<feFuncR ${k}/>` +
      `<feFuncG ${k}/>` +
      `<feFuncB ${k}/>` +
      `</feComponentTransfer>`
    )
  },
  apply(src, _w, _h, params) {
    const b = clamp(num(params, 'brightness', 0), -1, 1) * 255
    const slope = 1 + clamp(num(params, 'contrast', 0), -1, 1)
    if (Math.abs(b) < 0.5 && Math.abs(slope - 1) < 0.001) return src.slice()
    const out = new Uint8ClampedArray(src)
    for (let i = 0; i < out.length; i += 4) {
      out[i] = (out[i] - 128) * slope + 128 + b
      out[i + 1] = (out[i + 1] - 128) * slope + 128 + b
      out[i + 2] = (out[i + 2] - 128) * slope + 128 + b
    }
    return out
  },
}
