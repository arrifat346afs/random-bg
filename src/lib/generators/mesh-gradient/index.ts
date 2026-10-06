/**
 * mesh-gradient/index.ts — Registry entry for the mesh gradient generator.
 *
 * Only re-exports the `GeneratorDef`; logic lives in `generate.ts`.
 */

import type { GeneratorDef, Params } from '../../schema'
import { int } from '../kit'
import { generateMesh } from './generate'
import { MESH_PARAMS, meshDefaults } from './params'

export const meshGen: GeneratorDef = {
  id: 'mesh',
  name: 'Mesh gradient',
  icon: 'blend',
  family: 'surface',
  tags: ['mesh', 'gradient', 'background', 'smooth', 'surface', 'base'],
  description: 'Smooth multi-colour gradient field; the default base layer.',
  params: MESH_PARAMS,
  defaults: (): Params => ({ ...meshDefaults() }),
  density: (p: Params): number => {
    const cols: number = Math.max(2, Math.min(5, int(p, 'cols', 3)))
    const rows: number = Math.max(2, Math.min(5, int(p, 'rows', 3)))
    return cols * rows + 1
  },
  generate: generateMesh,
}
