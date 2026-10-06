/**
 * wallpaper/ribbon-flow/index.ts — Registry entry for the ribbon flow generator.
 *
 * Only re-exports the `GeneratorDef`; logic lives in `generate.ts`.
 */

import type { GeneratorDef, Params } from '../../../schema'
import { int } from '../../kit'
import { generateRibbonFlow } from './generate'
import { RIBBON_FLOW_PARAMS, ribbonFlowDefaults } from './params'

export const ribbonFlowGen: GeneratorDef = {
  id: 'ribbonFlow',
  name: 'Ribbon flow',
  icon: 'spline',
  family: 'wallpaper',
  tags: ['wallpaper', 'ribbon', 'silk', 'gradient', 'smooth', 'background'],
  description: 'Broad twisting silk ribbons with diffuse and rim light.',
  params: RIBBON_FLOW_PARAMS,
  // smooth-field dithering: the fills rasterise offscreen (canvas) and embed
  // as <image> on SVG export so long ramps never band
  dither: true,
  defaults: (): Params => ({ ...ribbonFlowDefaults() }),
  density: (p: Params): number => {
    const ribbons: number = Math.max(1, Math.min(3, int(p, 'ribbons', 2)))
    return ribbons * 2 + 1
  },
  generate: generateRibbonFlow,
}
