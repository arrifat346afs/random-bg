/**
 * surface3d/index.ts — Registry entry for the Surface 3D generator.
 *
 * Only exports the `GeneratorDef`; logic lives in `build.ts` (emission)
 * and `field.ts` (height synthesis), params in `params.ts`.
 */

import type { GeneratorDef, Params } from '../../schema'
import { num } from '../kit'
import { generateSurface3d } from './build'
import { SURFACE3D_PARAMS, surface3dDefaults } from './params'

/** Nodes + accent glows + merged edge paths (slabs × buckets × levels). */
export function surface3dDensityEstimate(p: Params): number {
  const res = Math.max(12, Math.min(80, Math.round(num(p, 'resolution', 44))))
  const st = String(p.structure ?? 'tri')
  const r2 = res * res
  const accents = Math.round(r2 * num(p, 'accentRatio', 0.06))
  if (st === 'dots') return Math.round(r2 * 0.23 + 4)
  if (st === 'lattice') return Math.round(r2 * 0.6 + 4)
  if (st === 'contours' || st === 'grid') return 15
  if (st === 'hex') return Math.round(r2 * 2.6 + 30)
  // tri / quad wireframe: kept vertices + edge-bucket paths
  return Math.round(r2 * 0.22 + 30 + accents * 0.25)
}

export const surface3dGen: GeneratorDef = {
  id: 'surface3d',
  name: 'Surface 3D',
  icon: 'waves',
  family: 'tech',
  tags: ['3d', 'surface', 'wave', 'wireframe', 'hex', 'topographic', 'tech', 'depth'],
  description: 'Perspective 3D wave surfaces: dots, wireframes, honeycomb, contours.',
  params: SURFACE3D_PARAMS,
  defaults: (): Params => ({ ...surface3dDefaults() }),
  density: (p: Params): number => surface3dDensityEstimate(p),
  generate: generateSurface3d,
}
