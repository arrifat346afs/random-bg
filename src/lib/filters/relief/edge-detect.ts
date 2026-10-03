/**
 * filters/relief/edge-detect.ts — Edge detect.
 * Vector-safe via `feConvolveMatrix`.
 */

import { clamp, convolve3x3, fmt, num, str } from '../kit'
import type { FilterDef } from '../types'

export const edgeDetectDef: FilterDef = {
  type: 'edge-detect',
  label: 'Edge detect',
  group: 'relief',
  description: 'Laplacian edges over a dimmed base.',
  isVectorSafe: true,
  rasterOnly: false,
  cost: 3,
  params: [
    { key: 'amount', label: 'Amount', type: 'float', min: 0, max: 2, step: 0.01, default: 1 },
    { key: 'mode', label: 'Mode', type: 'enum', default: 'overlay', options: [{ value: 'overlay', label: 'Overlay' }, { value: 'only', label: 'Edges only' }] },
  ],
  toSvg(params, ctx) {
    const a = clamp(num(params, 'amount', 1), 0, 3)
    if (a <= 0.001) return null
    const k = fmt(a, 3)
    const conv =
      `<feConvolveMatrix in="${ctx.input}" order="3" preserveAlpha="true" ` +
      `kernelMatrix="-${k} -${k} -${k} -${k} ${fmt(a * 8)} -${k} -${k} -${k} -${k}" result="${ctx.output}-e"/>`
    if (str(params, 'mode', 'overlay') === 'only') return conv.replace(` result="${ctx.output}-e"`, '')
    // Overlay mode keeps 35% of the artwork under the edges — matching `apply`,
// which does `src*0.35 + edges*0.65`. An arithmetic composite is the exact
// addition; `feBlend mode="screen"` looked closer but is not.
    return (
      conv +
      `<feComposite in="${ctx.input}" in2="${ctx.output}-e" operator="arithmetic" ` +
      `k1="0" k2="0.35" k3="0.65" k4="0" result="${ctx.output}"/>`
    )
  },
  apply(src, w, h, params) {
    const a = clamp(num(params, 'amount', 1), 0, 3)
    if (a <= 0.001) return src.slice()
    const edges = convolve3x3(src, w, h, [-a, -a, -a, -a, a * 8, -a, -a, -a, -a])
    if (str(params, 'mode', 'overlay') === 'only') return edges
    const out = new Uint8ClampedArray(src.length)
    for (let i = 0; i < src.length; i += 4) {
      out[i] = src[i] * 0.35 + edges[i] * 0.65
      out[i + 1] = src[i + 1] * 0.35 + edges[i + 1] * 0.65
      out[i + 2] = src[i + 2] * 0.35 + edges[i + 2] * 0.65
      out[i + 3] = src[i + 3]
    }
    return out
  },
}
