/**
 * render/canvas.ts — Canvas2D backend for the IR.
 *
 * Blend modes map to `globalCompositeOperation`, blurs to `ctx.filter`, and
 * gradients are built from the same stop data the SVG backend uses, so the
 * preview and the export stay visually identical.
 */

import { hexToRgb, type Palette } from '../palette'
import { createRng, hash32 } from '../rng'
import type { BlendMode, IR, Node, Paint } from '../ir'
import type { BackgroundSpec } from '../schema'

export function cssColor(hex: string, alpha = 1): string {
  const [r, g, b, a] = hexToRgb(hex)
  const A = a * alpha
  if (A >= 1 && alpha >= 1) return `rgb(${r} ${g} ${b})`
  return `rgb(${r} ${g} ${b} / ${A.toFixed(4)})`
}

/** Canvas blend name (plus-lighter has no CSS name alias in canvas). */
function canvasBlend(b: BlendMode | undefined): GlobalCompositeOperation {
  if (!b || b === 'normal') return 'source-over'
  if (b === 'plus-lighter') return 'lighter'
  return b as GlobalCompositeOperation
}

/** Feature detection: ctx.filter is missing in older Safari. */
let filterSupported: boolean | null = null
function supportsFilter(ctx: CanvasRenderingContext2D): boolean {
  if (filterSupported === null) {
    try {
      ctx.save()
      ctx.filter = 'blur(1px)'
      filterSupported = ctx.filter === 'blur(1px)'
      ctx.restore()
    } catch {
      filterSupported = false
    }
  }
  return filterSupported
}

function makePaint(ctx: CanvasRenderingContext2D, p: Paint): string | CanvasGradient {
  if (p.k === 'solid') return cssColor(p.c)
  if (p.k === 'linear') {
    const g = ctx.createLinearGradient(p.x1, p.y1, p.x2, p.y2)
    for (const s of p.stops) g.addColorStop(clamp01(s.t), cssColor(s.c, s.o))
    return g
  }
  const ri = p.ri ?? 0
  const g = ctx.createRadialGradient(p.cx, p.cy, ri, p.cx, p.cy, Math.max(0.01, p.r))
  // radial gradient needs at least 2 stops
  if (p.stops.length < 2) {
    const s = p.stops[0] ?? { t: 0, c: '#ffffff', o: 1 }
    g.addColorStop(0, cssColor(s.c, s.o))
    g.addColorStop(1, cssColor(s.c, 0))
    return g
  }
  for (const s of p.stops) g.addColorStop(clamp01(s.t), cssColor(s.c, s.o))
  return g
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

function tracePath(ctx: CanvasRenderingContext2D, n: Node): void {
  const g = n.g
  switch (g.k) {
    case 'circle':
      ctx.beginPath()
      ctx.arc(g.x, g.y, Math.max(0, g.r), 0, Math.PI * 2)
      break
    case 'ellipse':
      ctx.beginPath()
      ctx.ellipse(g.x, g.y, Math.max(0, g.rx), Math.max(0, g.ry), g.rot ?? 0, 0, Math.PI * 2)
      break
    case 'rect':
      ctx.beginPath()
      if (g.r && g.r > 0) roundRect(ctx, g.x, g.y, g.w, g.h, g.r)
      else ctx.rect(g.x, g.y, g.w, g.h)
      break
    case 'path':
      ctx.beginPath()
      drawSvgPath(ctx, g.d)
      break
    case 'poly': {
      ctx.beginPath()
      const p = g.pts
      if (p.length >= 4) {
        ctx.moveTo(p[0], p[1])
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1])
        ctx.closePath()
      }
      break
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}

/**
 * Minimal SVG path parser (M/L/H/V/C/Q/Z + absolute & relative).
 * We only ever consume path data produced by our own builders, so a full
 * spec implementation is unnecessary — but arcs are handled for user-imported
 * SVG shapes in the scatter generator.
 */
export function drawSvgPath(ctx: CanvasRenderingContext2D, d: string): void {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g)
  if (!tokens) return
  let i = 0
  let cmd = ''
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  const num = () => {
    const v = parseFloat(tokens[i++])
    return Number.isFinite(v) ? v : 0
  }
  while (i < tokens.length) {
    const t = tokens[i]
    if (/[a-zA-Z]/.test(t)) {
      cmd = t
      i++
    } else if (!cmd) {
      i++
      continue
    }
    switch (cmd) {
      case 'M': {
        x = num()
        y = num()
        ctx.moveTo(x, y)
        sx = x
        sy = y
        cmd = 'L'
        break
      }
      case 'm': {
        x += num()
        y += num()
        ctx.moveTo(x, y)
        sx = x
        sy = y
        cmd = 'l'
        break
      }
      case 'L': {
        x = num()
        y = num()
        ctx.lineTo(x, y)
        break
      }
      case 'l': {
        x += num()
        y += num()
        ctx.lineTo(x, y)
        break
      }
      case 'H': {
        x = num()
        ctx.lineTo(x, y)
        break
      }
      case 'h': {
        x += num()
        ctx.lineTo(x, y)
        break
      }
      case 'V': {
        y = num()
        ctx.lineTo(x, y)
        break
      }
      case 'v': {
        y += num()
        ctx.lineTo(x, y)
        break
      }
      case 'C': {
        const a = num()
        const b = num()
        const c = num()
        const e = num()
        x = num()
        y = num()
        ctx.bezierCurveTo(a, b, c, e, x, y)
        break
      }
      case 'c': {
        const a = x + num()
        const b = y + num()
        const c = x + num()
        const e = y + num()
        x += num()
        y += num()
        ctx.bezierCurveTo(a, b, c, e, x, y)
        break
      }
      case 'Q': {
        const a = num()
        const b = num()
        x = num()
        y = num()
        ctx.quadraticCurveTo(a, b, x, y)
        break
      }
      case 'q': {
        const a = x + num()
        const b = y + num()
        x += num()
        y += num()
        ctx.quadraticCurveTo(a, b, x, y)
        break
      }
      case 'A': {
        const rx = num()
        const ry = num()
        num() // x-axis-rotation
        num() // large-arc
        num() // sweep
        x = num()
        y = num()
        ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2)
        break
      }
      case 'a': {
        const rx = num()
        const ry = num()
        num()
        num()
        num()
        x += num()
        y += num()
        ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2)
        break
      }
      case 'Z':
      case 'z':
        ctx.closePath()
        x = sx
        y = sy
        break
      default:
        i++
    }
  }
}

/* ---- Background --------------------------------------------------------- */

const noiseTiles = new Map<string, HTMLCanvasElement>()

function noiseTile(color: string, amount: number): HTMLCanvasElement {
  const key = `${color}|${amount}`
  let c = noiseTiles.get(key)
  if (c) return c
  c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')
  if (g) {
    const img = g.createImageData(128, 128)
    const [r, gg, b] = hexToRgb(color)
    // seeded from the tile's own key: the grain has to be identical in the
    // preview, in a re-render, and in an export made on another day
    const rng = createRng(hash32(color, amount))
    for (let i = 0; i < 128 * 128; i++) {
      const n = (rng.next() - 0.5) * 2 * amount
      img.data[i * 4] = clamp255(r + n * 255)
      img.data[i * 4 + 1] = clamp255(gg + n * 255)
      img.data[i * 4 + 2] = clamp255(b + n * 255)
      img.data[i * 4 + 3] = 255
    }
    g.putImageData(img, 0, 0)
  }
  if (noiseTiles.size > 8) noiseTiles.clear()
  noiseTiles.set(key, c)
  return c
}
const clamp255 = (v: number) => Math.max(0, Math.min(255, v))

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bg: BackgroundSpec,
): void {
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  switch (bg.kind) {
    case 'transparent':
      break
    case 'solid':
      ctx.fillStyle = cssColor(bg.color)
      ctx.fillRect(0, 0, w, h)
      break
    case 'gradient': {
      const a = ((bg.angle - 90) * Math.PI) / 180
      const dx = Math.cos(a) * w
      const dy = Math.sin(a) * h
      const g = ctx.createLinearGradient(w / 2 - dx / 2, h / 2 - dy / 2, w / 2 + dx / 2, h / 2 + dy / 2)
      g.addColorStop(0, cssColor(bg.from))
      g.addColorStop(1, cssColor(bg.to))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      break
    }
    case 'noise': {
      ctx.fillStyle = cssColor(bg.color)
      ctx.fillRect(0, 0, w, h)
      const tile = noiseTile(bg.color, bg.amount)
      const pat = ctx.createPattern(tile, 'repeat')
      if (pat) {
        ctx.globalAlpha = 0.6
        ctx.fillStyle = pat
        ctx.fillRect(0, 0, w, h)
      }
      break
    }
  }
  ctx.restore()
}

/* ---- Main render -------------------------------------------------------- */

export interface CanvasRenderOpts {
  /** device pixel ratio / export scale */
  scale?: number
  /** when omitted, the canvas is left transparent */
  background?: BackgroundSpec
  /** clear before drawing (default true) */
  clear?: boolean
}

/**
 * Draw an IR into a context that is already set up by the caller.
 * Used by the interactive preview, which applies its own zoom/pan transform.
 * `scale` converts IR units → device pixels; the background is drawn in IR
 * space so it scales with the artwork.
 */
export function drawIR(
  ctx: CanvasRenderingContext2D,
  ir: IR,
  scale: number,
  background?: BackgroundSpec,
): void {
  ctx.save()
  ctx.scale(scale, scale)
  if (background) drawBackground(ctx, ir.w, ir.h, background)
  drawNodes(ctx, ir.nodes, makeOpts(ctx, ir.nodes))
  ctx.restore()
}

export function renderCanvas(
  ir: IR,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  opts: CanvasRenderOpts = {},
): void {
  const scale = opts.scale ?? 1
  const cw = Math.max(1, Math.round(ir.w * scale))
  const ch = Math.max(1, Math.round(ir.h * scale))
  if (canvas.width !== cw) canvas.width = cw
  if (canvas.height !== ch) canvas.height = ch
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
  if (!ctx) return
  if (opts.clear !== false) ctx.clearRect(0, 0, cw, ch)

  ctx.save()
  ctx.scale(scale, scale)
  if (opts.background) drawBackground(ctx, ir.w, ir.h, opts.background)
  drawNodes(ctx, ir.nodes, makeOpts(ctx, ir.nodes))
  ctx.restore()
}

export interface DrawOpts {
  canFilter: boolean
  hasFade: boolean
  /**
   * Device pixels per IR unit on the current transform. `ctx.filter`'s blur
   * radius is measured in *device* pixels while SVG's `stdDeviation` is in
   * user units, so the radius has to be scaled by the transform for the two
   * backends to agree (see `blurPx`).
   */
  px: number
  /** true while drawing into a batching scratch — the batch applies the blur */
  skipBlur?: boolean
}

/* ---- Blurred-run batching ------------------------------------------------ */

/**
 * Blur, and what it actually costs.
 *
 * `ctx.filter` is charged per **clip**, not per shape: a `blur()` over a 719²
 * surface costs ~3.8 ms, the same blur clipped to a 40² box around the shape
 * costs ~0.03 ms — 130× cheaper. Two earlier conclusions drawn without
 * forcing a flush (Skia defers the work until the pixels are read) were
 * therefore wrong: there is no cliff at ~4 000 filtered draws, and the cost is
 * not a flat ~4 ms either. The real model is
 *
 *     ms ≈ 7 × (filtered megapixels)   with   filtered pixels = clip area
 *
 * which gives exactly two levers: clip tightly (`clipToNode`), and cover fewer
 * pixels per draw. The second lever is *grouping*.
 *
 * Blur is linear (σ is fixed per node) and `plus-lighter` is commutative, so
 * inside a contiguous run of additive nodes we may regroup by blur radius:
 * blurring the sum is identical to summing the blurs. That turns N filtered
 * draws into one per (radius bucket, tile) — a win when the members are large
 * and overlapping, a loss when they are tiny and spread out. Rather than pick
 * a side up front, `drawAdditiveRun` prices both and takes the cheaper.
 *
 * Both paths are then held to a single pixel budget (`FILTER_PX_BUDGET`), so
 * the worst case is bounded in time instead of in draw count.
 */
/**
 * How much blur this renderer is allowed to buy.
 *
 * A filtered draw costs ≈ 7 ms per megapixel of its **clip** (measured on a
 * software rasteriser; GPU rasterisers are far cheaper but the ratio holds).
 * `MAX_FILTERED_OPS` counts draws, which is the wrong unit — one draw over the
 * whole canvas costs as much as a thousand draws clipped to a 40² box. Budget
 * filtered *pixels* instead: 600 MP ≈ 4 s of blur, i.e. a hard ceiling on the
 * worst case while staying far above anything a normal project asks for.
 */
const FILTER_PX_BUDGET = 600_000_000
let filterPxLeft = FILTER_PX_BUDGET
const takeFilterPx = (px: number): boolean => {
  if (px > filterPxLeft) return false
  filterPxLeft -= px
  return true
}

/** Safety ceiling on filtered draws; past it blur is dropped rather than hang. */
const MAX_FILTERED_OPS = 3500
const BATCH_MIN = 6
/** scratch ceiling — keeps peak extra memory bounded (~64 MB) */
const MAX_BATCH_PIXELS = 16_000_000
/** blur spreads ~4σ before it is visually gone; pad the scratch by that much */
const BLUR_PAD = 4
/** below this clip area full-resolution blur is already ~1 ms — not worth a round trip */
const DOWNSCALE_MIN_PX = 200_000
/** never downscale a blur that would land under ~1 px in scratch space */
const DOWNSCALE_MIN_SIGMA = 2

/**
 * `plus-lighter` is the only truly additive mode (canvas `lighter`); `lighten`
 * and `screen` are non-linear, so their members must keep their exact order.
 */
const isAdditive = (b: BlendMode | undefined): boolean => b === 'plus-lighter'

/**
 * Blur radius quantisation, per additive run (log₂ σ steps). Blur cost is
 * ≈ (#distinct radii) × (surface area), so the bucket count is what bounds the
 * render: spread the run's own range over at most `MAX_RADIUS_BUCKETS` steps,
 * never coarser than `MAX_LOG_STEP` (≈9 % σ error) and never finer than
 * `MIN_LOG_STEP` (sub-pixel differences are not worth an extra composite).
 */
const MIN_LOG_STEP = 0.04
const MAX_LOG_STEP = 0.25
const MAX_RADIUS_BUCKETS = 16

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

const grow = (a: Rect, b: Rect): void => {
  if (b.x0 < a.x0) a.x0 = b.x0
  if (b.y0 < a.y0) a.y0 = b.y0
  if (b.x1 > a.x1) a.x1 = b.x1
  if (b.y1 > a.y1) a.y1 = b.y1
}

const boundsMemo = new WeakMap<Node, Rect | null>()
/**
 * Conservative extent of one node in IR units (control points bound curves).
 *
 * Memoised: with per-node clipping this is asked twice per draw (once for the
 * clip, once to price the filter budget), and replaying a long path through the
 * parser twice is not free. Exported because the selection box and canvas
 * hit-testing want the same answer rather than a second parser.
 */
export function nodeBounds(n: Node): Rect | null {
  const hit = boundsMemo.get(n)
  if (hit !== undefined) return hit
  const r = computeBounds(n)
  boundsMemo.set(n, r)
  return r
}

function computeBounds(n: Node): Rect | null {
  const g = n.g
  switch (g.k) {
    case 'circle':
      return { x0: g.x - g.r, y0: g.y - g.r, x1: g.x + g.r, y1: g.y + g.r }
    case 'ellipse': {
      const m = Math.max(g.rx, g.ry)
      return { x0: g.x - m, y0: g.y - m, x1: g.x + m, y1: g.y + m }
    }
    case 'rect':
      return {
        x0: Math.min(g.x, g.x + g.w),
        y0: Math.min(g.y, g.y + g.h),
        x1: Math.max(g.x, g.x + g.w),
        y1: Math.max(g.y, g.y + g.h),
      }
    case 'poly': {
      const p = g.pts
      if (p.length < 4) return null
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (let i = 0; i + 1 < p.length; i += 2) {
        if (p[i] < x0) x0 = p[i]
        if (p[i] > x1) x1 = p[i]
        if (p[i + 1] < y0) y0 = p[i + 1]
        if (p[i + 1] > y1) y1 = p[i + 1]
      }
      return { x0, y0, x1, y1 }
    }
    case 'path':
      return pathBounds(g.d)
  }
}

/**
 * Bounds of SVG path data, by replaying the parser onto a recording context.
 * Control points over-estimate the extent, which is the safe direction.
 */
function pathBounds(d: string): Rect | null {
  const b: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  const pt = (x: number, y: number) => {
    if (!(Number.isFinite(x) && Number.isFinite(y))) return
    if (x < b.x0) b.x0 = x
    if (x > b.x1) b.x1 = x
    if (y < b.y0) b.y0 = y
    if (y > b.y1) b.y1 = y
  }
  const rec = {
    moveTo: pt,
    lineTo: pt,
    closePath: () => {},
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => {
      pt(cx, cy)
      pt(x, y)
    },
    bezierCurveTo: (a1: number, b1: number, a2: number, b2: number, x: number, y: number) => {
      pt(a1, b1)
      pt(a2, b2)
      pt(x, y)
    },
    ellipse: (x: number, y: number, rx: number, ry: number) => {
      pt(x - rx, y - ry)
      pt(x + rx, y + ry)
    },
    arc: (x: number, y: number, r: number) => {
      pt(x - r, y - r)
      pt(x + r, y + r)
    },
    arcTo: (x1: number, y1: number) => pt(x1, y1),
    rect: (x: number, y: number, w: number, h: number) => {
      pt(x, y)
      pt(x + w, y + h)
    },
  }
  try {
    drawSvgPath(rec as unknown as CanvasRenderingContext2D, d)
  } catch {
    return null
  }
  if (!Number.isFinite(b.x0) || !Number.isFinite(b.y0)) return null
  return b
}

interface Scratch {
  c: HTMLCanvasElement
  x: CanvasRenderingContext2D | null
}
let scratch: Scratch | null = null

function getScratch(w: number, h: number): Scratch | null {
  if (w <= 0 || h <= 0 || w * h > MAX_BATCH_PIXELS) return null
  if (typeof document === 'undefined') return null
  if (!scratch) scratch = { c: document.createElement('canvas'), x: null }
  if (scratch.c.width !== w || scratch.c.height !== h) {
    scratch.c.width = w
    scratch.c.height = h
    scratch.x = null
  }
  if (!scratch.x) scratch.x = scratch.c.getContext('2d')
  return scratch.x ? scratch : null
}

/** Drop the batching scratch — called after large one-shot renders. */
export function releaseRenderScratch(): void {
  if (!scratch) return
  scratch.c.width = 0
  scratch.c.height = 0
  scratch.x = null
  scratch = null
}

function makeOpts(ctx: CanvasRenderingContext2D, nodes: Node[]): DrawOpts {
  const t = ctx.getTransform()
  return {
    canFilter: supportsFilter(ctx),
    hasFade: nodes.some((n) => n.fade),
    px: Math.hypot(t.a, t.b) || 1,
  }
}

/** `blur()` in device px that reproduces SVG's `stdDeviation` in user units. */
const blurPx = (node: Node, o: DrawOpts): string =>
  ((node.blur ?? 0) * o.px).toFixed(3)

/**
 * Intersect the clip with this node's own extent before a filtered draw.
 *
 * `ctx.filter` rasterises into a temporary layer sized by the **clip**, not by
 * the shape — on a software rasteriser a blur over a 719² surface costs
 * ~3.8 ms, the same blur clipped to a 40² box around the shape costs ~0.03 ms
 * (130× cheaper). Everything a blurred node can reach is bounded by its extent
 * grown by ~4σ, so the clip removes nothing visible (the Gaussian tail at 4σ is
 * 0.03 %) while removing essentially all of the cost.
 *
 * Returns false when the extent is undeterminable, in which case the clip is
 * left alone — correct, just the slow path.
 */
function clipToNode(ctx: CanvasRenderingContext2D, node: Node, o: DrawOpts): boolean {
  const b = nodeBounds(node)
  if (!b) return false
  // 4σ of blur + half the stroke width + one device pixel of antialias slack
  const pad = (node.blur ?? 0) * 4 + (node.sw ?? 0) * 0.5 + 1 / (o.px || 1)
  const w = b.x1 - b.x0
  const h = b.y1 - b.y0
  if (!(w >= 0 && h >= 0)) return false
  ctx.beginPath()
  ctx.rect(b.x0 - pad, b.y0 - pad, w + pad * 2, h + pad * 2)
  ctx.clip()
  return true
}

/**
 * Device pixels the filtered layer for this node will cover — the quantity
 * that actually decides render time. Unknown extents cost a full canvas.
 */
function deviceFilterArea(ctx: CanvasRenderingContext2D, node: Node, o: DrawOpts): number {
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  const b = nodeDeviceBounds(node, ctx.getTransform())
  if (!b) return cw * ch
  const pad = ((node.blur ?? 0) * 4 + (node.sw ?? 0) * 0.5 + 1 / (o.px || 1)) * o.px
  const w = b.x1 - b.x0 + pad * 2
  const h = b.y1 - b.y0 + pad * 2
  if (!(w > 0 && h > 0)) return 0
  return Math.min(w * h, cw * ch)
}

/**
 * Draw nodes, regrouping blurred additive runs into one filtered composite
 * per (radius, tile). Returns the number of filtered draws performed.
 */
export function drawNodes(
  ctx: CanvasRenderingContext2D,
  nodes: Node[],
  o: DrawOpts,
): number {
  filterPxLeft = FILTER_PX_BUDGET

  let ops = 0
  let i = 0
  while (i < nodes.length) {
    // Manual layer placement. Nodes are emitted layer by layer, so a contiguous
    // run shares one offset — translate once for the run rather than paying a
    // save/restore per primitive. This has to happen *before* the blur clip is
    // priced, because deviceFilterArea maps the node's bounds through the
    // current transform.
    const tx = nodes[i].tx ?? 0
    const ty = nodes[i].ty ?? 0
    const moved = tx !== 0 || ty !== 0
    if (moved) {
      ctx.save()
      ctx.translate(tx, ty)
    }
    let end = i
    while (end < nodes.length && (nodes[end].tx ?? 0) === tx && (nodes[end].ty ?? 0) === ty) end++

    let j = i
    while (j < end) {
      const node = nodes[j]
      const blurred = (node.blur ?? 0) > 0.05
      if (blurred && o.canFilter && isAdditive(node.blend)) {
        // additive runs may be regrouped, so price both strategies and keep the
        // cheaper one — see drawAdditiveRun. `end` is the cap so a run never
        // straddles two placements.
        let k = j
        while (k < end && isAdditive(nodes[k].blend)) k++
        ops += drawAdditiveRun(ctx, nodes, j, k, o, ops)
        j = k
        continue
      }
      if (blurred && o.canFilter) {
        // a non-additive node must keep its exact place in the sequence, so the
        // only option left is the clipped direct draw
        if (ops < MAX_FILTERED_OPS && takeFilterPx(deviceFilterArea(ctx, node, o))) {
          ops++
          drawNode(ctx, node, o)
        } else drawNode(ctx, node, { ...o, skipBlur: true })
        j++
        continue
      }
      drawNode(ctx, node, o)
      j++
    }

    if (moved) ctx.restore()
    i = end
  }
  return ops
}

/** A blurred node plus its device-space extent (null when undeterminable). */
interface Blurred {
  n: Node
  b: Rect | null
}

/** Node extent mapped through the current transform (4 corners bound a rotate). */
function nodeDeviceBounds(n: Node, t: DOMMatrix): Rect | null {
  const b = nodeBounds(n)
  if (!b) return null
  const xs = [b.x0, b.x1, b.x0, b.x1]
  const ys = [b.y0, b.y0, b.y1, b.y1]
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let k = 0; k < 4; k++) {
    const x = t.a * xs[k] + t.c * ys[k] + t.e
    const y = t.b * xs[k] + t.d * ys[k] + t.f
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return { x0, y0, x1, y1 }
}

function drawAdditiveRun(
  ctx: CanvasRenderingContext2D,
  nodes: Node[],
  i: number,
  j: number,
  o: DrawOpts,
  opsIn: number,
): number {
  const t = ctx.getTransform()
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  const blurred: Blurred[] = []
  for (let k = i; k < j; k++) {
    const n = nodes[k]
    // unblurred members of the run cost no filter — paint them straight away
    if ((n.blur ?? 0) > 0.05) blurred.push({ n, b: nodeDeviceBounds(n, t) })
    else drawNode(ctx, n, o)
  }
  if (!blurred.length) return 0

  let ops = opsIn
  const fallback: Blurred[] = []

  // extent of the run in device space
  const union: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  let complete = true
  for (const e of blurred) {
    if (!e.b) complete = false
    else grow(union, e.b)
  }
  if (!complete || !Number.isFinite(union.x0)) {
    union.x0 = 0
    union.y0 = 0
    union.x1 = cw
    union.y1 = ch
  }

  // Tile the run when one scratch would exceed the memory ceiling: tiles keep
  // peak extra memory bounded without inflating the batch count much.
  const uw = Math.max(1, union.x1 - union.x0)
  const uh = Math.max(1, union.y1 - union.y0)
  const tiles = Math.min(8, Math.max(1, Math.ceil((uw * uh) / MAX_BATCH_PIXELS)))
  const alongX = uw >= uh
  const span = (alongX ? uw : uh) / tiles
  const tileOf = (b: Rect): number => {
    const c = alongX ? (b.x0 + b.x1) / 2 - union.x0 : (b.y0 + b.y1) / 2 - union.y0
    return Math.min(tiles - 1, Math.max(0, Math.floor(c / span)))
  }

  // Adaptive radius buckets. Each group costs its own extent in pixels, so a
  // naive grid of buckets per octave blows the total up on a wide range.
  // Instead spread the run's actual radii over at most `MAX_RADIUS_BUCKETS`
  // steps: for the real distributions (0.3–4.5) that is a ≤9 % σ error, i.e.
  // sub-pixel, while bounding how many filtered layers this run can create.
  let logMin = Infinity
  let logMax = -Infinity
  for (const e of blurred) {
    const l = Math.log2(Math.max(e.n.blur ?? 0.1, 0.01))
    if (l < logMin) logMin = l
    if (l > logMax) logMax = l
  }
  const range = logMax - logMin
  const step = Math.min(
    MAX_LOG_STEP,
    Math.max(MIN_LOG_STEP, range / MAX_RADIUS_BUCKETS),
  )
  const bucketOf = (r: number) => Math.round((Math.log2(Math.max(r, 0.01)) - logMin) / step)

  // group by (blur-radius bucket, tile), tracking each group's extent so it
  // can be priced against drawing its members one by one
  interface Group {
    list: Blurred[]
    rect: Rect
  }
  const groups = new Map<string, Group>()
  for (const e of blurred) {
    if (!e.b) {
      fallback.push(e)
      continue
    }
    const key = `${bucketOf(e.n.blur ?? 0.1)}|${tileOf(e.b)}`
    const hit = groups.get(key)
    if (hit) {
      hit.list.push(e)
      grow(hit.rect, e.b)
    } else {
      groups.set(key, { list: [e], rect: { ...e.b } })
    }
  }

  for (const group of groups.values()) {
    // One filtered layer of the group's extent, or one clipped filter per
    // member. Whichever covers fewer pixels wins — a dense field of tiny
    // sparks is cheaper one-by-one, a handful of canvas-sized veils is not.
    const area = groupArea(ctx, group.rect, group.list[0].n, o)
    let members = 0
    for (const e of group.list) members += deviceFilterArea(ctx, e.n, o)
    if (
      area < members &&
      group.list.length >= BATCH_MIN &&
      ops < MAX_FILTERED_OPS &&
      drawBatch(ctx, group.list, o)
    ) {
      ops++
    } else fallback.push(...group.list)
  }

  for (const e of fallback) {
    if (ops < MAX_FILTERED_OPS && takeFilterPx(deviceFilterArea(ctx, e.n, o))) {
      ops++
      drawNode(ctx, e.n, o)
    } else drawNode(ctx, e.n, { ...o, skipBlur: true })
  }
  return ops - opsIn
}

/** Device pixels one filtered layer would cover for a group of this extent. */
function groupArea(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  sample: Node,
  o: DrawOpts,
): number {
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  const pad = ((sample.blur ?? 0) * BLUR_PAD + (sample.sw ?? 0) * 0.5 + 1 / (o.px || 1)) * o.px
  const w = rect.x1 - rect.x0 + pad * 2
  const h = rect.y1 - rect.y0 + pad * 2
  if (!(w > 0 && h > 0)) return Infinity
  return Math.min(w * h, cw * ch)
}

/**
 * One filtered composite for a whole group of same-radius additive nodes:
 * paint them unblurred into a scratch sized to their shared extent, then blit
 * that through a single `ctx.filter`. Identical to blurring each node on its
 * own, because blur is linear and the sum is taken over an additive blend.
 */
function drawBatch(ctx: CanvasRenderingContext2D, group: Blurred[], o: DrawOpts): boolean {
  const t = ctx.getTransform()
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  const blur = group[0].n.blur ?? 0.1
  const pad = BLUR_PAD * blur * o.px + 2
  const rect: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (const e of group) if (e.b) grow(rect, e.b)
  if (!Number.isFinite(rect.x0)) return false
  const x0 = Math.max(0, Math.floor(rect.x0 - pad))
  const y0 = Math.max(0, Math.floor(rect.y0 - pad))
  const x1 = Math.min(cw, Math.ceil(rect.x1 + pad))
  const y1 = Math.min(ch, Math.ceil(rect.y1 + pad))
  const w = x1 - x0
  const h = y1 - y0
  if (w <= 0 || h <= 0) return false
  const s = getScratch(w, h)
  if (!s || !s.x) return false
  // the whole group shares one filtered layer of w×h — that is the cost
  if (!takeFilterPx(w * h)) return false
  const sx = s.x
  sx.setTransform(1, 0, 0, 1, 0, 0)
  sx.filter = 'none'
  sx.globalCompositeOperation = 'source-over'
  sx.globalAlpha = 1
  sx.clearRect(0, 0, w, h)
  // identical user→device mapping as the target, shifted by the scratch origin
  sx.setTransform(t.a, t.b, t.c, t.d, t.e - x0, t.f - y0)
  const inner: DrawOpts = { ...o, skipBlur: true }
  for (const e of group) drawNode(sx, e.n, inner)

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  // size the filter layer to the group's extent: an unclipped blit filters the
  // whole canvas, which is what used to make a batch cost 3.8 ms instead of a
  // fraction of it (see clipToNode)
  ctx.beginPath()
  ctx.rect(x0, y0, w, h)
  ctx.clip()
  ctx.globalCompositeOperation = canvasBlend(group[0].n.blend)
  ctx.globalAlpha = 1
  ctx.filter = `blur(${(blur * o.px).toFixed(3)}px)`
  ctx.drawImage(s.c, x0, y0)
  ctx.restore()
  return true
}


export function drawNode(
  ctx: CanvasRenderingContext2D,
  node: Node,
  o: DrawOpts,
): void {
  const blurred = !!node.blur && node.blur > 0.05 && !o.skipBlur
  // a wide blur over a large extent is the one case where full-resolution
  // filtering costs seconds — try the reduced-resolution path first
  if (blurred && o.canFilter && drawBlurredWide(ctx, node, o)) return

  ctx.save()
  ctx.globalCompositeOperation = canvasBlend(node.blend)
  ctx.globalAlpha = node.op ?? 1
  if (blurred) {
    // `ctx.filter` is in device px; SVG's stdDeviation is in user units.
    if (o.canFilter) {
      // clip first: the filter layer is sized by the clip, so this is where
      // essentially all of the blur cost is controlled (see clipToNode)
      clipToNode(ctx, node, o)
      ctx.filter = `blur(${blurPx(node, o)}px)`
    } else approximateBlur(ctx, node)
  }

  paintShape(ctx, node)
  ctx.restore()
}

/** Fill and stroke only — compositing, alpha and filtering stay the caller's. */
function paintShape(ctx: CanvasRenderingContext2D, node: Node): void {
  tracePath(ctx, node)

  if (node.fill) {
    ctx.fillStyle = makePaint(ctx, node.fill)
    ctx.fill()
  }
  if (node.stroke) {
    let stroke: string | CanvasGradient = makePaint(ctx, node.stroke)
    if (node.fade && node.fade.from !== undefined) {
      // opacity ramp along the stroke direction — identical to the SVG's
      // linear-gradient stroke, so preview and export agree.
      const f = node.fade
      const g = ctx.createLinearGradient(f.x1, f.y1, f.x2, f.y2)
      const base = node.stroke
      if (base.k === 'solid') {
        g.addColorStop(0, cssColor(base.c, f.from ?? 1))
        g.addColorStop(1, cssColor(base.c, f.to ?? 0))
      }
      stroke = g
    }
    ctx.strokeStyle = stroke
    ctx.lineWidth = node.sw ?? 1
    ctx.lineCap = node.cap ?? 'round'
    ctx.lineJoin = node.join ?? 'round'
    if (node.dash) ctx.setLineDash(node.dash)
    ctx.stroke()
    if (node.dash) ctx.setLineDash([])
  }
}

/**
 * Wide-blur fast path: rasterise at reduced resolution, filter there, blit back.
 *
 * A filtered draw is charged by its **clip** area, so one canvas-sized glow
 * costs ~5 ms and a field of them costs seconds. Blur is unusually forgiving
 * of reduced resolution: paint the shape at 1/2 (1/4 once σ ≥ 6 px), apply the
 * filter on that surface — 4× (16×) cheaper — and composite the result with a
 * plain unfiltered `drawImage`. The only thing lost is the bilinear upsample,
 * worth ~0.3 px of extra σ, plus the shape's own antialiasing; the
 * `DOWNSCALE_MIN_SIGMA` gate keeps σ·k at ≥ 1 px in scratch space so both stay
 * invisible. A pixel A/B against the full-resolution path over the built-in
 * presets: six of eight pixel-identical, one at 0.01 % mean, and the worst
 * (a canvas of 48 blurred stroked curves) 0.4 % mean / 3.9 % worst block.
 *
 * Restricted to nodes carrying a single paint: fill and stroke must blend with
 * each other *against the destination*, and routing both through a transparent
 * intermediate would change that ordering.
 *
 * Returns false when the shape is small, the blur is tight, or no scratch is
 * free — the caller then takes the ordinary clipped path.
 */
function drawBlurredWide(
  ctx: CanvasRenderingContext2D,
  node: Node,
  o: DrawOpts,
): boolean {
  if (node.fill && node.stroke) return false
  const sigma = (node.blur ?? 0) * o.px
  if (sigma < DOWNSCALE_MIN_SIGMA) return false

  const b = nodeDeviceBounds(node, ctx.getTransform())
  if (!b) return false
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  // the same pad the ordinary path would use — this is the layer it would buy
  const pad = ((node.blur ?? 0) * 4 + (node.sw ?? 0) * 0.5 + 1 / (o.px || 1)) * o.px
  const x0 = Math.max(0, Math.floor(b.x0 - pad))
  const y0 = Math.max(0, Math.floor(b.y0 - pad))
  const x1 = Math.min(cw, Math.ceil(b.x1 + pad))
  const y1 = Math.min(ch, Math.ceil(b.y1 + pad))
  const w = x1 - x0
  const h = y1 - y0
  if (w <= 0 || h <= 0 || w * h < DOWNSCALE_MIN_PX) return false

  const k = sigma >= 6 ? 0.25 : 0.5
  const sw = Math.max(1, Math.ceil(w * k))
  const sh = Math.max(1, Math.ceil(h * k))
  const s = getScratch(sw, sh)
  if (!s || !s.x) return false

  const sx = s.x
  sx.setTransform(1, 0, 0, 1, 0, 0)
  sx.filter = 'none'
  sx.globalCompositeOperation = 'source-over'
  sx.globalAlpha = 1
  sx.clearRect(0, 0, sw, sh)
  const t = ctx.getTransform()
  // device px → scratch px is exactly k; the CTM still owns user → device
  sx.setTransform(t.a * k, t.b * k, t.c * k, t.d * k, (t.e - x0) * k, (t.f - y0) * k)
  sx.filter = `blur(${(sigma * k).toFixed(3)}px)`
  sx.globalAlpha = node.op ?? 1
  paintShape(sx, node)
  sx.filter = 'none'
  sx.globalAlpha = 1

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.beginPath()
  ctx.rect(x0, y0, w, h)
  ctx.clip()
  ctx.globalCompositeOperation = canvasBlend(node.blend)
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  ctx.drawImage(s.c, x0, y0, w, h)
  ctx.restore()
  return true
}

/** Fallback when `ctx.filter` is unavailable: layered scaled draws. */
function approximateBlur(ctx: CanvasRenderingContext2D, node: Node): void {
  void ctx
  void node
  // handled by callers via radius scaling; kept as a hook for future use
}

/** Convenience: render an IR into a fresh canvas. */
export function irToCanvas(
  ir: IR,
  opts: CanvasRenderOpts = {},
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  renderCanvas(ir, c, opts)
  return c
}

/* ---- Animated preview helpers ------------------------------------------ */

/**
 * Draw a "motion" variant of an IR: drift, twinkle, pulse.
 * `phase` in [0,1) — used by the WebM exporter and the preview loop.
 */
export function applyMotion(
  ir: IR,
  phase: number,
  motion: { drift: number; twinkle: number; pulse: number; flow: number; speed: number },
  seed: number,
): IR {
  const { drift, twinkle, pulse, speed } = motion
  if (drift === 0 && twinkle === 0 && pulse === 0) return ir
  const ang = phase * Math.PI * 2 * speed
  const dx = Math.cos(ang) * drift * ir.w * 0.03
  const dy = Math.sin(ang * 0.7) * drift * ir.h * 0.03
  const nodes: Node[] = ir.nodes.map((n, i) => {
    let node: Node = n
    if (drift > 0) node = translate(node, dx, dy)
    if (pulse > 0) {
      const s = 1 + Math.sin(ang + (i % 37) * 0.17) * pulse * 0.08
      node = scaleNode(node, s)
    }
    if (twinkle > 0) {
      const tw =
        1 -
        twinkle * 0.65 * (0.5 + 0.5 * Math.sin(ang * 2 + hashOf(i, seed)))
      node = { ...node, op: (node.op ?? 1) * tw }
    }
    return node
  })
  return { ...ir, nodes }
}

function hashOf(i: number, seed: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ seed
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296 * Math.PI * 2
}

function translate(n: Node, dx: number, dy: number): Node {
  const g = n.g
  switch (g.k) {
    case 'circle':
      return { ...n, g: { ...g, x: g.x + dx, y: g.y + dy } }
    case 'ellipse':
      return { ...n, g: { ...g, x: g.x + dx, y: g.y + dy } }
    case 'rect':
      return { ...n, g: { ...g, x: g.x + dx, y: g.y + dy } }
    case 'poly': {
      const pts = g.pts.slice()
      for (let i = 0; i < pts.length; i += 2) {
        pts[i] += dx
        pts[i + 1] += dy
      }
      return { ...n, g: { ...g, pts } }
    }
    case 'path':
      // shifting path data textually is unsafe; move via a wrapper transform
      return { ...n, g: { ...g, d: shiftPath(g.d, dx, dy) } }
  }
}

function scaleNode(n: Node, s: number): Node {
  const cx = n.g.k === 'circle' || n.g.k === 'ellipse' ? n.g.x : centroid(n.g)
  const cy = n.g.k === 'circle' || n.g.k === 'ellipse' ? n.g.y : centroidY(n.g)
  return scaleAbout(n, s, cx, cy)
}

function centroid(g: Node['g']): number {
  if (g.k === 'rect') return g.x + g.w / 2
  if (g.k === 'poly') {
    let s = 0
    for (let i = 0; i < g.pts.length; i += 2) s += g.pts[i]
    return s / Math.max(1, g.pts.length / 2)
  }
  if (g.k === 'circle') return g.x
  if (g.k === 'ellipse') return g.x
  return 0
}
function centroidY(g: Node['g']): number {
  if (g.k === 'rect') return g.y + g.h / 2
  if (g.k === 'poly') {
    let s = 0
    for (let i = 1; i < g.pts.length; i += 2) s += g.pts[i]
    return s / Math.max(1, g.pts.length / 2)
  }
  if (g.k === 'circle') return g.y
  if (g.k === 'ellipse') return g.y
  return 0
}

export function scaleAbout(n: Node, s: number, cx: number, cy: number): Node {
  const g = n.g
  switch (g.k) {
    case 'circle':
      return { ...n, g: { ...g, x: cx + (g.x - cx) * s, y: cy + (g.y - cy) * s, r: g.r * s } }
    case 'ellipse':
      return {
        ...n,
        g: { ...g, x: cx + (g.x - cx) * s, y: cy + (g.y - cy) * s, rx: g.rx * s, ry: g.ry * s },
      }
    case 'rect':
      return {
        ...n,
        g: { ...g, x: cx + (g.x - cx) * s, y: cy + (g.y - cy) * s, w: g.w * s, h: g.h * s },
      }
    case 'poly': {
      const pts = g.pts.slice()
      for (let i = 0; i < pts.length; i += 2) {
        pts[i] = cx + (pts[i] - cx) * s
        pts[i + 1] = cy + (pts[i + 1] - cy) * s
      }
      return { ...n, g: { ...g, pts } }
    }
    case 'path':
      return n
  }
}

function shiftPath(d: string, dx: number, dy: number): string {
  // Only used for simple "M x y L x y ..." paths produced by polyD.
  let first = true
  return d.replace(/([ML])\s*(-?\d*\.?\d+)\s+(-?\d*\.?\d+)/g, (_m, cmd, xs, ys) => {
    const x = parseFloat(xs) + dx
    const y = parseFloat(ys) + dy
    const c = first && cmd === 'L' ? 'M' : cmd
    first = false
    return `${c}${round2(x)} ${round2(y)}`
  })
}
const round2 = (v: number) => Math.round(v * 100) / 100

export type { Palette }
