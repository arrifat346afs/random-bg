/**
 * filters/types.ts — Data model for the per-layer filter stack.
 *
 * Filters are data, not code in components: a layer holds `FilterInstance[]`,
 * the registry (`index.ts`) holds the definitions. Both the SVG compiler and
 * the canvas pipeline consume the same array, so preview and export agree.
 */

import type { ParamDef, Params, FilterInstance } from '../schema'

export type { FilterInstance }

export type FilterGroup =
  | 'blur'
  | 'glow'
  | 'color'
  | 'distort'
  | 'texture'
  | 'shape'
  | 'relief'
  | 'raster'

/** Context handed to `toSvg` so primitives can chain with named results. */
export interface FilterSvgCtx {
  /** id of the enclosing `<filter>` element */
  filterId: string
  /** name of the input result (`SourceGraphic` for the first filter) */
  input: string
  /** name this filter must write its output to */
  output: string
  /** canvas size in user units (for region-relative primitives) */
  width: number
  height: number
}

/** Canvas size in IR units, handed to filters whose reach depends on it. */
export interface SpreadCtx {
  width: number
  height: number
}

/**
 * Pluggable filter definition. Pure: no React/DOM/store imports.
 * `apply` works on raw RGBA bytes so it runs in workers, tests and browsers.
 */
export interface FilterDef {
  /** registry key, stable in project JSON */
  type: string
  label: string
  group: FilterGroup
  /** one line for tooltips and docs */
  description: string
  /** false → raster-only: SVG export embeds the layer as `<image>` */
  isVectorSafe: boolean
  /** true → show the "raster" badge in the Add menu */
  rasterOnly: boolean
  /** relative cost 1 (cheap) → 10 (heavy); feeds the budget model */
  cost: number
  /** typed param schema; the inspector is auto-built from this */
  params: ParamDef[]
  /**
   * How far (in canvas units) this filter can push pixels away from their
   * original position — blurs, shadows, glows, displacements. Colour-only
   * filters omit it (they default to 0).
   *
   * **Every filter that moves pixels must declare this.** It is what the canvas
   * backend uses to size the offscreen surface it filters on and the SVG
   * backend's `<filter>` region: too small and the effect is sliced off with a
   * hard straight edge, too big and every filter pays for pixels it never
   * touches. `ctx` carries the canvas size for filters whose reach is relative
   * to it (radial / zoom blur sample out to the farthest corner).
   */
  spread?: (params: Params, ctx: SpreadCtx) => number
  /**
   * SVG primitives for this filter, reading from `ctx.input` and writing to
   * `ctx.output`. Return null when params are identity (e.g. sigma 0).
   */
  toSvg: (params: Params, ctx: FilterSvgCtx) => string | null
  /**
   * Canvas equivalent: pure RGBA transform. Must be deterministic —
   * use the passed `seed`, never `Math.random()`.
   */
  apply: (
    src: Uint8ClampedArray,
    w: number,
    h: number,
    params: Params,
    seed: number,
  ) => Uint8ClampedArray
}

export type { ParamDef, Params }
