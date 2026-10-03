/**
 * filters/svg.ts — The SVG compiler for the filter stack.
 *
 * One layer's enabled vector-safe filters compile to ONE `<filter>` element
 * with chained primitives (`in` / `result` links). Raster-only filters return
 * null here — the exporter rasterizes that layer to `<image>` instead.
 */

import { getFilter } from './index'
import { nodesContentBounds, renderBounds } from '../render/reach'
import type { Node } from '../ir'
import type { FilterInstance } from './types'

export interface CompiledFilter {
  id: string
  element: string
}

/**
 * The `<filter>` region, as `x` / `y` / `width` / `height` in objectBoundingBox
 * units — the SVG equivalent of the canvas surface `renderBounds` sizes.
 *
 * A fixed `-60 % / 220 %` window looked generous and was not: it is a fraction
 * of the *geometry* box, so a large σ on a small shape (a σ=40 blur on a 60 px
 * particle needs 120 px of reach) ran past the region and was cut off with a
 * hard edge. The region is therefore derived from the same expanded bounds the
 * canvas uses, and floored at the old window so no layer can shrink.
 */
function filterRegion(
  nodes: readonly Node[],
  safe: FilterInstance[],
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const FALLBACK = { x: -0.6, y: -0.6, w: 2.2, h: 2.2 }
  const content = nodesContentBounds(nodes)
  const b = renderBounds(nodes, { filters: safe, spreadCtx: { width, height } })
  if (!content || !b) return FALLBACK
  const cw = Math.max(1e-6, content.x1 - content.x0)
  const ch = Math.max(1e-6, content.y1 - content.y0)
  return {
    x: Math.min(FALLBACK.x, b.x0 - content.x0) / cw,
    y: Math.min(FALLBACK.y, b.y0 - content.y0) / ch,
    w: Math.max(FALLBACK.w, (b.x1 - b.x0) / cw),
    h: Math.max(FALLBACK.h, (b.y1 - b.y0) / ch),
  }
}

/**
 * Compile one layer's stack to a single `<filter>` element.
 * Returns null when there is nothing vector-safe to emit.
 */
export function compileLayerFilter(
  layerId: string,
  filters: FilterInstance[],
  width: number,
  height: number,
  nodes: readonly Node[] = [],
): CompiledFilter | null {
  const safe = filters.filter((f) => {
    if (!f.enabled) return false
    const def = getFilter(f.type)
    return !!def && def.isVectorSafe && !def.rasterOnly
  })
  if (safe.length === 0) return null
  const id = `fx-${sanitizeId(layerId)}`
  const parts: string[] = []
  let input = 'SourceGraphic'
  safe.forEach((f, i) => {
    const def = getFilter(f.type)
    if (!def) return
    const output = i === safe.length - 1 ? 'fx-out' : `fx-${i}`
    const xml = def.toSvg(f.params, { filterId: id, input, output, width, height })
    if (xml) {
      parts.push(xml)
      input = output
    }
  })
  if (parts.length === 0) return null
  const r = filterRegion(nodes, safe, width, height)
  const element =
    `<filter id="${id}" x="${r.x.toFixed(4)}" y="${r.y.toFixed(4)}" ` +
    `width="${r.w.toFixed(4)}" height="${r.h.toFixed(4)}" ` +
    `color-interpolation-filters="sRGB" filterUnits="objectBoundingBox">` +
    parts.join('') +
    `</filter>`
  return { id, element }
}

/** Layers whose enabled stack contains a raster-only filter. */
export function rasterFilteredLayerIds(layers: { id: string; filters?: FilterInstance[]; filtersBypassed?: boolean }[]): Set<string> {
  const out = new Set<string>()
  for (const l of layers) {
    if (l.filtersBypassed) continue
    for (const f of l.filters ?? []) {
      if (!f.enabled) continue
      const def = getFilter(f.type)
      if (def && (!def.isVectorSafe || def.rasterOnly)) {
        out.add(l.id)
        break
      }
    }
  }
  return out
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'layer'
}
