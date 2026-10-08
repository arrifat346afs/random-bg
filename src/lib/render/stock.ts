/**
 * render/stock.ts — Adobe Stock-safe pure-vector conversion.
 *
 * Turns a preview IR into a filter-free, blend-free IR:
 *  - every `node.blur` is expanded into pure-vector equivalents
 *    (erfc-profile radial gradients for discs, stacked strokes for
 *    strokes/paths and filled-shape halos);
 *  - every non-`normal` blend is flattened to `normal` with an
 *    opacity pre-composite approximation;
 *  - layer-filter stacks are the caller's responsibility to drop
 *    (see renderSVG adobeCompat path) — this module only rewrites nodes.
 *
 * Pure TypeScript, no DOM. Hex in, hex out.
 */

import { hexToRgb, rgbToHex } from '../palette'
import type { GradientStop, IR, Node, Paint } from '../ir'
import { buildIR } from '../ir'

/** Complementary error function, Abramowitz & Stegun 7.1.26 (|err| <= 1.5e-7). */
export function erfc(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const poly =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  const erf = 1 - poly * Math.exp(-x * x)
  return x >= 0 ? 1 - erf : 1 + erf
}

/**
 * Gaussian-blurred disc edge profile.
 * d = distance from centre, r = sharp radius, sigma = blur std-dev.
 * Returns 0..1 alpha multiplier.
 */
export function gaussianEdgeAlpha(d: number, r: number, sigma: number): number {
  if (sigma <= 1e-6) return d <= r ? 1 : 0
  const z = (d - r) / (sigma * Math.SQRT2)
  return 0.5 * erfc(z)
}

/** Solid paint's colour + combined alpha (hex alpha × node opacity). */
function baseColorOf(n: Node): { color: string; alpha: number } {
  const op = n.op ?? 1
  const pick = (p: Paint | null | undefined): { color: string; alpha: number } | null => {
    if (!p) return null
    if (p.k === 'solid') {
      const [r, g, b, a] = hexToRgb(p.c)
      return { color: rgbToHex(r, g, b), alpha: a * op }
    }
    const s = p.stops[0]
    if (s) {
      const [r, g, b] = hexToRgb(s.c)
      return { color: rgbToHex(r, g, b), alpha: (s.o ?? 1) * op }
    }
    return null
  }
  return pick(n.fill) ?? pick(n.stroke) ?? { color: '#ffffff', alpha: op }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Radial gradient stops sampling the erfc edge profile.
 * Outer radius R = r + 3σ; ≥24 stops; hex colours + per-stop opacity
 * (never rgba() — Inkscape parses that as black).
 */
export function blurredDiscStops(color: string, alpha: number, r: number, sigma: number, n = 28): GradientStop[] {
  const count = Math.max(24, Math.round(n))
  const R = r + 3 * sigma
  const out: GradientStop[] = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    const d = t * R
    out.push({ t: Number(t.toFixed(4)), c: color, o: Number((alpha * gaussianEdgeAlpha(d, r, sigma)).toFixed(4)) })
  }
  // hard zero at the rim so resvg/librsvg never leave a hairline
  out[out.length - 1] = { t: 1, c: color, o: 0 }
  return out
}

/** Opacity factor when flattening an additive-ish blend to normal. */
function flattenFactor(blend: string): number {
  switch (blend) {
    case 'plus-lighter':
      return 0.8
    case 'screen':
      return 0.85
    case 'lighten':
      return 0.9
    case 'color-dodge':
      return 0.7
    case 'overlay':
    case 'soft-light':
      return 0.9
    default:
      return 1
  }
}

export interface StockConversion {
  nodes: Node[]
  notes: string[]
  /** true when the look measurably changed (blend flatten / filter drop / heavy blur) */
  unfaithful: boolean
  blurredNodes: number
  flattenedBlends: number
  haloNodes: number
}

const MAX_STOCK_NODES = 60000

export function toStockIR(ir: IR, opts: { haloCopies?: number } = {}): StockConversion {
  const notes: string[] = []
  const out: Node[] = []
  let blurredNodes = 0
  let flattenedBlends = 0
  let haloNodes = 0
  const blendKinds = new Set<string>()
  const wantHalo = Math.max(6, Math.min(10, opts.haloCopies ?? 8))

  for (const src of ir.nodes) {
    const sigma = src.blur && src.blur > 0.05 ? src.blur : 0
    // strip placement-preserving fields aside; blend flattens to normal below
    const core: Node = { ...src, blur: undefined }
    if (core.blend && core.blend !== 'normal') {
      blendKinds.add(core.blend)
      flattenedBlends++
      const f = flattenFactor(core.blend)
      core.blend = 'normal'
      if (f < 1) core.op = Number(clamp01((core.op ?? 1) * f).toFixed(4))
    }
    // fold node opacity handling: keep as-is; gradient path folds it into stops
    if (sigma <= 0) {
      out.push(core)
      continue
    }
    blurredNodes++
    const { color, alpha } = baseColorOf(src)
    if (alpha <= 0.003) {
      out.push(core)
      continue
    }

    // Blurred solid discs → single erfc-profile radial gradient (exact spec path).
    if (src.g.k === 'circle' && src.fill?.k === 'solid') {
      const r = Math.max(0.5, src.g.r)
      const R = r + 3 * sigma
      const stops = blurredDiscStops(color, alpha, r, sigma, 28)
      core.fill = { k: 'radial', cx: src.g.x, cy: src.g.y, r: R, ri: 0, stops }
      core.op = undefined
      out.push(core)
      continue
    }

    // Everything else: sharp core + stacked halo strokes (Gaussian weights).
    // Budget guard: huge layers keep fewer halo copies rather than exploding.
    const copies = ir.nodes.length > 12000 ? 6 : wantHalo
    // core keeps its own opacity; halos carry theirs independently.
    const halos: Node[] = []
    const isStrokeOnly = !src.fill && !!src.stroke
    const w0 = src.sw ?? (isStrokeOnly ? 2 : 0)
    for (let k = 1; k <= copies; k++) {
      const z = (k / copies) * 3 // 0..3σ
      const weight = Math.exp(-0.5 * z * z)
      const haloOp = alpha * weight * (isStrokeOnly ? 0.5 : 0.32)
      if (haloOp < 0.004) continue
      const width = isStrokeOnly ? w0 + k * sigma * 0.8 : k * sigma * 0.9 + 0.5
      halos.push({
        ...src,
        blur: undefined,
        blend: 'normal',
        fill: null,
        stroke: { k: 'solid', c: color },
        sw: Number(width.toFixed(2)),
        cap: 'round',
        join: 'round',
        dash: undefined,
        fade: undefined,
        op: Number(haloOp.toFixed(4)),
      })
    }
    if (out.length + halos.length + 1 > MAX_STOCK_NODES) {
      // node cap: keep the sharp core, drop the faintest halos first
      const room = Math.max(0, MAX_STOCK_NODES - out.length - 1)
      out.push(...halos.slice(halos.length - room), core)
      notes.push('node cap reached: faintest blur halos dropped on dense layers.')
    } else {
      out.push(...halos, core)
      haloNodes += halos.length
    }
  }

  if (blurredNodes > 0) notes.push(`${blurredNodes} blurred node(s) expanded to pure-vector gradients/stacked strokes (no <filter>).`)
  if (flattenedBlends > 0)
    notes.push(
      `${flattenedBlends} blended node(s) [${[...blendKinds].join(', ')}] flattened to normal blend with opacity pre-composite; additive glow reads slightly flatter than the preview.`,
    )
  const unfaithful = flattenedBlends > 0 // blur expansion itself is faithful; blends/filters are not
  return { nodes: out, notes, unfaithful, blurredNodes, flattenedBlends, haloNodes }
}

export function toStockBuildIR(ir: IR): { ir: IR; notes: string[]; unfaithful: boolean } {
  const conv = toStockIR(ir)
  return { ir: buildIR(ir.w, ir.h, conv.nodes), notes: conv.notes, unfaithful: conv.unfaithful }
}
