/**
 * generators/index.ts — The generator registry.
 *
 * ADDING A GENERATOR
 * -------------------
 *  1. Create `src/lib/generators/myGen.ts` exporting a `GeneratorDef`
 *     (id, name, params schema, defaults, density, generate → IR nodes).
 *  2. Import it below and add it to `GENERATORS`.
 * That's it — the inspector, randomiser, presets and exporters pick it up
 * automatically from the registry. No UI code needs to change.
 */

import type { GeneratorDef } from '../schema'
import { buildIR } from '../ir'
import { MIN_EMIT } from './kit'
import { particlesGen } from './particles'
import { bokehGen } from './bokeh'
import { streaksGen } from './streaks'
import { raysGen } from './rays'
import { flowGen } from './flow'
import { emittersGen } from './emitters'
import { scatterGen } from './scatter'
import { smokeGen } from './smoke'
import { geometricGen } from './geometric'
import { grainGen } from './grain'

/** Used when a project references a generator that no longer exists. */
export const fallbackGenerator: GeneratorDef = {
  id: 'missing',
  name: 'Missing generator',
  icon: 'circle-help',
  family: 'texture',
  tags: [],
  description: 'This layer points at a generator that is not installed.',
  params: [],
  defaults: () => ({}),
  density: () => 0,
  generate: (_p, ctx) => buildIR(ctx.w, ctx.h, []),
}

export const GENERATORS: GeneratorDef[] = [
  particlesGen,
  bokehGen,
  streaksGen,
  raysGen,
  flowGen,
  emittersGen,
  scatterGen,
  smokeGen,
  geometricGen,
  grainGen,
]

const byId = new Map<string, GeneratorDef>(GENERATORS.map((g) => [g.id, g]))

/**
 * Generators that emit a **field** of primitives, where a count in the low
 * teens always reads as a bug rather than a choice — they get the `MIN_EMIT`
 * floor.
 *
 * Deliberately exempt: lens flares and hero rays (`rays`), single trails
 * (`streaks`) and shapes (`geometric`), where *one* is often the whole point,
 * plus `grain`, which has no count at all.
 *
 * The floor is actually enforced at render time by `kit.ts#emitCount`, whose
 * per-generator call sites are the authority — this set tells the randomiser
 * how far it may thin a layer's density before it would hit that floor.
 *
 * When you add a generator, decide which side of this line it falls on.
 */
export const MIN_EMIT_GENS: ReadonlySet<string> = new Set([
  'particles',
  'bokeh',
  'flow',
  'emitters',
  'scatter',
  'smoke',
])

/** The lowest `count` this generator can legitimately render with. */
export function minCountFor(genId: string): number {
  return MIN_EMIT_GENS.has(genId) ? MIN_EMIT : 1
}

export function getGenerator(id: string): GeneratorDef | undefined {
  return byId.get(id)
}

export function generatorIds(): string[] {
  return [...byId.keys()]
}

/** Generator ids grouped by family (used by the layer "add" menu). */
export function generatorsByFamily(): { family: string; gens: GeneratorDef[] }[] {
  const order = ['particles', 'light', 'atmosphere', 'geometry', 'texture']
  const map = new Map<string, GeneratorDef[]>()
  for (const g of GENERATORS) {
    const arr = map.get(g.family) ?? []
    arr.push(g)
    map.set(g.family, arr)
  }
  return order
    .filter((f) => map.has(f))
    .map((family) => ({ family, gens: map.get(family) ?? [] }))
}

/** Families the randomiser draws from, with relative weights. */
export const FAMILY_WEIGHTS: [string, number][] = [
  ['particles', 4],
  ['light', 3],
  ['atmosphere', 2.4],
  ['geometry', 2],
  ['texture', 1.4],
]
