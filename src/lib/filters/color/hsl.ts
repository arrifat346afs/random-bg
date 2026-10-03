/**
 * filters/color/hsl.ts — Hue / saturation / lightness.
 * Vector-safe: hue-rotate + saturate matrices; lightness via transfer.
 */

import { clamp, fmt, num } from '../kit'
import type { FilterDef } from '../types'

/**
 * Saturation as an explicit `feColorMatrix`, not `type="saturate"`.
 *
 * librsvg ignores `type="saturate"` for any value above 1 — a 1.4 saturation
 * came out of a strict renderer as exactly 1.0, silently. Writing the standard
 * saturation matrix out by hand costs six lines and behaves identically
 * everywhere. The three rows differ from each other, so it also stays clear of
 * the "three identical colour rows" form that Chrome and librsvg mis-evaluate.
 */
function saturateMatrix(input: string, s: number, output: string): string {
  const row = (a: number, b: number, c: number): string => `${fmt(a, 4)} ${fmt(b, 4)} ${fmt(c, 4)} 0 0`
  return (
    `<feColorMatrix in="${input}" type="matrix" values="` +
    `${row(0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s)} ` +
    `${row(0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s)} ` +
    `${row(0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s)} ` +
    `0 0 0 1 0" result="${output}"/>`
  )
}

export const hslDef: FilterDef = {
  type: 'hsl',
  label: 'Hue / saturation',
  group: 'color',
  description: 'Shift hue, scale saturation and lightness.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 2,
  params: [
    { key: 'hue', label: 'Hue shift', type: 'float', min: -180, max: 180, step: 1, default: 0, unit: '°', rand: { min: -30, max: 30 } },
    { key: 'saturation', label: 'Saturation', type: 'float', min: -1, max: 1, step: 0.01, default: 0, rand: { min: -0.2, max: 0.4 } },
    { key: 'lightness', label: 'Lightness', type: 'float', min: -1, max: 1, step: 0.01, default: 0, rand: { min: -0.1, max: 0.1 } },
  ],
  toSvg(params, ctx) {
    const hue = clamp(num(params, 'hue', 0), -180, 180)
    const sat = 1 + clamp(num(params, 'saturation', 0), -1, 2)
    const light = clamp(num(params, 'lightness', 0), -1, 1)
    if (Math.abs(hue) < 0.5 && Math.abs(sat - 1) < 0.005 && Math.abs(light) < 0.005) return null
    // `light` is a 0–1 slider scaled to ±60/255 to match `apply` below.
    const lift = (light * 60) / 255
    let inner = `<feColorMatrix in="${ctx.input}" type="hueRotate" values="${fmt(hue)}" result="${ctx.output}-h"/>`
    inner += saturateMatrix(ctx.output + '-h', Math.max(0, sat), ctx.output + '-s')
    if (Math.abs(light) >= 0.005) {
      inner +=
        `<feComponentTransfer in="${ctx.output}-s" result="${ctx.output}">` +
        `<feFuncR type="linear" slope="1" intercept="${fmt(lift)}"/>` +
        `<feFuncG type="linear" slope="1" intercept="${fmt(lift)}"/>` +
        `<feFuncB type="linear" slope="1" intercept="${fmt(lift)}"/></feComponentTransfer>`
    } else {
      inner += `<feComposite in="${ctx.output}-s" in2="${ctx.output}-s" operator="over" result="${ctx.output}"/>`
    }
    return inner
  },
  apply(src, _w, _h, params) {
    const hue = clamp(num(params, 'hue', 0), -180, 180)
    const satK = 1 + clamp(num(params, 'saturation', 0), -1, 2)
    const light = clamp(num(params, 'lightness', 0), -1, 1) * 60
    if (Math.abs(hue) < 0.5 && Math.abs(satK - 1) < 0.005 && Math.abs(light) < 0.5) return src.slice()
    const out = new Uint8ClampedArray(src.length)
    const hr = (hue * Math.PI) / 180
    const cos = Math.cos(hr)
    const sin = Math.sin(hr)
    for (let i = 0; i < src.length; i += 4) {
      const r = src[i] / 255
      const g = src[i + 1] / 255
      const b = src[i + 2] / 255
      // hue rotate (CSS matrix approximation)
      const m00 = 0.213 + cos * 0.787 - sin * 0.213
      const m01 = 0.715 - cos * 0.715 - sin * 0.715
      const m02 = 0.072 - cos * 0.072 + sin * 0.928
      const m10 = 0.213 - cos * 0.213 + sin * 0.143
      const m11 = 0.715 + cos * 0.285 + sin * 0.14
      const m12 = 0.072 - cos * 0.072 - sin * 0.283
      const m20 = 0.213 - cos * 0.213 - sin * 0.787
      const m21 = 0.715 - cos * 0.715 + sin * 0.715
      const m22 = 0.072 + cos * 0.928 + sin * 0.072
      let rr = m00 * r + m01 * g + m02 * b
      let gg = m10 * r + m11 * g + m12 * b
      let bb = m20 * r + m21 * g + m22 * b
      // Every SVG filter primitive operates on values already clamped to 0–1,
      // so the saturation stage sees a hue-rotated pixel that cannot be
      // negative. Skipping this clamp let the saturation push channels further
      // out of gamut than the SVG export ever could.
      rr = rr < 0 ? 0 : rr > 1 ? 1 : rr
      gg = gg < 0 ? 0 : gg > 1 ? 1 : gg
      bb = bb < 0 ? 0 : bb > 1 ? 1 : bb
      // saturation around luma
      const luma = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb
      rr = luma + (rr - luma) * satK
      gg = luma + (gg - luma) * satK
      bb = luma + (bb - luma) * satK
      // the lightness lift is its own `feComponentTransfer`, so it reads a
      // *clamped* saturation result — adding `light` to an unclamped value
      // left a 4-level gap on channels the rotation pushed out of gamut
      out[i] = (Math.min(1, Math.max(0, rr)) * 255 + light)
      out[i + 1] = (Math.min(1, Math.max(0, gg)) * 255 + light)
      out[i + 2] = (Math.min(1, Math.max(0, bb)) * 255 + light)
      out[i + 3] = src[i + 3]
    }
    return out
  },
}
