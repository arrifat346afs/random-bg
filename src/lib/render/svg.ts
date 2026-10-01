/**
 * render/svg.ts — SVG backend for the same IR the canvas draws.
 *
 * Capability mapping & documented limitations
 * --------------------------------------------
 *  - Gradients      → <linearGradient>/<radialGradient> (identical stops).
 *  - Blur           → <filter><feGaussianBlur color-interpolation-filters="sRGB">
 *                     sRGB keeps blurs premultiplied-friendly, so transparent
 *                     exports do NOT get dark halos.
 *  - Blend modes    → CSS `mix-blend-mode` (16 of 17 modes are CSS-native).
 *  - plus-lighter   → emitted as CSS `mix-blend-mode:plus-lighter`, which
 *                     browsers support; with `flattenAdditive:true` it degrades
 *                     to `screen` for strict renderers (resvg/librsvg).
 *  - stroke opacity ramps → linear-gradient stroke (same as canvas).
 *  - Variable-width strokes → never used: generators emit filled outlines.
 * Anything else is rasterised on export (see export.ts).
 */

import { hexToRgb } from '../palette'
import type { BlendMode, GradientStop, IR, Node, Paint } from '../ir'
import { CANVAS_ONLY_BLENDS } from '../ir'
import type { BackgroundSpec } from '../schema'

export interface SvgRenderOpts {
  background?: BackgroundSpec
  /** decimal places for coordinates (smaller files) */
  decimals?: number
  /** degrade plus-lighter → screen for non-browser renderers */
  flattenAdditive?: boolean
  /** omit width/height (viewBox only) */
  viewboxOnly?: boolean
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
      const a = s.o
      const color =
        a >= 0.999
          ? `#${hex2(r)}${hex2(g)}${hex2(b)}`
          : `rgba(${r},${g},${b},${Number(a.toFixed(4))})`
      return `<stop offset="${fmt(Math.max(0, Math.min(1, s.t)), 4)}" stop-color="${color}"/>`
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

export function renderSVG(ir: IR, opts: SvgRenderOpts = {}): string {
  const d = opts.decimals ?? 2
  const defs = new Map<string, string>()
  const filters = new Map<string, string>()

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

  for (const node of ir.nodes) {
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

    const styles: string[] = []
    const blend = blendCss(node.blend ?? 'normal', opts.flattenAdditive ?? false)
    if (blend) styles.push(`mix-blend-mode:${blend}`)
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
      styles.push(`filter:url(#${key})`)
    }
    if (styles.length) attrs.push(`style="${styles.join(';')}"`)

    body.push(`${geo} ${attrs.join(' ')}/>`)
  }

  const allDefs = [...defs.values(), ...filters.values()].join('')
  const wAttr = opts.viewboxOnly ? '' : ` width="${fmt(ir.w, 0)}" height="${fmt(ir.h, 0)}"`
  const defsBlock = allDefs ? `<defs>${allDefs}</defs>` : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${wAttr} ` +
    `viewBox="0 0 ${fmt(ir.w, 0)} ${fmt(ir.h, 0)}" ` +
    `xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `shape-rendering="geometricPrecision">` +
    `<g style="isolation:isolate">` +
    defsBlock +
    body.join('') +
    `</g></svg>`
  )
}

/** Does this IR need an SVG capability caveat? Used by the export dialog. */
export function svgCaveats(ir: IR): string[] {
  const out: string[] = []
  if (ir.stats.additive)
    out.push(
      '`plus-lighter` blending is emitted as CSS `mix-blend-mode:plus-lighter`. Browsers render it correctly; strict SVG rasterisers (resvg, librsvg) fall back to `screen`.',
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
