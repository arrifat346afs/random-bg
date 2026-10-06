/**
 * render/canvas.ts — Canvas2D backend for the IR.
 *
 * Blend modes map to `globalCompositeOperation`, blurs to `ctx.filter`, and
 * gradients are built from the same stop data the SVG backend uses, so the
 * preview and the export stay visually identical.
 *
 * Every clip and every offscreen surface in here is sized by `renderBounds`
 * (./bounds) — the one function that knows how far a layer's pixels can reach.
 * Never derive a clip from a node's bare geometry: a blur, glow, shadow or
 * displacement that reaches the edge of an internal rectangle is cut off with a
 * hard straight edge instead of fading out.
 */

import { hexToRgb, type Palette } from '../palette'
import { createRng, hash32 } from '../rng'
import type { BlendMode, IR, Node, Paint, TransformStamp } from '../ir'
import type { BackgroundSpec, FilterInstance } from '../schema'
import { applyFilterStack } from '../filters/canvas'
import {
  ANTIALIAS_SLACK_PX,
  deviceBounds,
  nodeLocalBounds,
  renderBounds,
  surfaceRect,
} from './reach'
import { growRect, padRect, rectArea, type Rect } from './bounds'
import { drawSvgPath } from './path'
import { triangularDither } from './dither'
import { stampMatrix } from '../transform'
import {
  SURFACE_PX_CEILING,
  acquireScratch,
  fitDownscale,
  releaseAllScratches,
  releaseScratch,
  type Surface,
} from './scratch'

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
  /** per-layer filter stacks; omit for an unfiltered render */
  filters?: FilterRenderOpts
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
  filters?: FilterRenderOpts,
): void {
  ctx.save()
  ctx.scale(scale, scale)
  if (background) drawBackground(ctx, ir.w, ir.h, background)
  drawNodes(ctx, ir.nodes, makeOpts(ctx, ir.nodes, filters))
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
  drawNodes(ctx, ir.nodes, makeOpts(ctx, ir.nodes, opts.filters))
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
  /**
   * Per-layer filter stacks keyed by layer id. A node's `lid` selects which
   * stack (if any) applies; layers absent from this map draw unfiltered, so
   * omitting it entirely reproduces the pre-filter path exactly.
   */
  layerFilters?: Record<string, FilterInstance[]>
  /** per-layer deterministic seed for noise filters (see `filters/kit.ts`) */
  filterSeedOf?: (layerId: string) => number
  /** layer ids whose offscreen raster gets triangular dither (see FilterRenderOpts) */
  ditherLayers?: ReadonlySet<string>
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

/**
 * Drop every pooled offscreen surface — called after large one-shot renders so
 * a 4K export does not keep ~64 MB of scratch alive.
 */
export function releaseRenderScratch(): void {
  releaseAllScratches()
}

function makeOpts(
  ctx: CanvasRenderingContext2D,
  nodes: Node[],
  filters?: FilterRenderOpts,
): DrawOpts {
  const t = ctx.getTransform()
  return {
    canFilter: supportsFilter(ctx),
    hasFade: nodes.some((n) => n.fade),
    px: Math.hypot(t.a, t.b) || 1,
    layerFilters: filters?.layerFilters,
    filterSeedOf: filters?.filterSeedOf,
    ditherLayers: filters?.ditherLayers,
  }
}

/** Filter stacks to apply, keyed by layer id. */
export interface FilterRenderOpts {
  layerFilters?: Record<string, FilterInstance[]>
  filterSeedOf?: (layerId: string) => number
  /**
   * Layer ids whose offscreen raster gets deterministic triangular dither
   * (smooth wallpaper fields). Present-but-unfiltered layers still route
   * offscreen; absent layers draw direct, exactly as before.
   */
  ditherLayers?: ReadonlySet<string>
}

/** `blur()` in device px that reproduces SVG's `stdDeviation` in user units. */
const blurPx = (node: Node, o: DrawOpts): string =>
  ((node.blur ?? 0) * o.px).toFixed(3)

/**
 * Intersect the clip with this node's own extent before a filtered draw.
 *
 * `ctx.filter` rasterises into a temporary layer sized by the **clip**, not by
 * the shape — on a software rasteriser a blur over a 719² surface costs ~3.8 ms,
 * the same blur clipped to a 40² box around the shape costs ~0.03 ms (130×
 * cheaper). So the clip is worth having, but it must be the node's *expanded*
 * extent (`nodeLocalBounds`: geometry + stroke + 3σ of its own blur), never its
 * bare geometry — clipping to the geometry sliced the glow off at the shape's
 * own rectangle.
 *
 * The rect is expressed in user units, so the CTM's translate/scale applies to
 * it exactly as it does to the shape. Returns false when the extent is
 * undeterminable, in which case the clip is left alone — correct, just slow.
 */
function clipToNode(ctx: CanvasRenderingContext2D, node: Node): boolean {
  const b = nodeLocalBounds(node)
  if (!b) return false
  ctx.beginPath()
  ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0)
  ctx.clip()
  return true
}

/**
 * Device pixels the filtered layer for this node will cover — the quantity that
 * actually decides render time. Priced from the same expanded extent the clip
 * uses, so the estimate and the draw can never disagree. Unknown extents cost a
 * full canvas.
 */
function deviceFilterArea(ctx: CanvasRenderingContext2D, node: Node): number {
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  const b = nodeLocalBounds(node)
  if (!b) return cw * ch
  // one device pixel of antialias slack, expressed in user units
  const d = deviceBounds(padRect(b, 1 / (ctx.getTransform().a || 1)), ctx.getTransform())
  return Math.min(rectArea(d), cw * ch)
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
    // Layer placement. Nodes are emitted layer by layer, so a contiguous run
    // shares one transform — apply it once for the run rather than paying a
    // save/restore per primitive.
    //
    // The matrix goes on the CTM *before* anything else in the run, including
    // the filtered-run branch. That ordering is what keeps every downstream
    // calculation correct for free: `renderBounds` measures in the layer's own
    // (untransformed) space and `deviceBounds` maps through the real matrix, so
    // a scaled or rotated layer's filter surface and clip are neither too small
    // nor rotated twice.
    const place = runTransform(nodes[i])
    let end = i
    while (end < nodes.length && sameTransform(nodes[end], nodes[i])) end++

    if (place) {
      ctx.save()
      applyPlace(ctx, place)
    }

    const lid = nodes[i].lid
    const filters = lid ? o.layerFilters?.[lid] : undefined
    const dither = lid ? o.ditherLayers?.has(lid) === true : false
    if (lid && ((filters && filters.length > 0) || dither)) {
      // The whole run is one layer's geometry. Rasterise it offscreen and
      // filter as a unit — the same thing SVG does with `<g filter>`.
      // Dither-only layers (no filter stack) take the same offscreen road so
      // the ±0.5 LSB triangular dither lands on final pixels, once.
      drawFilteredRun(ctx, nodes, i, end, filters ?? [], o, dither ? (o.filterSeedOf?.(lid) ?? 0) : null)
      if (place) ctx.restore()
      i = end
      continue
    }

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
        if (ops < MAX_FILTERED_OPS && takeFilterPx(deviceFilterArea(ctx, node))) {
          ops++
          drawNode(ctx, node, o)
        } else drawNode(ctx, node, { ...o, skipBlur: true })
        j++
        continue
      }
      drawNode(ctx, node, o)
      j++
    }

    if (place) ctx.restore()
    i = end
  }
  return ops
}

/** A node's placement, or null when it sits at the identity. */
interface RunPlace {
  tx: number
  ty: number
  tr: TransformStamp | null
}

/** The placement stamped on the first node of a run. */
function runTransform(n: Node): RunPlace | null {
  const tx = n.tx ?? 0
  const ty = n.ty ?? 0
  const tr = n.tr ?? null
  if (tx === 0 && ty === 0 && !tr) return null
  return { tx, ty, tr }
}

/**
 * Two nodes belong to the same run when their placement **and** their owning
 * layer are identical.
 *
 * `lid` has to be part of this: two untransformed layers both carry
 * `tx = 0, ty = 0, tr = undefined`, so grouping on placement alone would fuse
 * neighbouring layers into one run — and the fused run would then be filtered
 * with the *first* layer's stack.
 */
function sameTransform(a: Node, b: Node): boolean {
  return (
    (a.tx ?? 0) === (b.tx ?? 0) &&
    (a.ty ?? 0) === (b.ty ?? 0) &&
    a.tr === b.tr &&
    a.lid === b.lid
  )
}

/**
 * Put a run's placement on the CTM.
 *
 * `tr` is compared by reference: `composeIR` freezes one stamp per layer and
 * shares it across that layer's nodes, so identity is a pointer compare and a
 * 40k-node layer never re-applies the matrix. `stampMatrix` is the same function
 * the SVG backend and the tests use, so preview and export cannot disagree.
 */
function applyPlace(ctx: CanvasRenderingContext2D, p: RunPlace): void {
  if (p.tr) ctx.transform(...matrixOf(p.tx, p.ty, p.tr))
  else ctx.translate(p.tx, p.ty)
}

/** `ctx.transform` wants positional args; the matrix is an object. */
function matrixOf(tx: number, ty: number, tr: TransformStamp): [number, number, number, number, number, number] {
  const m = stampMatrix(tx, ty, tr)
  return [m.a, m.b, m.c, m.d, m.e, m.f]
}

/**
 * Render one layer's nodes offscreen, run the filter stack over the pixels, and
 * composite the result — the canvas half of the pair whose SVG half is
 * `<g filter="url(#…)">`.
 *
 * Compositing deliberately mirrors SVG exactly: node blend modes stay *inside*
 * the offscreen surface (so additive glow still accumulates), and the filtered
 * surface lands on the backdrop `source-over`. That is what makes preview and
 * export agree without either backend needing to know about the other's
 * grouping rules.
 *
 * The surface and the composite clip are **the same rectangle**, and that
 * rectangle comes from `renderBounds`: the run's geometry grown by every node's
 * stroke and blur and by every filter's declared `spread`, then clamped to the
 * canvas. Nothing else may size it. When it did not — when the margin was
 * derived from the geometry alone — a blurred additive layer was sliced along
 * the surface's own edge with a hard, straight seam.
 *
 * The surface is borrowed from the depth-indexed pool, because the nested
 * `drawNodes` below may itself want a surface (a `drawBlurredWide` or
 * `drawBatch` node) and must never be handed the one in use here.
 */
function drawFilteredRun(
  ctx: CanvasRenderingContext2D,
  nodes: Node[],
  i: number,
  j: number,
  filters: FilterInstance[],
  o: DrawOpts,
  ditherSeed: number | null,
): void {
  const t = ctx.getTransform()
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  const run = nodes.slice(i, j)

  // The run loop puts the layer's placement on the CTM before this branch, so
  // every node below is measured and drawn in the layer's own space. Measuring
  // the stamped nodes here would add their `tx`/`ty` on top of a CTM that
  // already carries them — translating the surface twice — and drawing them
  // stamped would transform the layer twice. Strip both, once.
  const unplaced = run.map((n) =>
    n.tx || n.ty || n.tr ? { ...n, tx: 0, ty: 0, tr: undefined } : n,
  )

  // One rect for the surface *and* the composite clip, from the one bounds
  // function. The nodes are measured in the layer's own space — the CTM already
  // carries the placement — so a scaled or rotated layer needs no special case
  // here and its spread is scaled by the real matrix rather than by `m.a`.
  //
  // The clamp is the canvas in IR units, which is the device size divided by
  // the *export* scale (`o.px`) — not by the CTM's full scale. The CTM includes
  // the layer's own matrix, so dividing by it would shrink the clamp by the
  // layer's scale and slice the surface (a 1.6× layer lost its bottom half).
  const px = o.px || 1
  const spreadCtx = { width: Math.max(1, cw / px), height: Math.max(1, ch / px) }
  const expanded = renderBounds(unplaced, {
    filters,
    width: spreadCtx.width,
    height: spreadCtx.height,
    spreadCtx,
  })
  const rect = expanded
    ? surfaceRect(deviceBounds(expanded, t), cw, ch)
    : surfaceRect({ x0: 0, y0: 0, x1: cw, y1: ch }, cw, ch)
  if (!rect) return
  const { x0, y0, x1, y1 } = rect
  const w = x1 - x0
  const h = y1 - y0

  const s = acquireScratch(w, h)
  if (!s || !s.x) {
    // No canvas to filter on (headless). Draw unfiltered rather than dropping
    // the layer — the filters need real pixels, and there are none here.
    drawRunPlain(ctx, nodes, i, j, o)
    return
  }

  try {
    const sx = s.x
    sx.setTransform(1, 0, 0, 1, 0, 0)
    sx.filter = 'none'
    sx.globalCompositeOperation = 'source-over'
    sx.globalAlpha = 1
    sx.clearRect(0, 0, w, h)
    // identical user→device mapping as the target, shifted by the surface origin
    sx.setTransform(t.a, t.b, t.c, t.d, t.e - x0, t.f - y0)
    // The nested draw must not re-arm the global pixel budget, or a layer with
    // a filter stack would get a fresh one and blow the ceiling.
    const budget = filterPxLeft
    drawNodes(sx, unplaced, { ...o, skipBlur: false, layerFilters: undefined, ditherLayers: undefined })
    filterPxLeft = budget

    const filtered = applyOffscreen(s, w, h, filters, nodes[i].lid ?? '', o, ditherSeed)

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.beginPath()
    ctx.rect(x0, y0, w, h)
    ctx.clip()
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.filter = 'none'
    ctx.drawImage(filtered, x0, y0)
    ctx.restore()
  } finally {
    releaseScratch(s)
  }
}

/** Apply the stack to an offscreen surface, returning the surface to blit. */
function applyOffscreen(
  s: Surface,
  w: number,
  h: number,
  filters: FilterInstance[],
  lid: string,
  o: DrawOpts,
  ditherSeed: number | null,
): HTMLCanvasElement {
  const sx = s.x
  if (!sx) return s.c
  const img = sx.getImageData(0, 0, w, h)
  const seed = o.filterSeedOf?.(lid) ?? 0
  const out = applyFilterStack(img.data, w, h, filters, seed)
  img.data.set(out)
  // dither lands on final pixels, once, after every filter
  if (ditherSeed !== null) triangularDither(img.data, w, h, ditherSeed)
  sx.setTransform(1, 0, 0, 1, 0, 0)
  sx.putImageData(img, 0, 0)
  return s.c
}

/**
 * Unfiltered fallback for a run.
 *
 * The layer's placement is already on the CTM (see `applyPlace`), so this only
 * has to draw the shapes in order.
 */
function drawRunPlain(
  ctx: CanvasRenderingContext2D,
  nodes: Node[],
  i: number,
  j: number,
  o: DrawOpts,
): void {
  const inner: DrawOpts = { ...o, layerFilters: undefined, ditherLayers: undefined }
  for (let k = i; k < j; k++) drawNode(ctx, nodes[k], inner)
}

/**
 * A blurred node plus its device-space extent (null when undeterminable).
 * The extent is the node's *expanded* bounds — geometry plus stroke plus its own
 * blur reach — because it is what the batch surface and its clip are sized from.
 */
interface Blurred {
  n: Node
  b: Rect | null
}

/** Node extent (expanded) mapped through the current transform. */
function nodeDeviceBounds(n: Node, t: { a: number; b: number; c: number; d: number; e: number; f: number }): Rect | null {
  const b = nodeLocalBounds(n)
  if (!b) return null
  return deviceBounds(b, t)
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

  // extent of the run in device space. Each member's rect is already grown by
  // its own stroke and 3σ of blur, so the union needs no further padding.
  const union: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  let complete = true
  for (const e of blurred) {
    if (!e.b) complete = false
    else growRect(union, e.b)
  }
  if (!complete || !Number.isFinite(union.x0)) {
    union.x0 = 0
    union.y0 = 0
    union.x1 = cw
    union.y1 = ch
  }

  // Tile the run when one surface would exceed the memory ceiling: tiles keep
  // peak extra memory bounded without inflating the batch count much.
  const uw = Math.max(1, union.x1 - union.x0)
  const uh = Math.max(1, union.y1 - union.y0)
  const tiles = Math.min(8, Math.max(1, Math.ceil((uw * uh) / SURFACE_PX_CEILING)))
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
      growRect(hit.rect, e.b)
    } else {
      groups.set(key, { list: [e], rect: { ...e.b } })
    }
  }

  for (const group of groups.values()) {
    // One filtered layer of the group's extent, or one clipped filter per
    // member. Whichever covers fewer pixels wins — a dense field of tiny
    // sparks is cheaper one-by-one, a handful of canvas-sized veils is not.
    const area = groupArea(ctx, group.rect)
    let members = 0
    for (const e of group.list) members += deviceFilterArea(ctx, e.n)
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
    if (ops < MAX_FILTERED_OPS && takeFilterPx(deviceFilterArea(ctx, e.n))) {
      ops++
      drawNode(ctx, e.n, o)
    } else drawNode(ctx, e.n, { ...o, skipBlur: true })
  }
  return ops - opsIn
}

/**
 * Device pixels one filtered layer would cover for a group of this extent.
 *
 * Priced from the *same* rect `drawBatch` allocates, so "is one batch cheaper
 * than N clipped draws?" is answered with the numbers that will actually be
 * spent — the two used to re-derive the margin separately and could disagree.
 */
function groupArea(ctx: CanvasRenderingContext2D, rect: Rect): number {
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  const r = surfaceRect(padRect(rect, ANTIALIAS_SLACK_PX), cw, ch)
  return r ? Math.min(rectArea(r), cw * ch) : Infinity
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
  // every member's rect already includes its own 3σ of blur, so the union needs
  // only antialias slack — re-deriving the margin here is what used to make the
  // batch surface smaller than the blur it was about to apply.
  const rect: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (const e of group) if (e.b) growRect(rect, e.b)
  if (!Number.isFinite(rect.x0)) return false
  const surf = surfaceRect(padRect(rect, ANTIALIAS_SLACK_PX), cw, ch)
  if (!surf) return false
  const { x0, y0, x1, y1 } = surf
  const w = x1 - x0
  const h = y1 - y0
  const s = acquireScratch(w, h)
  if (!s || !s.x) return false
  try {
    // the whole group shares one filtered layer of w×h — that is the cost
    if (!takeFilterPx(w * h)) return false
    const sx = s.x
    sx.setTransform(1, 0, 0, 1, 0, 0)
    sx.filter = 'none'
    sx.globalCompositeOperation = 'source-over'
    sx.globalAlpha = 1
    sx.clearRect(0, 0, w, h)
    // identical user→device mapping as the target, shifted by the surface origin
    sx.setTransform(t.a, t.b, t.c, t.d, t.e - x0, t.f - y0)
    const inner: DrawOpts = { ...o, skipBlur: true }
    for (const e of group) drawNode(sx, e.n, inner)

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    // size the filter layer to the group's expanded extent: an unclipped blit
    // filters the whole canvas, which is what used to make a batch cost 3.8 ms
    // instead of a fraction of it (see clipToNode)
    ctx.beginPath()
    ctx.rect(x0, y0, w, h)
    ctx.clip()
    ctx.globalCompositeOperation = canvasBlend(group[0].n.blend)
    ctx.globalAlpha = 1
    ctx.filter = `blur(${(blur * o.px).toFixed(3)}px)`
    ctx.drawImage(s.c, x0, y0)
    ctx.restore()
  } finally {
    releaseScratch(s)
  }
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
      clipToNode(ctx, node)
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

  const b = nodeLocalBounds(node)
  if (!b) return false
  const t = ctx.getTransform()
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  // the node's *expanded* extent (geometry + stroke + 3σ), in device px — the
  // same rect the ordinary clipped path would buy, so the two agree pixel for
  // pixel. Deriving it from the bare geometry instead is what put the seam on
  // this path's own clip boundary.
  const surf = surfaceRect(deviceBounds(b, t), cw, ch)
  if (!surf) return false
  const { x0, y0, x1, y1 } = surf
  const w = x1 - x0
  const h = y1 - y0
  if (w * h < DOWNSCALE_MIN_PX) return false

  // Reduce quality rather than crop when the surface would blow the memory
  // ceiling: shrink k until it fits. The blur still covers 3σ at the new k.
  let k = sigma >= 6 ? 0.25 : 0.5
  k = fitDownscale(w, h, k)
  if (w * k < 1 || h * k < 1) return false
  const sw = Math.max(1, Math.ceil(w * k))
  const sh = Math.max(1, Math.ceil(h * k))
  const s = acquireScratch(sw, sh)
  if (!s || !s.x) return false

  try {
    const sx = s.x
    sx.setTransform(1, 0, 0, 1, 0, 0)
    sx.filter = 'none'
    sx.globalCompositeOperation = 'source-over'
    sx.globalAlpha = 1
    sx.clearRect(0, 0, sw, sh)
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
  } finally {
    releaseScratch(s)
  }
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
