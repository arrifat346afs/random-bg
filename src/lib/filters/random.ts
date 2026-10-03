/**
 * filters/random.ts — The randomiser's tasteful filter layer.
 *
 * Deliberately *not* "add a random filter from the catalogue": a randomiser
 * that sprinkles pixelate and chromatic aberration over a project produces
 * worse work, and the whole point of the randomiser is that its output passes
 * the quality gate. So this only ever draws from a short list of filters that
 * are near-universally tasteful at safe magnitudes, each with its own safe
 * range, and it adds 0–2 of them per layer.
 *
 * Locked layers keep whatever stack they have — `randomLayer` is about
 * parameters, and clobbering a deliberate filter stack would be surprising.
 */

import type { RNG } from '../rng'
import type { Params } from '../schema'
import type { FilterInstance } from './types'
import { getFilter } from './index'
import { defaultFilterParams } from './stack'

/** Chance a layer gets any filter at all. */
export const FILTER_CHANCE = 0.42
/** Most layers get one; only occasionally two. */
const TWO_CHANCE = 0.22

interface Recipe {
  type: string
  /** sampled per instance, so two glows in one stack differ */
  params?: (rng: RNG) => Params
  /** extra weight for the additive-looking ones, which suit most art */
  weight?: number
}

/**
 * The safe list. Every entry is chosen because it either tidies the artwork
 * (grain, a small colour grade) or amplifies what it already is (glow, a
 * slight blur) without being able to make it unreadable.
 */
const RECIPES: Recipe[] = [
  { type: 'grain', weight: 1.2, params: (r) => ({ amount: r.range(0.05, 0.16), seed: r.int(0, 9999) }) },
  { type: 'gaussian-blur', params: (r) => ({ sigmaX: r.range(0.4, 1.8), sigmaY: r.range(0.4, 1.8) }) },
  { type: 'brightness-contrast', weight: 0.7, params: (r) => ({ brightness: r.range(-0.06, 0.06), contrast: r.range(-0.05, 0.14) }) },
  { type: 'hsl', weight: 0.6, params: (r) => ({ hue: r.range(-10, 10), saturation: r.range(-0.06, 0.18), lightness: r.range(-0.03, 0.03) }) },
  { type: 'levels', weight: 0.5, params: (r) => ({ gamma: r.range(0.94, 1.08), black: r.range(0, 0.03) }) },
  { type: 'outer-glow', weight: 0.9, params: (r) => ({ blur: r.range(4, 10), opacity: r.range(0.18, 0.4) }) },
  { type: 'sharpen', weight: 0.5, params: (r) => ({ amount: r.range(0.15, 0.4) }) },
]

function pick(rng: RNG): Recipe {
  const total = RECIPES.reduce((s, r) => s + (r.weight ?? 1), 0)
  let t = rng.next() * total
  for (const r of RECIPES) {
    t -= r.weight ?? 1
    if (t <= 0) return r
  }
  return RECIPES[0]
}

/**
 * Pull every numeric value inside the filter's own declared safe range
 * (`ParamDef.rand`, falling back to the slider bounds).
 *
 * The ranges below are tuned for taste and are not always identical to the
 * schema's — but `resampleFilterStack` clamps into that same range on an evolve
 * walk, so a recipe value outside it would visibly jump the first time the user
 * pressed Evolve. Clamping here makes the contract hold by construction.
 */
function clampToSafeRange(type: string, params: Params): Params {
  const def = getFilter(type)
  if (!def) return params
  for (const p of def.params) {
    if (p.type === 'color' || p.type === 'bool' || p.type === 'text' || p.type === 'path') continue
    const v = params[p.key]
    if (typeof v !== 'number') continue
    const lo = p.rand?.min ?? p.min
    const hi = p.rand?.max ?? p.max
    const next = Math.min(hi ?? Infinity, Math.max(lo ?? -Infinity, v))
    if (next !== v) params[p.key] = p.type === 'int' ? Math.round(next) : next
  }
  return params
}

/**
 * 0–2 tasteful filters for one layer, drawn from `rng`.
 *
 * Separate counter rather than `Date.now()`-derived ids so a re-roll with the
 * same seed produces the same stack, like every other part of the randomiser.
 */
export function randomFilterStack(rng: RNG): FilterInstance[] {
  if (rng.next() > FILTER_CHANCE) return []
  const n = rng.next() < TWO_CHANCE ? 2 : 1
  const out: FilterInstance[] = []
  const used = new Set<string>()
  for (let i = 0; i < n; i++) {
    const recipe = pick(rng)
    // don't stack two of the same thing — it just doubles one effect
    if (used.has(recipe.type)) continue
    used.add(recipe.type)
    out.push({
      id: `rf${rng.int(0, 0xffffff).toString(36)}`,
      type: recipe.type,
      enabled: true,
      params: clampToSafeRange(recipe.type, {
        ...defaultFilterParams(recipe.type),
        ...(recipe.params?.(rng) ?? {}),
      }),
    })
  }
  return out
}

/**
 * Give an existing stack a gentle re-roll rather than a rebuild: values are
 * nudged inside their safe range, colours and seeds move, structure is kept.
 * Used by `mutateLayer` so an evolve walk doesn't wipe deliberate work.
 */
export function resampleFilterStack(
  stack: FilterInstance[],
  rng: RNG,
  strength = 0.2,
): FilterInstance[] {
  return stack.map((f) => {
    const def = getFilter(f.type)
    if (!def) return f
    const params = { ...f.params }
    for (const p of def.params) {
      const cur = params[p.key]
      if (p.type === 'color') {
        // nudge the palette a little; full regeneration reads as a bug
        params[p.key] = shiftHex(String(cur ?? p.default), rng, strength)
      } else if (p.type === 'int' && p.key === 'seed') {
        params[p.key] = rng.int(0, 9999)
      } else if (typeof cur === 'number' && p.type !== 'bool') {
        const lo = p.rand?.min ?? p.min ?? 0
        const hi = p.rand?.max ?? p.max ?? 1
        if (lo === hi) continue
        // stay inside the filter's *safe* range even when re-rolling, so a
        // mutate walk can never walk a layer into an unreadable one
        const next = cur + (rng.next() - 0.5) * (hi - lo) * strength * 2
        params[p.key] = Math.min(hi, Math.max(lo, next))
      }
    }
    return { ...f, params }
  })
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)))

/** Nudge a `#rrggbb` colour by a small hue-neutral brightness jitter. */
function shiftHex(hex: string, rng: RNG, strength: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const amp = 255 * 0.12 * strength
  const d = (rng.next() - 0.5) * 2 * amp
  const r = clamp255(((n >> 16) & 255) + d)
  const g = clamp255(((n >> 8) & 255) + d)
  const b = clamp255((n & 255) + d)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}