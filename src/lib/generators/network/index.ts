/**
 * network/index.ts — Registry entry for the network generator.
 *
 * Only exports the `GeneratorDef`; logic lives in `render.ts` (generate),
 * `nodes.ts` (3D placement), `edges.ts` (linking) and `params.ts` (schema).
 */

import type { GeneratorDef, Params } from '../../schema'
import { generateNetwork } from './render'
import { NETWORK_PARAMS, networkDefaults } from './params'

/** One disc per node + hub halos + dust specks + slab/bucket edge paths. */
export function networkDensityEstimate(p: Params): number {
  const count = Math.max(16, Math.round(Number(p.count ?? 260) || 260))
  const hubs = Math.round(count * Number(p.hubRatio ?? 0.07))
  const dust = Math.round(count * Number(p.dust ?? 0.25) * 0.4)
  return count + hubs + dust + 20
}

export const networkGen: GeneratorDef = {
  id: 'network',
  name: 'Network',
  icon: 'share-2',
  family: 'tech',
  tags: ['network', 'plexus', 'nodes', 'tech', 'constellation', 'web', 'data'],
  description: 'Glowing node-and-line plexus with depth-of-field bokeh.',
  params: NETWORK_PARAMS,
  defaults: (): Params => ({ ...networkDefaults() }),
  density: (p: Params): number => networkDensityEstimate(p),
  generate: generateNetwork,
}
