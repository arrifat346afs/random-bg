/**
 * quality.ts — The randomiser's quality gate.
 *
 * `randomProject()` is pure: it takes a seed and returns a project, so it can
 * run in Bun (scripts/check.ts) with no DOM. That also means it cannot judge
 * its own output — which is what this module is for.
 *
 * The gate renders each candidate once at a fixed 256 px, measures it, and
 * rejects the ones that came out blank, invisible or blown out. A rejected
 * candidate is re-rolled from a *deterministic* sub-seed (`hash32(seed, i)`),
 * so the same seed always produces the same accepted project.
 *
 * Everything runs off the main thread via the render worker, and is capped by
 * a wall-clock budget so the UI can show a short loading state and carry on.
 */

import { hash32 } from './rng'
import { randomProject } from './randomize'
import { activeLayers, totalPrimitives, type LayerResult } from './pipeline'
import { compositeLayers } from './export'
import { renderCanvas } from './render/canvas'
import { requestRender } from './render/service'
import type { Project } from './schema'

/* ---- Thresholds --------------------------------------------------------- */

/** Preview width the metrics are taken at — small enough to cost ~1 ms. */
export const MEASURE_W = 256
/** Share of content pixels below which a canvas counts as blank. */
export const COVERAGE_MIN = 3
/** Mean luma below which a dark ground counts as "nothing on it". */
export const LUMA_MIN = 3
/** Share of pure-white pixels above which a canvas counts as blown out. */
export const WHITE_MAX = 30
/** Standard deviation of luma below which the image has no structure. */
export const CONTRAST_MIN = 8
/** Content-to-ground luma gap below which the content sits *on* the ground. */
export const SEPARATION_MIN = 12
/** Fewer primitives than this reads as an accident (soft penalty). */
export const NODES_MIN = 16

/* ---- Metrics ------------------------------------------------------------ */

export interface Metrics {
  /** % of pixels carrying content (measured on transparent). */
  coverage: number
  /** Mean luma 0–255 of the preview over its own ground. */
  meanLuma: number
  /** % of pixels that are pure white. */
  whiteShare: number
  /** Standard deviation of luma — "is there any structure at all". */
  contrast: number
  /** |mean luma of content − mean luma of ground| — "can you see it". */
  separation: number
  /** Total primitives across every active layer. */
  nodes: number
  w: number
  h: number
}

export interface Reason {
  code: 'blank' | 'dark' | 'blown' | 'flat' | 'merged' | 'sparse'
  why: string
}

export interface Verdict {
  /** false → reject and re-roll. */
  ok: boolean
  /** Higher is better; used to pick the least-bad attempt when all 8 fail. */
  score: number
  /** Failures that reject on their own. */
  hard: Reason[]
  /** Penalties that only reject in combination (≥2 of them). */
  soft: Reason[]
}

/**
 * Turn measurements into a pass/fail decision.
 *
 * Hard rejections are the three that produce *unusable* output: blank, invisible
 * on its own ground, and blown out. Everything else is a penalty — low contrast
 * is a taste call, so it only rejects when it is joined by a second penalty.
 */
export function judge(m: Metrics): Verdict {
  const hard: Reason[] = []
  const soft: Reason[] = []

  if (m.coverage < COVERAGE_MIN)
    hard.push({
      code: 'blank',
      why: `coverage ${m.coverage.toFixed(1)}% < ${COVERAGE_MIN}%`,
    })
  if (m.meanLuma < LUMA_MIN)
    hard.push({
      code: 'dark',
      why: `mean luma ${m.meanLuma.toFixed(1)} ≈ 0 on a dark ground`,
    })
  if (m.whiteShare > WHITE_MAX)
    hard.push({
      code: 'blown',
      why: `${m.whiteShare.toFixed(1)}% pure white > ${WHITE_MAX}%`,
    })

  if (m.contrast < CONTRAST_MIN)
    soft.push({
      code: 'flat',
      why: `contrast ${m.contrast.toFixed(1)} < ${CONTRAST_MIN}`,
    })
  if (m.separation < SEPARATION_MIN)
    soft.push({
      code: 'merged',
      why: `content/ground gap ${m.separation.toFixed(1)} < ${SEPARATION_MIN}`,
    })
  if (m.nodes < NODES_MIN)
    soft.push({
      code: 'sparse',
      why: `${m.nodes} primitives < ${NODES_MIN}`,
    })

  const ok = hard.length === 0 && soft.length < 2

  let score = 0
  score += Math.min(m.coverage, 45) // presence
  score += Math.min(m.contrast, 70) * 0.6 // structure
  score += m.meanLuma >= 6 && m.meanLuma <= 210 ? 18 : 0 // usable exposure
  score -= Math.max(0, m.whiteShare - 15) * 2 // blowout
  score -= soft.length * 12 // each penalty costs a little
  score -= hard.length * 40 // hard failures rank last

  return { ok, score, hard, soft }
}

/* ---- Measurement -------------------------------------------------------- */

const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

/**
 * Render `results` once at {@link MEASURE_W} px and read the numbers back.
 *
 * Two rasters are taken from the same IR:
 *  • **content only** (transparent ground) → coverage and pure-white share,
 *    so the ground cannot mask a blank or a blowout;
 *  • **over the project's own ground** → luma, contrast and content/ground
 *    separation, which is what the eye actually judges.
 *
 * A transparent project is measured over a neutral dark stand-in: a glow FX on
 * a transparent canvas is meant to sit on a dark page, and a checkerboard would
 * otherwise report meaningless luma.
 */
export function measureProject(project: Project, results: LayerResult[]): Metrics {
  const ir = compositeLayers(results, project.canvas.w, project.canvas.h)
  const scale = MEASURE_W / Math.max(1, ir.w)

  const bare = document.createElement('canvas')
  renderCanvas(ir, bare, { scale })
  const preview = document.createElement('canvas')
  const bg =
    project.canvas.bg.kind === 'transparent'
      ? { kind: 'solid' as const, color: '#101014' }
      : project.canvas.bg
  renderCanvas(ir, preview, { scale, background: bg })

  const bw = bare.width
  const bh = bare.height
  const bd = bare.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, bw, bh).data
  const pd = preview.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, bw, bh).data

  const n = bw * bh
  let covered = 0
  let white = 0
  let sum = 0
  let sumSq = 0
  let fgSum = 0
  let fgN = 0
  let bgSum = 0
  let bgN = 0

  for (let i = 0; i < bd.length; i += 4) {
    const a = bd[i + 3]
    if (a >= 8) covered++
    if (a >= 240 && bd[i] >= 250 && bd[i + 1] >= 250 && bd[i + 2] >= 250) white++

    const L = luma(pd[i], pd[i + 1], pd[i + 2])
    sum += L
    sumSq += L * L
    if (a >= 128) {
      fgSum += L
      fgN++
    } else if (a < 8) {
      bgSum += L
      bgN++
    }
  }

  const meanLuma = sum / Math.max(1, n)
  const variance = Math.max(0, sumSq / Math.max(1, n) - meanLuma * meanLuma)
  const fgLuma = fgN ? fgSum / fgN : meanLuma
  const groundLuma = bgN ? bgSum / bgN : meanLuma

  return {
    coverage: (covered / Math.max(1, n)) * 100,
    meanLuma,
    whiteShare: (white / Math.max(1, n)) * 100,
    contrast: Math.sqrt(variance),
    separation: Math.abs(fgLuma - groundLuma),
    nodes: totalPrimitives(results),
    w: project.canvas.w,
    h: project.canvas.h,
  }
}

/* ---- The gate ------------------------------------------------------------ */

export interface RandomOpts {
  layers?: number
  bg?: boolean
  /** Hard cap on roll attempts (default 8). */
  attempts?: number
  /** Wall-clock budget in ms (default 750) — the gate never blocks the UI. */
  budgetMs?: number
}

export interface CheckedRandom {
  project: Project
  metrics: Metrics
  verdict: Verdict
  /** How many seeds were tried. 1 means the first try already passed. */
  attempts: number
  /** True when the time budget ran out before anything passed. */
  budgetHit: boolean
}

const nextTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/**
 * Randomise with a quality gate: roll, render, measure, reject, re-roll.
 *
 * Deterministic in `seed` — attempt *i* is generated from `hash32(seed, i)`, so
 * calling this twice with the same seed yields the same accepted project (and
 * the project carries that accepted sub-seed, so it is reproducible on its own).
 *
 * Returns the first passing attempt, or — if the budget runs out first — the
 * highest-scoring one, so a randomise press always returns something.
 */
export async function randomProjectChecked(
  seed: number = Math.floor(Math.random() * 0xffffffff),
  opts: RandomOpts = {},
  onProgress?: (attempt: number, max: number) => void,
  onAttempt?: (a: { project: Project; metrics: Metrics; verdict: Verdict; attempt: number }) => void,
): Promise<CheckedRandom> {
  const maxTries = Math.max(1, opts.attempts ?? 8)
  const deadline = performance.now() + Math.max(0, opts.budgetMs ?? 750)
  let budgetHit = false
  let best: CheckedRandom | null = null

  for (let i = 0; i < maxTries; i++) {
    // attempt 0 uses the seed verbatim, so an already-good seed stays put
    const sub = i === 0 ? seed : hash32(seed, i)
    const project = randomProject(sub, { layers: opts.layers, bg: opts.bg })
    onProgress?.(i + 1, maxTries)

    const out = await requestRender(project, () => {})
    // The service coalesces: if a preview render superseded us, `out` belongs
    // to a different project. Skip the attempt rather than measure a lie.
    if (out.results.length !== activeLayers(project).length) continue

    const metrics = measureProject(project, out.results)
    const verdict = judge(metrics)
    onAttempt?.({ project, metrics, verdict, attempt: i + 1 })
    const attempt: CheckedRandom = { project, metrics, verdict, attempts: i + 1, budgetHit: false }
    if (!best || attempt.verdict.score > best.verdict.score) best = attempt

    if (verdict.ok) return { ...attempt, budgetHit }

    if (performance.now() >= deadline) {
      budgetHit = true
      break
    }
    // yield so the loading state can actually paint between rolls
    await nextTick()
  }

  if (!best) {
    // unreachable in practice (the loop always runs once), but never return null
    const project = randomProject(seed, { layers: opts.layers, bg: opts.bg })
    const out = await requestRender(project, () => {})
    const metrics = measureProject(project, out.results)
    return { project, metrics, verdict: judge(metrics), attempts: 1, budgetHit: true }
  }
  return { ...best, budgetHit }
}
