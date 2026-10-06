/**
 * render/svg.ts — SVG backend for the same IR the canvas draws.
 *
 * Capability mapping & documented limitations
 * --------------------------------------------
 *  - Gradients      → <linearGradient>/<radialGradient> (identical stops).
 *  - Blur           → <filter><feGaussianBlur color-interpolation-filters="sRGB">
 *                     sRGB keeps blurs premultiplied-friendly, so transparent
 *                     exports do NOT get dark halos.
 *  - Blend modes    → the `mix-blend-mode` presentation attribute (16 of 17
 *                     modes are CSS-native).
 *  - plus-lighter   → browser-only. The attribute carries `screen` and a
 *                     `<style>` rule upgrades browsers to `plus-lighter`, so
 *                     browsers get true additive glow and strict renderers
 *                     (Inkscape/resvg/librsvg) still get `screen` instead of
 *                     silently dropping the blend. `flattenAdditive:true`
 *                     pins `screen` everywhere.
 *  - stroke opacity ramps → linear-gradient stroke (same as canvas).
 *  - Variable-width strokes → never used: generators emit filled outlines.
 * Anything else is rasterised on export (see export.ts).
 */

import { hexToRgb } from '../palette'
import type { BlendMode, GradientStop, IR, Node, Paint, TransformStamp } from '../ir'
import { CANVAS_ONLY_BLENDS } from '../ir'
import type { BackgroundSpec, FilterInstance } from '../schema'
import {
  isIdentityTransform,
  transformAttr,
  type LayerTransform,
  type Pivot,
} from '../transform'
import { compileLayerFilter } from '../filters/svg'

export interface SvgRenderOpts {
  background?: BackgroundSpec
  /** decimal places for coordinates (smaller files) */
  decimals?: number
  /** degrade plus-lighter → screen for non-browser renderers */
  flattenAdditive?: boolean
  /** omit width/height (viewBox only) */
  viewboxOnly?: boolean
  /**
   * Output-size multiplier for the `width`/`height` attributes.
   * The `viewBox` always stays at the canvas size so the artwork itself is
   * unchanged — a 2× SVG is the same vectors, just opened at 2× pixel size.
   */
  scale?: number
  /**
   * Per-layer filter stacks, keyed by layer id. The IR only carries `Node.lid`
   * (which layer a node belongs to), so the actual params travel separately —
   * a node's geometry is cached and reused while its filters change.
   */
  layerFilters?: Record<string, FilterInstance[]>
  /**
   * Pre-rasterised layers, keyed by layer id: `layerId → data URL`.
   *
   * A raster-only filter (motion blur, pixelate, chromatic aberration) has no
   * `<filter>` primitive, so those layers are drawn to a canvas by the caller
   * and embedded here as an `<image>`. Everything else in the file stays
   * vector. `renderSVG` itself stays pure — it never touches a canvas.
   */
  rasterImages?: Record<string, string>
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function fmt(v: number, d: number): string {
  if (!Number.isFinite(v)) return '0'
  const r = Number(v.toFixed(d))
  return String(r)
}

function stopsSvg(stops: GradientStop[]): string {
  return stops
    .map((s) => {
      const [r, g, b] = hexToRgb(s.c)
      const col = `#${hex2(r)}${hex2(g)}${hex2(b)}`
      // Always hex + stop-opacity, never `rgba()`. A `rgba()` colour in a
      // presentation attribute is SVG 2 / CSS Color 4; Inkscape, resvg and
      // librsvg fail to parse it and silently fall back to black, which turns
      // the whole artwork black. Mirrors the solid-fill path in paintAttr().
      const op = Number(s.o.toFixed(4))
      const opAttr = op >= 0.999 ? '' : ` stop-opacity="${op}"`
      return `<stop offset="${fmt(Math.max(0, Math.min(1, s.t)), 4)}" stop-color="${col}"${opAttr}/>`
    })
    .join('')
}
const hex2 = (v: number) =>
  Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')

function paintAttr(
  p: Paint,
  kind: 'fill' | 'stroke',
  defs: Map<string, string>,
  d: number,
): string {
  if (p.k === 'solid') {
    const [r, g, b, a] = hexToRgb(p.c)
    if (a < 0.999) {
      const col = `#${hex2(r)}${hex2(g)}${hex2(b)}`
      return `${kind}="${col}" ${kind}-opacity="${Number(a.toFixed(4))}"`
    }
    return `${kind}="${p.c}"`
  }
  const id = `p${defs.size}`
  // assigned in both branches of the if/else below
  let inner: string
  if (p.k === 'linear') {
    inner =
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
      `x1="${fmt(p.x1, d)}" y1="${fmt(p.y1, d)}" x2="${fmt(p.x2, d)}" y2="${fmt(p.y2, d)}">` +
      stopsSvg(p.stops) +
      '</linearGradient>'
  } else {
    const ri = p.ri ?? 0
    inner =
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
      `cx="${fmt(p.cx, d)}" cy="${fmt(p.cy, d)}" r="${fmt(p.r, d)}"` +
      (ri > 0 ? ` fr="${fmt(ri, d)}"` : '') +
      '>' +
      stopsSvg(p.stops) +
      '</radialGradient>'
  }
  defs.set(id, inner)
  return `${kind}="url(#${id})"`
}

function geoSvg(n: Node, d: number): string {
  const g = n.g
  switch (g.k) {
    case 'circle':
      return `<circle cx="${fmt(g.x, d)}" cy="${fmt(g.y, d)}" r="${fmt(Math.max(0, g.r), d)}"`
    case 'ellipse':
      return (
        `<ellipse cx="${fmt(g.x, d)}" cy="${fmt(g.y, d)}" rx="${fmt(Math.max(0, g.rx), d)}" ry="${fmt(Math.max(0, g.ry), d)}"` +
        (g.rot ? ` transform="rotate(${fmt(g.rot, 2)} ${fmt(g.x, d)} ${fmt(g.y, d)})"` : '')
      )
    case 'rect':
      return (
        `<rect x="${fmt(g.x, d)}" y="${fmt(g.y, d)}" width="${fmt(g.w, d)}" height="${fmt(g.h, d)}"` +
        (g.r ? ` rx="${fmt(g.r, d)}"` : '')
      )
    case 'path':
      return `<path d="${esc(g.d)}"`
    case 'poly': {
      if (g.pts.length < 4) return ''
      let out = ''
      for (let i = 0; i < g.pts.length; i += 2) {
        out += `${i === 0 ? 'M' : 'L'}${fmt(g.pts[i], d)} ${fmt(g.pts[i + 1], d)}`
      }
      return `<path d="${out}Z"`
    }
  }
}

const blendCss = (b: BlendMode, flattenAdditive: boolean): string => {
  if (!b || b === 'normal') return ''
  if (b === 'plus-lighter') return flattenAdditive ? 'screen' : 'plus-lighter'
  return b
}

/**
 * Render nodes to SVG body strings, sharing `defs`/`filters` maps.
 * Exported so the per-layer filter compiler can group one layer's nodes
 * under a single `<g filter>` without duplicating node rendering.
 */
export function nodesToSvg(
  nodes: Node[],
  d: number,
  defs: Map<string, string>,
  filters: Map<string, string>,
  opts: { flattenAdditive?: boolean } = {},
): { body: string[]; hasAdditive: boolean } {
  const body: string[] = []
  let hasAdditive = false
  for (const node of nodes) {
    const geo = geoSvg(node, d)
    if (!geo) continue
    const attrs: string[] = []
    if (node.fade && node.stroke && node.stroke.k === 'solid' && node.fade.from !== undefined) {
      // stroke opacity ramp → gradient stroke
      const id = `f${defs.size}`
      const [r, g, b] = hexToRgb(node.stroke.c)
      const col = `#${hex2(r)}${hex2(g)}${hex2(b)}`
      defs.set(
        id,
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(node.fade.x1, d)}" ` +
          `y1="${fmt(node.fade.y1, d)}" x2="${fmt(node.fade.x2, d)}" y2="${fmt(node.fade.y2, d)}">` +
          `<stop offset="0" stop-color="${col}" stop-opacity="${Number((node.fade.from ?? 1).toFixed(4))}"/>` +
          `<stop offset="1" stop-color="${col}" stop-opacity="${Number((node.fade.to ?? 0).toFixed(4))}"/>` +
          `</linearGradient>`,
      )
      attrs.push(`stroke="url(#${id})"`)
    } else if (node.stroke) {
      attrs.push(paintAttr(node.stroke, 'stroke', defs, d))
    }

    if (node.fill) attrs.push(paintAttr(node.fill, 'fill', defs, d))
    if (!node.fill && !node.stroke) attrs.push('fill="none"')
    if (node.stroke && node.sw) attrs.push(`stroke-width="${fmt(node.sw, 3)}"`)
    if (node.cap && node.cap !== 'round') attrs.push(`stroke-linecap="${node.cap}"`)
    if (node.join && node.join !== 'round') attrs.push(`stroke-linejoin="${node.join}"`)
    if (node.dash) attrs.push(`stroke-dasharray="${node.dash.map((v) => fmt(v, 2)).join(' ')}"`)
    if (node.op !== undefined && node.op < 0.999) attrs.push(`opacity="${Number(node.op.toFixed(4))}"`)
    // Manual layer placement. An element transform applies to the same user
    // space the stroke-fade gradient's userSpaceOnUse stops live in, so the
    // opacity ramp stays aligned with the stroke.
    const place = nodePlacementAttr(node)
    if (place) attrs.push(`transform="${place}"`)

    // Blend and filter go out as *presentation attributes*, which every
    // renderer understands, rather than CSS in a style="" attribute.
    const flatten = opts.flattenAdditive ?? false
    const blend = blendCss(node.blend ?? 'normal', flatten)
    if (blend) {
      if (!flatten && blend === 'plus-lighter') {
        // `plus-lighter` is browser-only: Inkscape/resvg/librsvg don't know the
        // value and render the node unblended, which flattens every additive
        // glow. So the attribute carries the universally-supported `screen`
        // fallback and a <style> rule upgrades browsers to true additive —
        // CSS outranks presentation attributes in the cascade, and renderers
        // that ignore the stylesheet keep `screen`.
        attrs.push('mix-blend-mode="screen"', 'class="additive"')
        hasAdditive = true
      } else {
        attrs.push(`mix-blend-mode="${blend}"`)
      }
    }
    if (node.blur && node.blur > 0.05) {
      const key = `b${Math.round(node.blur * 100)}`
      if (!filters.has(key)) {
        filters.set(
          key,
          `<filter id="${key}" x="-60%" y="-60%" width="220%" height="220%" ` +
            `color-interpolation-filters="sRGB" filterUnits="objectBoundingBox">` +
            `<feGaussianBlur stdDeviation="${fmt(node.blur, 2)}"/></filter>`,
        )
      }
      attrs.push(`filter="url(#${key})"`)
    }

    body.push(`${geo} ${attrs.join(' ')}/>`)
  }
  return { body, hasAdditive }
}

/**
 * The SVG `transform` for a node's layer placement, or '' when it is identity.
 *
 * The composition order matches the canvas exactly — translate, then
 * translate(pivot) · rotate · scale · translate(-pivot) — so a scaled or rotated
 * layer exports to the same pixels the preview showed. See `transform.ts`.
 */
export function nodePlacementAttr(n: { tx?: number; ty?: number; tr?: TransformStamp }): string {
  const t: LayerTransform = {
    x: n.tx ?? 0,
    y: n.ty ?? 0,
    scaleX: n.tr?.scaleX ?? 1,
    scaleY: n.tr?.scaleY ?? 1,
    rotation: n.tr?.rotation ?? 0,
  }
  if (isIdentityTransform(t)) return ''
  const pivot: Pivot = { x: n.tr?.px ?? 0, y: n.tr?.py ?? 0 }
  return transformAttr(t, pivot)
}

export function renderSVG(ir: IR, opts: SvgRenderOpts = {}): string {
  const d = opts.decimals ?? 2
  const defs = new Map<string, string>()
  const filters = new Map<string, string>()
  /** any node relying on the <style> plus-lighter upgrade? */
  let hasAdditive = false

  const body: string[] = []

  // background
  if (opts.background) {
    const bg = opts.background
    if (bg.kind === 'solid') {
      body.push(`<rect width="100%" height="100%" fill="${bg.color}"/>`)
    } else if (bg.kind === 'gradient') {
      const id = 'bggrad'
      defs.set(
        id,
        `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(${bg.angle - 90} .5 .5)">` +
          `<stop offset="0" stop-color="${bg.from}"/><stop offset="1" stop-color="${bg.to}"/></linearGradient>`,
      )
      body.push(`<rect width="100%" height="100%" fill="url(#${id})"/>`)
    } else if (bg.kind === 'noise') {
      body.push(`<rect width="100%" height="100%" fill="${bg.color}"/>`)
      // Noise backgrounds are raster-only by nature; approximated with a
      // documented <feTurbulence> overlay.
      defs.set(
        'bgturb',
        `<filter id="bgturb" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
          `<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7"/>` +
          `<feColorMatrix type="saturate" values="0"/></filter>`,
      )
      body.push(
        `<rect width="100%" height="100%" filter="url(#bgturb)" opacity="${Math.min(0.5, bg.amount)}"/>`,
      )
    }
  }

  // Nodes arrive grouped by layer: `composeIR` stamps `lid` on every node of a
  // filtered layer and leaves it off everything else, so a contiguous run with
  // the same `lid` is exactly one layer's geometry. Each such run becomes a
  // single `<g filter>` over one chained `<filter>` — Illustrator semantics.
  for (const run of groupByLayer(ir.nodes)) {
    // A layer whose stack needs rasterising arrives pre-rendered from
    // `projectToSvg`; emit it as an <image> rather than silently dropping the
    // filter on the floor.
    const dataUrl = run.lid ? opts.rasterImages?.[run.lid] : undefined
    if (run.lid && dataUrl) {
      const placement = run.nodes[0] ? nodePlacementAttr(run.nodes[0]) : ''
      const transform = placement ? ` transform="${placement}"` : ''
      body.push(
        `<g${transform}><image href="${esc(dataUrl)}" x="0" y="0" ` +
          `width="${fmt(ir.w, 2)}" height="${fmt(ir.h, 2)}" ` +
          `preserveAspectRatio="none"/></g>`,
      )
      continue
    }
    const { body: runBody, hasAdditive: runAdditive } = nodesToSvg(run.nodes, d, defs, filters, {
      flattenAdditive: opts.flattenAdditive ?? false,
    })
    hasAdditive ||= runAdditive
    if (!run.lid) {
      body.push(...runBody)
      continue
    }
    const compiled = compileLayerFilter(run.lid, opts.layerFilters?.[run.lid] ?? [], ir.w, ir.h, run.nodes)
    if (!compiled) {
      body.push(...runBody)
      continue
    }
    if (!filters.has(compiled.id)) filters.set(compiled.id, compiled.element)
    body.push(`<g filter="url(#${compiled.id})">${runBody.join('')}</g>`)
  }

  const allDefs = [...defs.values(), ...filters.values()].join('')
  const outW = Math.max(1, Math.round(ir.w * (opts.scale ?? 1)))
  const outH = Math.max(1, Math.round(ir.h * (opts.scale ?? 1)))
  const wAttr = opts.viewboxOnly ? '' : ` width="${outW}" height="${outH}"`
  const defsBlock = allDefs ? `<defs>${allDefs}</defs>` : ''
  // Only emitted when something needs it, so additive-free exports are unchanged.
  const styleBlock = hasAdditive ? `<style>.additive{mix-blend-mode:plus-lighter}</style>` : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${wAttr} ` +
    `viewBox="0 0 ${fmt(ir.w, 0)} ${fmt(ir.h, 0)}" ` +
    `xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `shape-rendering="geometricPrecision">` +
    `<g style="isolation:isolate">` +
    styleBlock +
    defsBlock +
    body.join('') +
    `</g></svg>`
  )
}

/**
 * Split a flat node list into contiguous runs. Nodes carrying the same `lid`
 * group together; a run of unlabelled nodes (every filter-free layer) is kept
 * whole so the common case still emits one flat body with no wrapper elements.
 */
export function groupByLayer(nodes: Node[]): { lid?: string; nodes: Node[] }[] {
  const runs: { lid?: string; nodes: Node[] }[] = []
  let cur: { lid?: string; nodes: Node[] } | null = null
  let curLid: string | undefined
  for (const n of nodes) {
    const lid = n.lid
    if (!cur || lid !== curLid) {
      cur = { lid, nodes: [] }
      curLid = lid
      runs.push(cur)
    }
    cur.nodes.push(n)
  }
  return runs
}

/** Does this IR need an SVG capability caveat? Used by the export dialog. */
export function svgCaveats(ir: IR): string[] {
  const out: string[] = []
  if (ir.stats.additive)
    out.push(
      '`plus-lighter` glow is exported as `mix-blend-mode="screen"` plus a `<style>` rule that upgrades browsers to `plus-lighter`. Browsers get true additive blending; Inkscape, resvg and librsvg keep `screen` rather than dropping the blend entirely.',
    )
  if (ir.stats.blurs > 0)
    out.push(
      `${ir.stats.blurs} blurred node(s) use <feGaussianBlur> with sRGB colour space to keep transparent exports halo-free.`,
    )
  return out
}

export function irToSVGString(ir: IR, opts: SvgRenderOpts = {}): string {
  return renderSVG(ir, opts)
}

export type { BlendMode }
export { CANVAS_ONLY_BLENDS }
