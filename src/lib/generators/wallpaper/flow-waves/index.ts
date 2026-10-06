/**
 * wallpaper/flow-waves/index.ts — Registry entry for the flow waves generator.
 *
 * Only re-exports the `GeneratorDef`; logic lives in `generate.ts`.
 */

import type { GeneratorDef, Params } from '../../../schema'
import { int } from '../../kit'
import { generateFlowWaves } from './generate'
import { FLOW_WAVE_PARAMS, flowWaveDefaults } from './params'

export const flowWavesGen: GeneratorDef = {
  id: 'flowWaves',
  name: 'Flow waves',
  icon: 'waves',
  family: 'wallpaper',
  tags: ['wallpaper', 'waves', 'gradient', 'smooth', 'background', 'silk'],
  description: 'Calm flowing wave bands with lit edges; a desktop-wallpaper base.',
  params: FLOW_WAVE_PARAMS,
  // smooth-field dithering: the fills rasterise offscreen (canvas) and embed
  // as <image> on SVG export so long ramps never band
  dither: true,
  defaults: (): Params => ({ ...flowWaveDefaults() }),
  density: (p: Params): number => {
    const bands: number = Math.max(3, Math.min(5, int(p, 'bands', 4)))
    return bands * 3 + 1
  },
  generate: generateFlowWaves,
}
