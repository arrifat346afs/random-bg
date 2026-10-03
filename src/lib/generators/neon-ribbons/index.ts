/**
 * neon-ribbons/index.ts — Registry entry for the neon ribbons generator.
 *
 * Only re-exports the `GeneratorDef`; logic lives in `generate.ts`.
 */

import type { GeneratorDef, Params } from '../../schema'
import { int, num } from '../kit'
import { generateRibbons } from './generate'
import { RIBBON_PARAMS, ribbonDefaults } from './params'

export const ribbonsGen: GeneratorDef = {
  id: 'ribbons',
  name: 'Neon ribbons',
  icon: 'sparkles',
  family: 'light',
  tags: ['ribbons', 'neon', 'swirl', 'trails', 'glow', 'light'],
  description: 'Bundles of glowing strands along parametric curves.',
  params: RIBBON_PARAMS,
  defaults: (): Params => ({ ...ribbonDefaults() }),
  density: (p: Params): number => {
    const ribbons: number = num(p, 'count', 3)
    const strands: number = num(p, 'strands', 28)
    return ribbons * strands * 2.2 + num(p, 'sparkle', 0.5) * 14
  },
  generate: generateRibbons,
}

/** Keep the density helper honest about the strands key. */
export function ribbonStrandCount(p: Params): number {
  return Math.max(10, Math.min(80, int(p, 'strands', 28)))
}
