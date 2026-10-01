/**
 * rng.ts — Deterministic pseudo-random numbers.
 *
 * Everything in FX Forge derives from a single integer seed so that any
 * project is byte-for-byte reproducible: `seed + params => identical output`.
 */

/** 32-bit FNV-1a hash. Used to fold strings/ids into numeric seeds. */
export function hash32(...parts: (string | number)[]): number {
  let h = 0x811c9dc5
  for (const part of parts) {
    const s = String(part)
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    // mix the boundary so ("ab","c") != ("a","bc")
    h ^= 0x9e3779b9
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 — fast, good-quality 32-bit PRNG. Returns floats in [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Seeded random number generator object (the only thing generators receive). */
export interface RNG {
  /** float in [0,1) */
  next(): number
  /** float in [min,max) */
  range(min: number, max: number): number
  /** integer in [min,max] inclusive */
  int(min: number, max: number): number
  /** true with probability p */
  chance(p: number): boolean
  /** uniform element of an array */
  pick<T>(arr: readonly T[]): T
  /** weighted pick: weights aligned with items */
  weighted<T>(items: readonly T[], weights: readonly number[]): T
  /** standard normal (Box–Muller, cached) */
  gauss(): number
  /** normal with mean/stddev */
  normal(mu?: number, sigma?: number): number
  /** approximately gaussian in [-1,1] — bounded, good for mutations */
  bipolar(sigma?: number): number
  /** shuffle in place (Fisher–Yates) */
  shuffle<T>(arr: T[]): T[]
  /** derived sub-RNG, so child features don't perturb the parent stream */
  fork(...salt: (string | number)[]): RNG
}

export function createRng(seed: number | string): RNG {
  const numericSeed =
    typeof seed === 'number'
      ? seed >>> 0
      : hash32(seed)
  const rand = mulberry32(numericSeed)
  let spare: number | null = null

  const rng: RNG = {
    next: rand,
    range: (min, max) => min + rand() * (max - min),
    int: (min, max) => min + Math.floor(rand() * (max - min + 1)),
    chance: (p) => rand() < p,
    pick: (arr) => arr[Math.floor(rand() * arr.length)],
    weighted(items, weights) {
      let total = 0
      for (const w of weights) total += Math.max(0, w)
      if (total <= 0) return items[0]
      let r = rand() * total
      for (let i = 0; i < items.length; i++) {
        r -= Math.max(0, weights[i] ?? 0)
        if (r <= 0) return items[i]
      }
      return items[items.length - 1]
    },
    gauss() {
      if (spare !== null) {
        const v = spare
        spare = null
        return v
      }
      // Box–Muller — the do/while assigns all three on the first pass
      let u: number
      let v: number
      let s: number
      do {
        u = rand() * 2 - 1
        v = rand() * 2 - 1
        s = u * u + v * v
      } while (s === 0 || s >= 1)
      const m = Math.sqrt((-2 * Math.log(s)) / s)
      spare = v * m
      return u * m
    },
    normal(mu = 0, sigma = 1) {
      return mu + rng.gauss() * sigma
    },
    bipolar(sigma = 1) {
      // clamped gaussian: keeps mutations visible but never explodes
      const g = Math.max(-2, Math.min(2, rng.gauss())) * sigma
      return g / 2
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        const t = arr[i]
        arr[i] = arr[j]
        arr[j] = t
      }
      return arr
    },
    fork(...salt) {
      return createRng(hash32(numericSeed, ...salt))
    },
  }
  return rng
}

/* ---- Seed UX helpers --------------------------------------------------- */

/** Human-typable seed: 6 chars from a Crockford-ish alphabet. */
const SEED_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export function randomSeedString(): string {
  let out = ''
  for (let i = 0; i < 6; i++) {
    out += SEED_ALPHABET[Math.floor(Math.random() * SEED_ALPHABET.length)]
  }
  return out
}

/** Accepts "K3F9Q2", "k3f9q2" or a number; falls back to a hash of the text. */
export function parseSeed(input: string | number): number {
  if (typeof input === 'number' && Number.isFinite(input)) return input >>> 0
  const raw = String(input).trim()
  if (!raw) return 0
  const upper = raw.toUpperCase()
  if (/^\d+$/.test(upper)) {
    const n = Number(upper)
    if (n <= 0xffffffff) return n >>> 0
  }
  // map the seed alphabet to base-32 so short codes give stable integers
  let v = 0
  let ok = true
  for (const ch of upper) {
    const idx = SEED_ALPHABET.indexOf(ch)
    if (idx < 0) {
      ok = false
      break
    }
    v = (v * 32 + idx) >>> 0
  }
  return ok && upper.length > 0 ? v >>> 0 : hash32(upper)
}

/** Pretty form for display: groups of 3. */
export function formatSeed(n: number): string {
  const s = (n >>> 0).toString(36).toUpperCase().padStart(6, '0')
  return s.length > 6 ? s : s
}
