/**
 * filters/texture/grain.ts — Noise / grain (seeded).
 * Vector-safe via `feTurbulence`; falls back gracefully where unsupported.
 */

import { clamp, fmt, num } from '../kit'
import { createRng } from '../../rng'
import type { FilterDef } from '../types'

export const grainDef: FilterDef = {
  type: 'grain',
  label: 'Grain',
  group: 'texture',
  description: 'Seeded film grain with size and blend control.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 4,
  params: [
    { key: 'amount', label: 'Amount', type: 'float', min: 0, max: 1, step: 0.01, default: 0.25, rand: { min: 0.08, max: 0.3 } },
    { key: 'size', label: 'Size', type: 'float', min: 0.5, max: 4, step: 0.1, default: 1 },
    { key: 'monochrome', label: 'Monochrome', type: 'bool', default: true },
    { key: 'seed', label: 'Seed', type: 'int', min: 0, max: 9999, step: 1, default: 5 },
  ],
  toSvg(params, ctx) {
    const amount = clamp(num(params, 'amount', 0.25), 0, 1)
    if (amount <= 0.001) return null
    const seed = Math.round(num(params, 'seed', 5))
    const mono = params['monochrome'] !== false
    // `size` scales the noise frequency: bigger grain = lower frequency. Hard-
    // coding 0.9 made the Size slider do nothing in the SVG export.
    const size = Math.max(0.5, Math.min(4, num(params, 'size', 1)))
    const freq = fmt(0.9 / size, 4)
    const noiseIn = mono ? `${ctx.output}-m` : `${ctx.output}-n`
    // `feTurbulence` emits noise centred on 0.5, and an arithmetic composite
    // with only `k2` *replaces* the artwork with scaled noise — the source
    // never enters the result. So the noise is first re-centred on 0 and scaled
    // by `amount`, then added: k2·in1 + k3·in2.
    //
    // The `operator="in"` step is not optional: unmasked turbulence has alpha 1
    // everywhere, so adding it speckled the empty margin of a transparent
    // export with dark noise — a halo round every shape.
    const lin = `type="linear" slope="${fmt(amount)}" intercept="${fmt(-amount / 2)}"`
    return (
      `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${seed}" result="${ctx.output}-n"/>` +
      (mono ? `<feColorMatrix in="${ctx.output}-n" type="saturate" values="0" result="${ctx.output}-m"/>` : '') +
      `<feComponentTransfer in="${noiseIn}" result="${ctx.output}-c">` +
      `<feFuncR ${lin}/>` +
      `<feFuncG ${lin}/>` +
      `<feFuncB ${lin}/>` +
      `<feFuncA type="linear" slope="0" intercept="1"/>` +
      `</feComponentTransfer>` +
      `<feComposite in="${ctx.output}-c" in2="${ctx.input}" operator="in" result="${ctx.output}-k"/>` +
      `<feComposite in="${ctx.input}" in2="${ctx.output}-k" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="${ctx.output}"/>`
    )
  },
  apply(src, _w, _h, params, seed) {
    const amount = clamp(num(params, 'amount', 0.25), 0, 1) * 255
    if (amount <= 0.2) return src.slice()
    const mono = params['monochrome'] !== false
    const s = Math.round(num(params, 'seed', 5)) + seed
    const rng = createRng(s)
    const out = new Uint8ClampedArray(src)
    for (let i = 0; i < out.length; i += 4) {
      if (mono) {
        const n = (rng.next() - 0.5) * 2 * amount
        out[i] = out[i] + n
        out[i + 1] = out[i + 1] + n
        out[i + 2] = out[i + 2] + n
      } else {
        out[i] = out[i] + (rng.next() - 0.5) * 2 * amount
        out[i + 1] = out[i + 1] + (rng.next() - 0.5) * 2 * amount
        out[i + 2] = out[i + 2] + (rng.next() - 0.5) * 2 * amount
      }
    }
    return out
  },
}
