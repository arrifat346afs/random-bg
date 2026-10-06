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
import { oklchFromRgb } from './field/oklab'
import { quenchAdditive, softenHarsh, randomProject } from './randomize'
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
/**
 * Coverage above which there is no visible ground left, so content/ground
 * separation is vacuous — full-bleed results are judged on their own merits
 * (noise, hues, focus, grid) instead of an always-firing `merged`.
 */
export const SEPARATION_MAX_COVERAGE = 95
/** Focal demand applies only when there is structure to focus (edge floor). */
export const FOCAL_MIN_EDGE = 0.08
/** Fewer primitives than this reads as an accident (soft penalty). */
export const NODES_MIN = 16
/** Edge density above which a result reads as high-frequency noise. */
export const EDGE_MAX = 0.25
/** Distinct hues above which the palette reads as confetti (5 + 1 accent). */
export const HUES_MAX = 6
/** Focal luminance gap below which there is no clear focal region. */
export const FOCAL_MIN = 8
/** Uniform-grid coverage above which the grid dominates the canvas. */
export const GRID_COVERAGE_MAX = 40
/** Edge harshness above which saturated edges read cheap (calibrated). */
export const HARSH_MAX = 1.5
/** % of composite pixels at pure white above which highlights have clipped. */
export const WHITE_CAP = 3
/** Largest single pure-white region (% of canvas) above which it reads as a hole. */
export const WHITE_REGION_MAX = 8

/* ---- Metrics ------------------------------------------------------------ */

export interface Metrics {
  /** % of pixels carrying content (measured on transparent). */
  coverage: number
  /** Mean luma 0–255 of the preview over its own ground. */
  meanLuma: number
  /** % of pixels that are pure white. */
  whiteShare: number
  /** % of composite pixels (over its own ground) at pure white — clipped highlights. */
  whiteComposite: number
  /** Largest 4-connected pure-white region, % of canvas. */
  whiteRegion: number
  /** High-frequency energy: share of pixels with a strong luma step. */
  edge: number
  /** Distinct hues carrying >3% of saturation-weighted mass (max ~12). */
  hueCount: number
  /** Luminance gap between the brightness centre-of-mass region and the rest. */
  focal: number
  /**
   * Edge harshness: mean over edge pixels of (step × OKLab delta × chroma of
   * the brighter side) × 100. Hard saturated edges on dark read ~10+; calm
   * gradients read < 1.
   */
  harshness: number
  /** True when a uniform grid layer (mosaic, geometric grid) is present. */
  gridLayer: boolean
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
  code:
    | 'blank'
    | 'dark'
    | 'blown'
    | 'flat'
    | 'merged'
    | 'sparse'
    | 'whiteCap'
    | 'whiteRegion'
    | 'noisy'
    | 'manyHues'
    | 'noFocus'
    | 'gridPattern'
    | 'harsh'
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
  if (m.whiteComposite > WHITE_CAP)
    hard.push({
      code: 'whiteCap',
      why: `${m.whiteComposite.toFixed(1)}% clipped white > ${WHITE_CAP}%`,
    })
  if (m.whiteRegion > WHITE_REGION_MAX)
    hard.push({
      code: 'whiteRegion',
      why: `white region ${m.whiteRegion.toFixed(1)}% > ${WHITE_REGION_MAX}%`,
    })

  if (m.contrast < CONTRAST_MIN)
    soft.push({
      code: 'flat',
      why: `contrast ${m.contrast.toFixed(1)} < ${CONTRAST_MIN}`,
    })
  if (m.separation < SEPARATION_MIN && m.coverage < SEPARATION_MAX_COVERAGE)
    soft.push({
      code: 'merged',
      why: `content/ground gap ${m.separation.toFixed(1)} < ${SEPARATION_MIN}`,
    })
  if (m.nodes < NODES_MIN)
    soft.push({
      code: 'sparse',
      why: `${m.nodes} primitives < ${NODES_MIN}`,
    })
  if (m.edge > EDGE_MAX)
    soft.push({
      code: 'noisy',
      why: `edge density ${m.edge.toFixed(2)} > ${EDGE_MAX}`,
    })
  if (m.hueCount > HUES_MAX)
    soft.push({
      code: 'manyHues',
      why: `${m.hueCount} hues > ${HUES_MAX}`,
    })
  if (m.focal < FOCAL_MIN && m.edge > FOCAL_MIN_EDGE)
    soft.push({
      code: 'noFocus',
      why: `focal contrast ${m.focal.toFixed(1)} < ${FOCAL_MIN}`,
    })
  if (m.gridLayer && m.coverage > GRID_COVERAGE_MAX)
    soft.push({
      code: 'gridPattern',
      why: `uniform grid covers ${m.coverage.toFixed(1)}% > ${GRID_COVERAGE_MAX}%`,
    })
  if (m.harshness > HARSH_MAX)
    soft.push({
      code: 'harsh',
      why: `edge harshness ${m.harshness.toFixed(1)} > ${HARSH_MAX}`,
    })

  const ok = hard.length === 0 && soft.length < 2

  let score = 0
  score += Math.min(m.coverage, 45) // presence
  score += Math.min(m.contrast, 70) * 0.6 // structure
  score += m.meanLuma >= 6 && m.meanLuma <= 210 ? 18 : 0 // usable exposure
  score -= Math.max(0, m.whiteShare - 15) * 2 // blowout
  score -= Math.max(0, m.whiteComposite - 1.5) * 6 // clipped highlights
  score += Math.min(m.focal, 40) * 0.25 // a clear focal region
  score -= Math.max(0, m.hueCount - 4) * 4 // limited palette
  score -= Math.max(0, m.edge - 0.2) * 50 // calm surfaces
  score -= Math.max(0, m.harshness - 3) * 3 // harsh saturated edges
  score -= soft.length * 12 // each penalty costs a little
  score -= hard.length * 40 // hard failures rank last

  return { ok, score, hard, soft }
}

/* ---- Measurement -------------------------------------------------------- */

const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** Saturation + hue of an sRGB triple (h 0..360, s 0..1) for the hue census. */
function rgbSatHue(r: number, g: number, b: number): [number, number] {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const mx = Math.max(R, G, B)
  const mn = Math.min(R, G, B)
  const l = (mx + mn) / 2
  let h = 0
  let s = 0
  if (mx !== mn) {
    const d = mx - mn
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    if (mx === R) h = ((G - B) / d + (G < B ? 6 : 0)) * 60
    else if (mx === G) h = ((B - R) / d + 2) * 60
    else h = ((R - G) / d + 4) * 60
  }
  return [h, s]
}

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
  const ir = compositeLayers(project, results)
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
  let whiteComp = 0
  let sum = 0
  let sumSq = 0
  let fgSum = 0
  let fgN = 0
  let bgSum = 0
  let bgN = 0
  // composite pure-white mask, for the largest-region flood fill below
  const whiteMask = new Uint8Array(n)
  // luma field, for the designed-look pass (edge / hue / focal) below
  const lum = new Float32Array(n)

  for (let i = 0; i < bd.length; i += 4) {
    const a = bd[i + 3]
    if (a >= 8) covered++
    if (a >= 240 && bd[i] >= 250 && bd[i + 1] >= 250 && bd[i + 2] >= 250) white++
    if (pd[i] >= 250 && pd[i + 1] >= 250 && pd[i + 2] >= 250) {
      whiteComp++
      whiteMask[i / 4] = 1
    }

    const L = luma(pd[i], pd[i + 1], pd[i + 2])
    lum[i / 4] = L
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

  // largest 4-connected pure-white region (% of canvas) — a big white hole
  // reads as broken even when the total white share is modest
  let whiteRegion = 0
  {
    const seen = new Uint8Array(n)
    const stack: number[] = []
    for (let i = 0; i < n; i++) {
      if (!whiteMask[i] || seen[i]) continue
      let size = 0
      stack.push(i)
      seen[i] = 1
      while (stack.length) {
        const c = stack.pop() as number
        size++
        const cx = c % bw
        if (cx > 0 && whiteMask[c - 1] && !seen[c - 1]) {
          seen[c - 1] = 1
          stack.push(c - 1)
        }
        if (cx < bw - 1 && whiteMask[c + 1] && !seen[c + 1]) {
          seen[c + 1] = 1
          stack.push(c + 1)
        }
        if (c >= bw && whiteMask[c - bw] && !seen[c - bw]) {
          seen[c - bw] = 1
          stack.push(c - bw)
        }
        if (c < n - bw && whiteMask[c + bw] && !seen[c + bw]) {
          seen[c + bw] = 1
          stack.push(c + bw)
        }
      }
      if (size > whiteRegion) whiteRegion = size
    }
    whiteRegion = (whiteRegion / Math.max(1, n)) * 100
  }

  const meanLuma = sum / Math.max(1, n)
  const variance = Math.max(0, sumSq / Math.max(1, n) - meanLuma * meanLuma)
  const fgLuma = fgN ? fgSum / fgN : meanLuma
  const groundLuma = bgN ? bgSum / bgN : meanLuma

  // designed-look pass over the composite: high-frequency energy, hue
  // count and focal contrast. One extra pixel loop (~65k px) — cheap next
  // to the renders that produced these pixels.
  let edgeN = 0
  let comX = 0
  let comY = 0
  let comW = 0
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const L = lum[y * bw + x]
      comX += x * L
      comY += y * L
      comW += L
    }
  }
  const fcx = comW > 0 ? comX / comW : bw / 2
  const fcy = comW > 0 ? comY / comW : bh / 2
  const fr = Math.min(bw, bh) * 0.25
  const hueHist = new Array(12).fill(0)
  let fIn = 0
  let fInN = 0
  let fOut = 0
  let fOutN = 0
  const harshScores: number[] = []
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = y * bw + x
      if (x < bw - 1 && y < bh - 1) {
        const step = Math.abs(lum[i] - lum[i + 1]) + Math.abs(lum[i] - lum[i + bw])
        if (step > 30) {
          edgeN++
          // harshness: sharpness × OKLab distance × chroma of the brighter side
          const o1 = i * 4
          const o2 = (i + 1) * 4
          const c1 = oklchFromRgb(pd[o1], pd[o1 + 1], pd[o1 + 2])
          const c2 = oklchFromRgb(pd[o2], pd[o2 + 1], pd[o2 + 2])
          const r1 = (c1.H * Math.PI) / 180
          const r2 = (c2.H * Math.PI) / 180
          const delta = Math.hypot(c1.L - c2.L, c1.C * Math.cos(r1) - c2.C * Math.cos(r2), c1.C * Math.sin(r1) - c2.C * Math.sin(r2))
          const bright = lum[i] >= lum[i + 1] ? c1 : c2
          harshScores.push((step / 255) * delta * bright.C)
        }
      }
      const o = i * 4
      const [h, s] = rgbSatHue(pd[o], pd[o + 1], pd[o + 2])
      hueHist[Math.min(11, Math.floor((((h % 360) + 360) % 360) / 30))] += s
      const dx = x - fcx
      const dy = y - fcy
      if (dx * dx + dy * dy <= fr * fr) {
        fIn += lum[i]
        fInN++
      } else {
        fOut += lum[i]
        fOutN++
      }
    }
  }
  let hueTotal = 0
  for (const v of hueHist) hueTotal += v
  let hueCount = 0
  for (const v of hueHist) if (hueTotal > 0 && v / hueTotal > 0.03) hueCount++
  const gridLayer = project.layers.some(
    (l) => l.gen === 'mosaic' || (l.gen === 'geometric' && (l.params.mode === 'grid' || l.params.mode === 'hexGrid')),
  )
  // harshness: mean of the hottest decile of edge scores — a few hard
  // saturated edges must not drown in a majority of soft ones
  let harshness = 0
  if (harshScores.length > 0) {
    harshScores.sort((a, b) => b - a)
    const k = Math.max(1, Math.ceil(harshScores.length / 10))
    let top = 0
    for (let i = 0; i < k; i++) top += harshScores[i]
    harshness = (top / k) * 100
  }

  return {
    coverage: (covered / Math.max(1, n)) * 100,
    meanLuma,
    whiteShare: (white / Math.max(1, n)) * 100,
    whiteComposite: (whiteComp / Math.max(1, n)) * 100,
    whiteRegion,
    edge: edgeN / Math.max(1, (bw - 1) * (bh - 1)),
    harshness,
    hueCount,
    focal: Math.abs(fIn / Math.max(1, fInN) - fOut / Math.max(1, fOutN)),
    gridLayer,
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
  /**
   * Pin the canvas to an exact size for every attempt (the aspect lock).
   * Omitted → each attempt rolls its own size from the curated pool.
   */
  canvas?: { w: number; h: number }
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

/** True when every hard failure is a clipped-white one (rescuable by quench). */
function onlyWhiteFailure(v: Verdict): boolean {
  return (
    v.hard.length > 0 &&
    v.hard.every((r) => r.code === 'whiteCap' || r.code === 'whiteRegion' || r.code === 'blown') &&
    v.soft.length < 2
  )
}

/** True when the only complaint is harsh saturated edges (rescuable by soften). */
function onlyHarshFailure(v: Verdict): boolean {
  return v.hard.length === 0 && v.soft.length > 0 && v.soft.every((r) => r.code === 'harsh')
}

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
    const project = randomProject(sub, {
      layers: opts.layers,
      bg: opts.bg,
      canvas: opts.canvas,
    })
    onProgress?.(i + 1, maxTries)

    const out = await requestRender(project, () => {})
    // The service coalesces: if a preview render superseded us, `out` belongs
    // to a different project. Skip the attempt rather than measure a lie.
    if (out.results.length !== activeLayers(project).length) continue

    const metrics = measureProject(project, out.results)
    let verdict = judge(metrics)
    onAttempt?.({ project, metrics, verdict, attempt: i + 1 })
    let attempt: CheckedRandom = { project, metrics, verdict, attempts: i + 1, budgetHit: false }

    // White-only failure → one deterministic rescue: dim the additive stack
    // (`quenchAdditive` is pure, so the rescue is seed-deterministic) and
    // re-measure within the same attempt instead of burning a re-roll.
    if (!verdict.ok && onlyWhiteFailure(verdict)) {
      const rescued = quenchAdditive(project)
      const reOut = await requestRender(rescued, () => {})
      if (reOut.results.length === activeLayers(rescued).length) {
        const reMetrics = measureProject(rescued, reOut.results)
        const reVerdict = judge(reMetrics)
        onAttempt?.({ project: rescued, metrics: reMetrics, verdict: reVerdict, attempt: i + 1 })
        attempt = { project: rescued, metrics: reMetrics, verdict: reVerdict, attempts: i + 1, budgetHit: false }
        verdict = reVerdict
      }
    }
    // Harsh-only failure → same treatment via softenHarsh (halved outlines,
    // dimmed flat overlays, leashed chroma).
    if (!verdict.ok && onlyHarshFailure(verdict)) {
      const softened = softenHarsh(attempt.project)
      const reOut = await requestRender(softened, () => {})
      if (reOut.results.length === activeLayers(softened).length) {
        const reMetrics = measureProject(softened, reOut.results)
        const reVerdict = judge(reMetrics)
        onAttempt?.({ project: softened, metrics: reMetrics, verdict: reVerdict, attempt: i + 1 })
        attempt = { project: softened, metrics: reMetrics, verdict: reVerdict, attempts: i + 1, budgetHit: false }
        verdict = reVerdict
      }
    }
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
