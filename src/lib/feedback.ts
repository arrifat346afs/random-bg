/**
 * feedback.ts — Human taste feedback (thumbs up / down) and bandit learning.
 *
 * Pure TypeScript: no React, no DOM, no store imports. Persistence touches
 * `localStorage` only inside try/catch with a `typeof` guard, so this module
 * stays importable in Bun (scripts) and SSR alike.
 *
 * Model: every rating is an entry (seed + generator ids + gate metrics +
 * verdict). Per-generator multipliers are DERIVED from entries on load with
 * age decay (30-day half-life), so there are no counters to corrupt — delete
 * entries and the taste resets. Multipliers clamp to [0.3, 3].
 */

export type FeedbackVerdict = 'like' | 'dislike'

/** Gate metrics snapshot stored per rating (all optional — old entries). */
export interface FeedbackMetrics {
  coverage: number
  meanLuma: number
  edge: number
  hueCount: number
  focal: number
  whiteComposite: number
}

export interface FeedbackEntry {
  seed: number
  /** composition recipe id, or null when the project predates recipes */
  recipeId: string | null
  genIds: string[]
  fams: string[]
  palette: string[]
  bgKind: string
  metrics: FeedbackMetrics | null
  verdict: FeedbackVerdict
  /** unix ms */
  at: number
}

/** Storage cap — oldest entries are compacted out first. */
export const FEEDBACK_CAP = 500
/** Multiplier bounds (spec: clamped between 0.3x and 3x). */
export const MULT_MIN = 0.3
export const MULT_MAX = 3
/** Half-life of a rating's influence, in days. */
export const DECAY_HALF_LIFE_DAYS = 30

const STORAGE_KEY = 'fxforge.feedback.v1'

const clampMult = (m: number): number => Math.max(MULT_MIN, Math.min(MULT_MAX, m))

function ageWeight(at: number, now: number): number {
  const days = Math.max(0, (now - at) / 86400000)
  return Math.pow(0.5, days / DECAY_HALF_LIFE_DAYS)
}

/** Load entries (never throws — corrupt storage reads as empty). */
export function loadEntries(): FeedbackEntry[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as FeedbackEntry[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e) => typeof e?.seed === 'number' && Array.isArray(e?.genIds))
  } catch {
    return []
  }
}

/** Persist entries, compacted to the cap (never throws). */
export function saveEntries(entries: FeedbackEntry[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    const sorted = [...entries].sort((a, b) => a.at - b.at)
    const kept = sorted.slice(Math.max(0, sorted.length - FEEDBACK_CAP))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept))
  } catch {
    /* storage full or blocked — feedback stays in memory for the session */
  }
}

/** Clear all stored feedback (never throws). */
export function clearEntries(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Per-generator multipliers derived from entries: Laplace-smoothed
 * like/dislike ratio per generator, age-weighted, clamped to [0.3, 3].
 * Generators with no ratings return exactly 1.
 */
export function generatorMultipliers(entries: FeedbackEntry[], now = Date.now()): Record<string, number> {
  const like = new Map<string, number>()
  const dislike = new Map<string, number>()
  for (const e of entries) {
    const w = ageWeight(e.at, now)
    if (w <= 0.01) continue
    const target = e.verdict === 'like' ? like : dislike
    for (const g of new Set(e.genIds)) target.set(g, (target.get(g) ?? 0) + w)
  }
  const out: Record<string, number> = {}
  for (const g of new Set([...like.keys(), ...dislike.keys()])) {
    const l = like.get(g) ?? 0
    const d = dislike.get(g) ?? 0
    out[g] = clampMult(Math.pow((l + 1) / (d + 1), 0.7))
  }
  return out
}

/**
 * Novelty penalty for a candidate generator set relative to liked entries:
 * 1 when disjoint from everything liked, decaying toward 0.5 for near-copies
 * (Jaccard similarity on generator ids, weighted by entry age). Keeps the
 * bandit from serving the same liked formula forever.
 */
export function noveltyFactor(genIds: string[], entries: FeedbackEntry[], now = Date.now()): number {
  const liked = entries.filter((e) => e.verdict === 'like')
  if (!liked.length || !genIds.length) return 1
  const mine = new Set(genIds)
  let worst = 0
  for (const e of liked) {
    const theirs = new Set(e.genIds)
    let inter = 0
    for (const g of mine) if (theirs.has(g)) inter++
    const union = mine.size + theirs.size - inter
    const jaccard = union > 0 ? inter / union : 0
    const sim = jaccard * ageWeight(e.at, now)
    if (sim > worst) worst = sim
  }
  return 1 - worst * 0.5
}

/** Serialise entries for export (the file the user sends back for analysis). */
export function exportFeedback(entries: FeedbackEntry[]): string {
  return JSON.stringify({ v: 1, exportedAt: Date.now(), entries }, null, 2)
}

/** Parse an exported file (never throws — bad files read as empty). */
export function importFeedback(text: string): FeedbackEntry[] {
  try {
    const parsed = JSON.parse(text) as { entries?: FeedbackEntry[] }
    const list = Array.isArray(parsed?.entries) ? parsed.entries : []
    return list.filter((e) => typeof e?.seed === 'number' && Array.isArray(e?.genIds)).slice(-FEEDBACK_CAP)
  } catch {
    return []
  }
}
