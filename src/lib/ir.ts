/**
 * ir.ts — Resolution-independent intermediate representation.
 *
 * Every generator emits `Node[]`. From this single description we render BOTH
 * a Canvas2D preview and an SVG string, so the export always matches what the
 * user sees.
 *
 * Design rules:
 *  - Geometry is either analytic (circle/ellipse/rect) or an SVG path string.
 *  - Paint is solid / linear gradient / radial gradient with normalised stops.
 *  - Effects that differ between backends are expressed as *capabilities*
 *    (blend, blur) that each backend maps to its own mechanism; anything that
 *    cannot be represented is documented in render/svg.ts and can be
 *    rasterised on export.
 */

/* ---- Colors & paints --------------------------------------------------- */

/** Colour string: `#rgb`, `#rrggbb` or `#rrggbbaa` (alpha preferred in `a`). */
export type Color = string

export interface GradientStop {
  c: Color
  /** stop opacity 0..1 */
  o: number
  /** offset 0..1 */
  t: number
}

export type Paint =
  | { k: 'solid'; c: Color }
  | {
      k: 'linear'
      /** absolute canvas coordinates */
      x1: number
      y1: number
      x2: number
      y2: number
      stops: GradientStop[]
    }
  | {
      k: 'radial'
      cx: number
      cy: number
      /** outer radius */
      r: number
      /** inner radius (hard core), 0 = soft to the centre */
      ri?: number
      stops: GradientStop[]
    }

/* ---- Geometry ---------------------------------------------------------- */

export type Geo =
  | { k: 'circle'; x: number; y: number; r: number }
  | { k: 'ellipse'; x: number; y: number; rx: number; ry: number; rot?: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number; r?: number }
  /** ready-to-use SVG path data */
  | { k: 'path'; d: string }
  /** flat [x0,y0,x1,y1,...] polygon (implicitly closed) */
  | { k: 'poly'; pts: number[] }

/* ---- Blend modes ------------------------------------------------------- */

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'plus-lighter',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const
export type BlendMode = (typeof BLEND_MODES)[number]

/** Modes that behave identically in canvas and SVG via `mix-blend-mode`. */
export const SVG_SAFE_BLENDS = new Set<BlendMode>([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
])
/** No SVG/CSS equivalent — exporter substitutes `screen` (documented). */
export const CANVAS_ONLY_BLENDS = new Set<BlendMode>(['plus-lighter'])

/* ---- Nodes ------------------------------------------------------------- */

export interface Node {
  g: Geo
  fill?: Paint | null
  stroke?: Paint | null
  /** stroke width */
  sw?: number
  cap?: 'butt' | 'round' | 'square'
  join?: 'miter' | 'round' | 'bevel'
  dash?: number[]
  /** node opacity 0..1 (multiplied with paint stop alphas) */
  op?: number
  /** blend with everything painted below this node */
  blend?: BlendMode
  /** gaussian blur radius in canvas px (uses an SVG filter) */
  blur?: number
  /** stroke opacity ramp along a direction (used for trail fades) */
  fade?: { x1: number; y1: number; x2: number; y2: number; from?: number; to?: number }
  /**
   * Manual layer placement in IR units, applied at draw/export time rather than
   * baked into `g` — so moving a layer costs a transform per node instead of a
   * geometry rewrite and a cache miss. Canvas does `ctx.translate`, SVG emits
   * `transform="translate(…)"`.
   */
  tx?: number
  ty?: number
  /**
   * Owning layer, stamped only for layers whose filter stack is non-empty.
   *
   * `composeIR` leaves this off everything else so a filter-free project
   * serialises exactly as it did before filters existed (one string per node is
   * real memory at 40k nodes). The SVG backend uses it to wrap each layer's
   * contiguous run of nodes in one `<g filter>`; the canvas backend uses it to
   * rasterise that layer separately.
   */
  lid?: string
}

export interface IR {
  w: number
  h: number
  nodes: Node[]
  /** true if any node uses a blend/feature needing an SVG fallback */
  stats: { count: number; blurs: number; additive: boolean; maxBlur: number }
}

export function buildIR(w: number, h: number, nodes: Node[]): IR {
  let blurs = 0
  let maxBlur = 0
  let additive = false
  for (const n of nodes) {
    if (n.blur && n.blur > 0) {
      blurs++
      if (n.blur > maxBlur) maxBlur = n.blur
    }
    if (n.blend === 'plus-lighter') additive = true
  }
  return { w, h, nodes, stats: { count: nodes.length, blurs, additive, maxBlur } }
}

/* ---- Paint helpers ----------------------------------------------------- */

export const solid = (c: Color): Paint => ({ k: 'solid', c })

/** Soft radial glow disc — the workhorse for particles, bokeh and haze. */
export function glowPaint(
  cx: number,
  cy: number,
  r: number,
  c: Color,
  alpha: number,
  core = 0,
): Paint {
  const stops: GradientStop[] = []
  if (core > 0) {
    stops.push({ t: 0, c, o: alpha })
    stops.push({ t: Math.min(0.98, core), c, o: alpha })
  } else {
    stops.push({ t: 0, c, o: alpha })
  }
  // cosine-ish falloff: brighter core, long soft tail
  stops.push({ t: 0.28, c, o: alpha * 0.55 })
  stops.push({ t: 0.6, c, o: alpha * 0.16 })
  stops.push({ t: 1, c, o: 0 })
  return { k: 'radial', cx, cy, r, ri: 0, stops }
}

/** Flat-ish disc with a soft edge (bokeh discs, leaves' shading). */
export function discPaint(
  cx: number,
  cy: number,
  r: number,
  c: Color,
  alpha: number,
  softness = 0.25,
): Paint {
  const inner = Math.max(0, 1 - softness)
  const stops: GradientStop[] = [
    { t: 0, c, o: alpha },
    { t: inner, c, o: alpha },
    { t: Math.min(1, inner + (1 - inner) * 0.5), c, o: alpha * 0.75 },
    { t: 1, c, o: 0 },
  ]
  return { k: 'radial', cx, cy, r, ri: 0, stops }
}

export function linearPaint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stops: GradientStop[],
): Paint {
  return { k: 'linear', x1, y1, x2, y2, stops }
}

/* ---- Geometry helpers -------------------------------------------------- */

export function circle(x: number, y: number, r: number, fill: Paint, extra: Partial<Node> = {}): Node {
  return { g: { k: 'circle', x, y, r }, fill, ...extra }
}

export function path(d: string, extra: Partial<Node> = {}): Node {
  return { g: { k: 'path', d }, ...extra }
}

/** Flat point array → SVG path data (polylines, polygons, star rays). */
export function polyD(pts: number[], closed = true): string {
  if (pts.length < 4) return ''
  let d = `M${r2(pts[0])} ${r2(pts[1])}`
  for (let i = 2; i < pts.length; i += 2) d += `L${r2(pts[i])} ${r2(pts[i + 1])}`
  return closed ? d + 'Z' : d
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Catmull–Rom spline through points → cubic bezier path data. */
export function splineD(pts: number[], closed = false, tension = 0.5): string {
  const n = pts.length / 2
  if (n < 2) return ''
  const P = (i: number): [number, number] => {
    const idx = closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))
    return [pts[idx * 2], pts[idx * 2 + 1]]
  }
  let d = `M${r2(pts[0])} ${r2(pts[1])}`
  const last = closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const [x0, y0] = P(i - 1)
    const [x1, y1] = P(i)
    const [x2, y2] = P(i + 1)
    const [x3, y3] = P(i + 2)
    const c1x = x1 + ((x2 - x0) / 6) * tension * 2
    const c1y = y1 + ((y2 - y0) / 6) * tension * 2
    const c2x = x2 - ((x3 - x1) / 6) * tension * 2
    const c2y = y2 - ((y3 - y1) / 6) * tension * 2
    d += `C${r2(c1x)} ${r2(c1y)},${r2(c2x)} ${r2(c2y)},${r2(x2)} ${r2(y2)}`
  }
  return closed ? d + 'Z' : d
}

/**
 * Tapered stroke → filled outline polygon.
 * SVG strokes have constant width, so variable-width strokes (comets, trails,
 * petals) are converted to an explicit outline that renders identically
 * everywhere. Returns path data.
 */
export function taperD(
  pts: number[],
  widthAt: (t: number) => number,
  samples = 24,
  closedCap = false,
): string {
  const n = pts.length / 2
  if (n < 2) return ''
  // resample the polyline to `samples` evenly spaced points
  const segLen: number[] = []
  let total = 0
  for (let i = 1; i < n; i++) {
    const dx = pts[i * 2] - pts[i * 2 - 2]
    const dy = pts[i * 2 + 1] - pts[i * 2 - 1]
    const l = Math.hypot(dx, dy)
    segLen.push(l)
    total += l
  }
  if (total === 0) return ''
  const left: number[] = []
  const right: number[] = []
  let seg = 0
  let acc = 0
  for (let s = 0; s < samples; s++) {
    const target = (s / (samples - 1)) * total
    while (seg < segLen.length - 1 && acc + segLen[seg] < target) {
      acc += segLen[seg]
      seg++
    }
    const local = segLen[seg] > 0 ? (target - acc) / segLen[seg] : 0
    const i0 = seg
    const i1 = seg + 1
    const x = pts[i0 * 2] + (pts[i1 * 2] - pts[i0 * 2]) * local
    const y = pts[i0 * 2 + 1] + (pts[i1 * 2 + 1] - pts[i0 * 2 + 1]) * local
    // direction from neighbours
    const px = pts[Math.max(0, i0 - 1) * 2]
    const py = pts[Math.max(0, i0 - 1) * 2 + 1]
    const nx = pts[Math.min(n - 1, i1 + 1) * 2]
    const ny = pts[Math.min(n - 1, i1 + 1) * 2 + 1]
    let dx = nx - px
    let dy = ny - py
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    const t = s / (samples - 1)
    const hw = Math.max(0.01, widthAt(t)) / 2
    left.push(x - dy * hw, y + dx * hw)
    right.push(x + dy * hw, y - dx * hw)
  }
  right.reverse()
  const d = polyD([...left, ...right], true)
  return closedCap ? d : d
}

/* ---- Common shapes ----------------------------------------------------- */

export function starPts(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  rays: number,
  rot = -Math.PI / 2,
): number[] {
  const pts: number[] = []
  const step = Math.PI / rays
  for (let i = 0; i < rays * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = rot + i * step
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
  }
  return pts
}

export function ngonPts(
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rot = -Math.PI / 2,
): number[] {
  const pts: number[] = []
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
  }
  return pts
}
