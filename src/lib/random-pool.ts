/**
 * random-pool.ts — User-controllable Randomise pool.
 *
 * Lets the user choose which generators ("effects"), background kinds and
 * post-processing (filters / additive blends) a random roll may draw from.
 * Persisted in localStorage; defaults = everything on (previous behaviour).
 */

import { GENERATORS } from './generators'

export interface RandomPoolPrefs {
  /** genId → allowed. Missing keys count as allowed (forward-compat). */
  gens: Record<string, boolean>
  bgSolid: boolean
  bgGradient: boolean
  bgTransparent: boolean
  bgNoise: boolean
  allowLightBg: boolean
  allowFilters: boolean
  allowAdditiveBlends: boolean
  /** false = no blur anywhere: no blur filters + no depth-driven defocus blur */
  allowBlur: boolean
}

const KEY = 'fx-forge:random-pool'

export function defaultRandomPool(): RandomPoolPrefs {
  return {
    gens: {},
    bgSolid: true,
    bgGradient: true,
    bgTransparent: true,
    bgNoise: true,
    allowLightBg: true,
    allowFilters: true,
    allowAdditiveBlends: true,
    allowBlur: true,
  }
}

export function loadRandomPool(): RandomPoolPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultRandomPool()
    const p = { ...defaultRandomPool(), ...(JSON.parse(raw) as Partial<RandomPoolPrefs>) }
    return p
  } catch {
    return defaultRandomPool()
  }
}

export function saveRandomPool(p: RandomPoolPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* private mode — pool just doesn't persist */
  }
}

export function isGenAllowed(pool: RandomPoolPrefs, genId: string): boolean {
  return pool.gens[genId] ?? true
}

export function allowedGenIds(pool: RandomPoolPrefs): string[] {
  const ids = GENERATORS.map((g) => g.id).filter((id) => isGenAllowed(pool, id))
  return ids.length > 0 ? ids : GENERATORS.map((g) => g.id)
}

export type BgKind = 'solid' | 'gradient' | 'transparent' | 'noise'

export function allowedBgKinds(pool: RandomPoolPrefs): BgKind[] {
  const out: BgKind[] = []
  if (pool.bgSolid) out.push('solid')
  if (pool.bgGradient) out.push('gradient')
  if (pool.bgTransparent) out.push('transparent')
  if (pool.bgNoise) out.push('noise')
  return out.length > 0 ? out : ['solid', 'gradient', 'transparent', 'noise']
}
