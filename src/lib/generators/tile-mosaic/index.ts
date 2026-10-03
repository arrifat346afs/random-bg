/**
 * tile-mosaic/index.ts — Registry entry for the tile mosaic generator.
 *
 * Only re-exports the `GeneratorDef`; logic lives in `generate.ts`.
 */

import type { GeneratorDef, Params } from '../../schema'
import { int, num } from '../kit'
import { generateMosaic } from './generate'
import { MOSAIC_PARAMS, mosaicDefaults } from './params'

export const mosaicGen: GeneratorDef = {
  id: 'mosaic',
  name: 'Tile mosaic',
  icon: 'grid-2x2',
  family: 'geometry',
  tags: ['mosaic', 'triangles', 'low-poly', 'tiles', 'geometric'],
  description: 'Grid cells split into shaded triangles.',
  params: MOSAIC_PARAMS,
  defaults: (): Params => ({ ...mosaicDefaults() }),
  density: (p: Params): number => {
    const cols: number = Math.max(2, Math.min(40, int(p, 'cols', 12)))
    const rows: number = Math.max(2, Math.min(40, int(p, 'rows', 12)))
    const quad: boolean = String(p.split ?? 'mixed') === 'quad'
    return cols * rows * (quad ? 4 : 2.4) * (1 + num(p, 'shade', 0.5) * 0)
  },
  generate: generateMosaic,
}
