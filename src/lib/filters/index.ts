/**
 * filters/index.ts — The filter registry.
 *
 * ADDING A FILTER
 * ---------------
 *  1. Create `src/lib/filters/<group>/<name>.ts` exporting a `FilterDef`
 *     (see `blur/gaussian.ts` for the minimal shape).
 *  2. Import it below and add it to `FILTERS`.
 * That's it — the inspector, randomiser, SVG + canvas compilers and export
 * pick it up automatically. No UI code needs to change.
 */

import type { FilterDef, FilterGroup } from './types'
import { gaussianBlurDef } from './blur/gaussian'
import { featherDef } from './blur/feather'
import { dropShadowDef } from './glow/drop-shadow'
import { outerGlowDef } from './glow/outer-glow'
import { innerGlowDef } from './glow/inner-glow'
import { brightnessContrastDef } from './color/brightness-contrast'
import { hslDef } from './color/hsl'
import { grayscaleDef } from './color/grayscale'
import { sepiaDef } from './color/sepia'
import { invertDef } from './color/invert'
import { duotoneDef } from './color/duotone'
import { posterizeDef } from './color/posterize'
import { levelsDef } from './color/levels'
import { roughenDef } from './distort/roughen'
import { rippleDef } from './distort/ripple'
import { turbulenceDef } from './distort/turbulence'
import { grainDef } from './texture/grain'
import { erodeDilateDef } from './shape/erode-dilate'
import { outlineDef } from './shape/outline'
import { sharpenDef } from './relief/sharpen'
import { embossDef } from './relief/emboss'
import { edgeDetectDef } from './relief/edge-detect'
import { motionBlurDef } from './raster/motion-blur'
import { radialBlurDef } from './raster/radial-blur'
import { zoomBlurDef } from './raster/zoom-blur'
import { pixelateDef } from './raster/pixelate'
import { chromaticDef } from './raster/chromatic'

export const FILTERS: FilterDef[] = [
  gaussianBlurDef,
  featherDef,
  dropShadowDef,
  outerGlowDef,
  innerGlowDef,
  brightnessContrastDef,
  hslDef,
  grayscaleDef,
  sepiaDef,
  invertDef,
  duotoneDef,
  posterizeDef,
  levelsDef,
  roughenDef,
  rippleDef,
  turbulenceDef,
  grainDef,
  erodeDilateDef,
  outlineDef,
  sharpenDef,
  embossDef,
  edgeDetectDef,
  motionBlurDef,
  radialBlurDef,
  zoomBlurDef,
  pixelateDef,
  chromaticDef,
]

const byType = new Map<string, FilterDef>(FILTERS.map((f) => [f.type, f]))

/** Look up a filter definition by its stable type key. */
export function getFilter(type: string): FilterDef | undefined {
  return byType.get(type)
}

/** All registered filter type keys. */
export function filterTypes(): string[] {
  return FILTERS.map((f) => f.type)
}

/** Filters grouped for the Add menu, in catalog order. */
export function filtersByGroup(): { group: FilterGroup; defs: FilterDef[] }[] {
  const order: FilterGroup[] = ['blur', 'glow', 'color', 'distort', 'texture', 'shape', 'relief', 'raster']
  const map = new Map<FilterGroup, FilterDef[]>()
  for (const f of FILTERS) {
    const arr = map.get(f.group) ?? []
    arr.push(f)
    map.set(f.group, arr)
  }
  return order.filter((g) => map.has(g)).map((group) => ({ group, defs: map.get(group) ?? [] }))
}

/** Human label for a filter group. */
export function groupLabel(group: FilterGroup): string {
  switch (group) {
    case 'blur': return 'Blur'
    case 'glow': return 'Glow / shadow'
    case 'color': return 'Color'
    case 'distort': return 'Distort'
    case 'texture': return 'Texture'
    case 'shape': return 'Shape'
    case 'relief': return 'Sharpen / relief'
    case 'raster': return 'Raster-only'
  }
}

export type { FilterDef, FilterGroup }
export type { FilterInstance, FilterSvgCtx } from './types'
