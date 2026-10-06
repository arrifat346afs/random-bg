/**
 * randomize.ts — The "infinite possibilities" engine.
 *
 * Randomisation is *curated*: distributions are weighted per generator,
 * palettes come from harmony theory, blend modes come from a tasteful set and
 * modifier counts are bounded. That is the difference between "designed" and
 * "noise" — and it is what makes 20 random projects in a row look good.
 */

import { createRng, hash32, type RNG } from './rng'
import { generatePalette, hexToRgb, PRESET_PALETTES, PALETTE_KEYS, type Harmony, type Palette } from './palette'
import { GENERATORS, getGenerator, minCountFor, FAMILY_WEIGHTS } from './generators'
import { createLayer, duplicateLayer, newId } from './project'
import { defaultModifier } from './modifiers'
import { randomFilterStack, resampleFilterStack } from './filters/random'
import { ensureFilters } from './filters/stack'
import { DIST_OPTIONS, defaultDist, type DistSpec, type Layer, type ModifierSpec, type Params, type Project, type ModType, type ParamDef, type ParamValue } from './schema'
import type { BlendMode } from './ir'

/* ---- Curated sampling tables ------------------------------------------- */

/** Distributions that read well with each generator. */
const DIST_WEIGHTS: Record<string, Partial<Record<DistSpec['type'], number>>> = {
  particles: {
    uniform: 3, gaussian: 3, clustered: 3, poisson: 3, radial: 3, spiral: 2,
    noiseMask: 2.5, sineBand: 2, curve: 2, gridJitter: 1.4, imageMask: 1,
  },
  bokeh: { uniform: 3, gaussian: 3.5, clustered: 3, poisson: 2.5, radial: 2, noiseMask: 2, sineBand: 1.2, curve: 1.2 },
  streaks: { curve: 3, sineBand: 3, uniform: 2.5, gaussian: 2, radial: 1.5, spiral: 2, noiseMask: 1.5 },
  rays: { uniform: 2, gaussian: 3, radial: 3, clustered: 2.5, poisson: 2, noiseMask: 1.5 },
  flow: { uniform: 4, gaussian: 3, poisson: 3, noiseMask: 2.5, clustered: 2, gridJitter: 1.5 },
  emitters: { uniform: 4, gaussian: 3, radial: 3, curve: 2.5, clustered: 2, spiral: 2.5, sineBand: 1.5 },
  scatter: { uniform: 3.5, gaussian: 3, clustered: 3, poisson: 3, noiseMask: 2, curve: 1.5, sineBand: 1.5, imageMask: 1 },
  smoke: { uniform: 3, gaussian: 4, clustered: 3.5, radial: 2, noiseMask: 2, poisson: 2 },
  geometric: { uniform: 6 },
  grain: { uniform: 6 },
  // ribbons anchor on samples then draw long curves — clustered / curve /
  // sineBand give them somewhere to go; uniform still fine for sweeps
  ribbons: { curve: 3, sineBand: 2.5, clustered: 2.5, uniform: 2.5, gaussian: 2, radial: 2, spiral: 1.5 },
  // gradient shapes place their own slots; the dist only seeds anchors —
  // keep it calm so stacks and columns stay coherent
  gradShapes: { uniform: 4, gaussian: 3, clustered: 2 },
  // mosaic covers the whole grid itself; the dist only seeds ribbon-style
  // anchors, so any choice behaves the same — uniform keeps it cheap
  mosaic: { uniform: 6 },
}

/** Blend modes that consistently look good as a layer blend. */
const GOOD_BLENDS: BlendMode[] = [
  'normal', 'screen', 'plus-lighter', 'normal', 'screen',
  'lighten', 'overlay', 'multiply', 'soft-light', 'color-dodge',
]

/** Realistic layer opacity ranges per blend. */
function opacityFor(blend: BlendMode, rng: RNG): number {
  switch (blend) {
    case 'plus-lighter':
      return rng.range(0.35, 0.85)
    case 'screen':
      return rng.range(0.5, 0.95)
    case 'multiply':
      return rng.range(0.4, 0.9)
    case 'color-dodge':
      return rng.range(0.25, 0.7)
    default:
      return rng.range(0.55, 1)
  }
}

const DARK_BGS = ['#08080c', '#0b0a12', '#071018', '#120a08', '#0a0f0d', '#140d1a']
const LIGHT_BGS = ['#f6f4ef', '#ffffff', '#f2f5fa', '#faf6f0']

/**
 * Backgrounds that cannot turn into white-on-white on their own. Kept
 * separate from the full pool so `pairBackground` can fall back to a dark
 * option without having to reason about each kind again.
 */
const DARK_BACKGROUND_POOL = (): Project['canvas']['bg'][] => [
  { kind: 'transparent' },
  { kind: 'transparent' },
  { kind: 'solid', color: '#08080c' },
  { kind: 'gradient', from: '#05050a', to: '#161227', angle: 135 },
  { kind: 'solid', color: '#071018' },
  { kind: 'gradient', from: '#1a0b05', to: '#0a0a12', angle: 210 },
  { kind: 'gradient', from: '#0a0f0d', to: '#04202a', angle: 90 },
  ...DARK_BGS.map((color) => ({ kind: 'solid' as const, color })),
  { kind: 'noise', color: '#0a0a10', amount: 0.16 },
]

const BACKGROUND_POOL = (): Project['canvas']['bg'][] => [
  ...DARK_BACKGROUND_POOL(),
  ...LIGHT_BGS.map((color) => ({ kind: 'solid' as const, color })),
]

/* ---- Brightness budget ---------------------------------------------------
 * Additive layers are the only reliable way to blow out a canvas:
 * `plus-lighter` and friends accumulate, so four of them stacked at full
 * opacity go white long before anyone asked for it. Two levers keep random
 * projects out of that ditch:
 *
 *  1. a budget on the summed additive weight — over budget, opacity and
 *     density come down together, so the *shape* of the design survives
 *     instead of just going dim in one spot;
 *  2. background pairing — a light background is only kept when the palette is
 *     dark *and* the additive load is light. Otherwise a bright layer on a
 *     bright ground has nowhere to go but white.
 */

/** Blend modes that add light rather than replace it. */
const ADDITIVE_BLENDS: ReadonlySet<BlendMode> = new Set([
  'plus-lighter',
  'screen',
  'lighten',
  'overlay',
  'soft-light',
  'color-dodge',
])

/** Additive load one canvas can carry before it starts clipping. */
const ADDITIVE_BUDGET = 2
/** A palette brighter than this never sits on a light background. */
const LIGHT_BG_MAX_PALETTE_LUMA = 90
/** Additive load above this rules a light background out on its own. */
const LIGHT_BG_MAX_ADDITIVE = 0.8
/** Light backgrounds are only defended above this perceived brightness. */
const LIGHT_BG_LUMA = 185

const round3 = (x: number): number => Math.round(x * 1000) / 1000

function lumaOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Summed weight of the additive layers. Textures weigh more than a scatter of
 * dots: a grain or haze layer covers the whole canvas, so its opacity is felt
 * everywhere at once.
 */
function additiveLoad(layers: Layer[]): number {
  let w = 0
  for (const l of layers) {
    if (!ADDITIVE_BLENDS.has(l.blend)) continue
    w += l.opacity * (getGenerator(l.gen)?.family === 'texture' ? 1.4 : 1)
  }
  return w
}

/** Bring an over-budget stack back under `ADDITIVE_BUDGET`, if it is one. */
function brightnessBudget(layers: Layer[]): Layer[] {
  const load = additiveLoad(layers)
  if (load <= ADDITIVE_BUDGET) return layers
  // soft shoulder (Reinhard-style): gentle just over budget, increasingly
  // firm far over — highlights roll off instead of hitting a linear wall
  const over = load - ADDITIVE_BUDGET
  const k = ADDITIVE_BUDGET / load / (1 + over * 0.35)
  return layers.map((l) => {
    if (!ADDITIVE_BLENDS.has(l.blend)) return l
    const params: Params = { ...l.params }
    const c = params.count
    if (typeof c === 'number' && Number.isFinite(c)) {
      // thin by only *half* the factor: opacity does most of the corrective
      // work, and halving density as hard would leave the layer as sparse dust
      params.count = Math.max(minCountFor(l.gen), Math.round(c * (0.5 + 0.5 * k)))
    }
    return { ...l, params, opacity: Math.max(0.25, round3(l.opacity * k)) }
  })
}

/**
 * One deterministic rescue pass for a project that rendered too hot: halve
 * the opacity of every additive layer and thin its counts toward the
 * generator floor. Pure (a function of the project only), so the gate can
 * apply it to a failing attempt and re-measure without breaking seed
 * determinism. See `randomProjectChecked` — the quench path for white
 * verdicts.
 */
export function quenchAdditive(project: Project): Project {
  const next: Project = structuredClone(project)
  for (const l of next.layers) {
    if (!ADDITIVE_BLENDS.has(l.blend)) continue
    l.opacity = Math.max(0.2, round3(l.opacity * 0.55))
    const floor = minCountFor(l.gen)
    for (const key of ['count', 'density', 'dustCount']) {
      const cur = l.params[key]
      if (typeof cur === 'number' && cur > floor) {
        l.params[key] = Math.max(floor, Math.round(cur * 0.7))
      }
    }
  }
  return next
}

/**
 * Keep a light background only when the content can survive on it; otherwise
 * swap in a dark one. Deterministic — draws from the project's own `rng`.
 */
function pairBackground(
  bg: Project['canvas']['bg'],
  palette: Palette,
  layers: Layer[],
  rng: RNG,
): Project['canvas']['bg'] {
  if (bg.kind === 'transparent') return bg
  const bgLuma =
    bg.kind === 'gradient'
      ? (lumaOf(bg.from) + lumaOf(bg.to)) / 2
      : lumaOf(bg.color)
  if (bgLuma <= LIGHT_BG_LUMA) return bg

  const paletteLuma =
    palette.colors.reduce((s, c) => s + lumaOf(c), 0) / Math.max(1, palette.colors.length)
  const darkEnoughPalette = paletteLuma < LIGHT_BG_MAX_PALETTE_LUMA
  const lightEnoughLoad = additiveLoad(layers) < LIGHT_BG_MAX_ADDITIVE
  if (darkEnoughPalette && lightEnoughLoad) return bg

  const pool = DARK_BACKGROUND_POOL()
  return pool[rng.int(0, pool.length - 1)]
}

/* ---- Parameter sampling ------------------------------------------------- */

export function randomParamValue(def: ParamDef, rng: RNG, towardDefault = 0.35): ParamValue {
  const fallback = def.default
  if (def.type === 'bool') return rng.next() < 0.6 ? fallback : !fallback
  if (def.type === 'enum') {
    if (!def.options?.length) return fallback
    return rng.pick(def.options).value as ParamValue
  }
  if (def.type === 'color') {
    const c = rng.pick(Object.values(PRESET_PALETTES))
    return c[0]
  }
  if (def.type === 'text' || def.type === 'path') return fallback
  if (def.type === 'range') {
    const lo = def.min ?? 0
    const hi = def.max ?? 1
    const a = Math.min(lo, hi)
    const b = Math.max(lo, hi)
    return [rng.range(a, b), rng.range(a, b)]
  }

  const lo = def.rand?.min ?? def.min ?? 0
  const hi = def.rand?.max ?? def.max ?? 1
  let t = rng.next()
  if (def.rand?.bias === 'low') t = Math.pow(t, 2)
  if (def.rand?.bias === 'high') t = 1 - Math.pow(1 - t, 2)
  if (def.type === 'int') t = Math.round(t * (hi - lo)) / Math.max(1, hi - lo)
  // pull a slice of values back toward the designed default
  if (rng.next() < towardDefault && typeof fallback === 'number') {
    t = (t + (fallback - lo) / Math.max(1e-6, hi - lo)) / 2
  }
  const v = lo + t * (hi - lo)
  const step = def.step ?? (def.type === 'int' ? 1 : 0.01)
  const snapped = Math.round(v / step) * step
  const clamped = Math.max(def.min ?? -Infinity, Math.min(def.max ?? Infinity, snapped))
  return def.type === 'int' ? Math.round(clamped) : Number(clamped.toFixed(4))
}

export function randomizeParams(
  defs: ParamDef[],
  rng: RNG,
  base?: Params,
  locks?: Record<string, boolean>,
): { params: Params; locks: Record<string, true> } {
  const params: Params = {}
  const lockOut: Record<string, true> = {}
  for (const def of defs) {
    if (base && def.key in base && base[def.key] !== undefined) params[def.key] = base[def.key]
    if (locks?.[def.key]) {
      if (base && base[def.key] !== undefined) params[def.key] = base[def.key]
      lockOut[def.key] = true
      continue
    }
    params[def.key] = randomParamValue(def, rng)
  }
  return { params, locks: lockOut }
}

/* ---- Distribution sampling ---------------------------------------------- */

const ALL_DISTS = DIST_OPTIONS.map((d) => d.value)

export function randomDist(genId: string, rng: RNG): DistSpec {
  const weights = DIST_WEIGHTS[genId] ?? {}
  const items = ALL_DISTS.filter((d) => (weights[d] ?? 0.4) > 0)
  const w = items.map((d) => weights[d] ?? 0.4)
  const type = rng.weighted(items, w)
  const dist: DistSpec = { ...defaultDist(), type }

  switch (type) {
    case 'clustered': dist.clusters = rng.int(3, 12); break
    case 'curve':
      dist.curve = rng.pick(['sine', 'arc', 'diagonal', 'spiral', 'v'] as const)
      dist.curveAmount = rng.range(0.15, 0.7)
      break
    case 'sineBand':
      dist.band = rng.range(0.05, 0.3)
      dist.arms = rng.int(1, 3)
      dist.curveAmount = rng.range(0.2, 0.8)
      break
    case 'radial':
      dist.inner = rng.next() < 0.5 ? rng.range(0, 0.35) : rng.range(0.3, 0.8)
      dist.radialFalloff = rng.range(0.5, 2.4)
      break
    case 'spiral':
      dist.arms = rng.int(2, 7)
      dist.inner = rng.range(0, 0.3)
      dist.curveAmount = rng.range(0.2, 1)
      break
    case 'gridJitter':
      dist.clusters = rng.int(9, 64)
      dist.curveAmount = rng.range(0.1, 0.7)
      break
    case 'poisson': dist.radius = rng.range(0.02, 0.12); break
    case 'noiseMask':
      dist.noiseScale = rng.range(1, 7)
      dist.noiseThreshold = rng.range(0.3, 0.62)
      dist.noiseContrast = rng.range(0.7, 2)
      break
    default: break
  }

  // shared shaping — the things that make distributions feel "designed"
  dist.depth = rng.next() < 0.75 ? rng.range(0.15, 0.75) : rng.range(0, 0.15)
  dist.sizePower = rng.pick([0.6, 0.8, 1, 1, 1.3, 1.8, 2.4])
  dist.sizeMin = rng.range(0.25, 0.7)
  dist.sizeMax = 1
  dist.opacityFalloff = rng.range(0, 0.55)
  dist.edgeFalloff = rng.next() < 0.35 ? rng.range(0.2, 0.75) : 0
  return dist
}

/* ---- Modifier sampling --------------------------------------------------- */

const MOD_CHANCE = 0.42

function randomMods(genId: string, rng: RNG): ModifierSpec[] {
  // a smooth field base is never standpoint-modified: displacing a handful of
  // giant blobs only moves colour around, never improves it
  if (genId === 'mesh') return []
  if (rng.next() > 0.72) return []
  const mods: ModifierSpec[] = []
  const candidates: ModType[] = ['noise', 'twist', 'kaleido', 'mirror', 'array', 'scaleByPos', 'colorByPos', 'axisFade', 'jitter']
  // geometry generators love symmetry; particle layers love jitter — except
  // smooth silhouettes (scatter, bokeh), where noise/jitter displacement
  // roughens edges into jagged contours instead of organic variation
  const smoothSilhouette = genId === 'scatter' || genId === 'bokeh'
  const calmCandidates: ModType[] = ['twist', 'mirror', 'array', 'scaleByPos', 'colorByPos', 'axisFade']
  const bias =
    genId === 'geometric' || genId === 'gradShapes' || genId === 'mosaic' ? ['kaleido', 'mirror', 'twist', 'array'] :
    genId === 'ribbons' ? ['twist', 'mirror', 'colorByPos', 'axisFade'] :
    genId === 'grain' ? [] :
    smoothSilhouette ? ['colorByPos', 'axisFade', 'scaleByPos'] :
    ['noise', 'jitter', 'axisFade', 'colorByPos']
  const n = rng.next() < 0.25 ? 2 : 1
  for (let i = 0; i < n; i++) {
    if (rng.next() > MOD_CHANCE && i > 0) break
    const pool = bias.length && rng.next() < 0.6 ? bias : smoothSilhouette ? calmCandidates : candidates
    const type = rng.pick(pool) as ModType
    if (mods.some((m) => m.type === type)) continue
    const mod = defaultModifier(type)
    mod.amount = jitterAmount(mod.amount, rng)
    mod.secondary = jitterAmount(mod.secondary, rng)
    mod.tertiary = jitterAmount(mod.tertiary, rng)
    mods.push(mod)
  }
  return mods
}

function jitterAmount(v: number, rng: RNG): number {
  return Number((v * rng.range(0.5, 1.5)).toFixed(3))
}

/* ---- Layer sampling ------------------------------------------------------ */

export interface LayerSampleOpts {
  genId?: string
  palette?: Palette
  rng: RNG
  strength?: number
}

export function randomLayer(opts: LayerSampleOpts): Layer {
  const { rng } = opts
  const genId = opts.genId ?? pickGenerator(rng)
  const gen = getGenerator(genId)
  const palette = opts.palette ?? generatePalette(rng)
  const layerSeed = Math.floor(rng.next() * 1e9)
  const layer = createLayer(genId, layerSeed, {
    name: gen?.name ?? genId,
  })

  const { params, locks } = randomizeParams(gen?.params ?? [], rng)
  layer.params = params
  fitDensity(genId, layer.params, 7000)
  layer.locks = locks
  layer.dist = randomDist(genId, rng)
  layer.mods = randomMods(genId, rng)
  layer.blend = rng.weighted(GOOD_BLENDS, GOOD_BLENDS.map((b) => (b === 'normal' ? 2.4 : 1)))
  layer.opacity = opacityFor(layer.blend, rng)
  layer.color = {
    mode: rng.weighted(
      ['palette', 'position', 'size', 'random'] as const,
      [4, 2, 1.4, 1.4],
    ),
    palette: {
      name: palette.name,
      colors: palette.colors.slice(),
    },
    ramp: rng.pick(['linear', 'ease', 'bilinear', 'mirror'] as const),
    axis: rng.int(0, 360),
    invert: rng.next() < 0.2,
    linked: true,
  }
  // 0–2 tasteful filters, drawn from a deliberately short safe list (grain, a
  // slight blur, a soft glow, small colour grades) — see `filters/random.ts`.
  // Without these a random project is a bit flat; with anything broader it stops
  // being good work.
  //
  // Forked off the layer seed rather than drawn from `rng`: the filter stack is a
  // *post-process*, so it must not steal draws from the stream that makes the
  // artwork. Drawing here inline silently re-rolled every shape, palette and
  // canvas size for every existing seed the first time filters landed.
  layer.filters = randomFilterStack(rng.fork('filters', layerSeed))
  layer.filtersBypassed = false
  tameScatter(layer, rng.fork('tame', layerSeed), 0.8)
  tameRings(layer, rng.fork('rings', layerSeed))
  litScatter(layer)
  return layer
}

/**
 * Shapes layered over smooth surfaces must read lit, not flat clip-art: keep
 * scatter's inner shading on and its outline strokes below heavy. Pure clamps
 * (no RNG), so the artwork stream is untouched.
 */
function litScatter(layer: Layer): void {
  if (layer.gen !== 'scatter') return
  const params = { ...layer.params }
  if (typeof params.shade === 'number') params.shade = Math.max(params.shade, 0.3)
  if (typeof params.outline === 'number') params.outline = Math.min(params.outline, 0.5)
  // snowflake arms are thin strokes: below this size they read as stray ticks
  // and brackets instead of flakes (the snowflake-result artefact)
  if (params.shape === 'snowflake' && typeof params.size === 'number') {
    params.size = Math.max(params.size, 18)
  }
  layer.params = params
}

/**
 * Scatter shapes that read cheap at scale (hearts, leaves, petals) are
 * opt-in accents: resample most of them to neutral shapes, and keep any
 * survivor small. `p` is the resample probability — the base layer of a
 * project calls with 1 so cutesy shapes are never the main layer.
 */
const CUTESY_SCATTER = ['heart', 'leaf', 'petal']
const NEUTRAL_SCATTER = ['confetti', 'star', 'hex', 'snowflake']

export function tameScatter(layer: Layer, rng: RNG, p: number): void {
  if (layer.gen !== 'scatter') return
  const shape = layer.params.shape
  if (typeof shape !== 'string' || !CUTESY_SCATTER.includes(shape)) return
  if (rng.next() < p) {
    layer.params = { ...layer.params, shape: rng.pick(NEUTRAL_SCATTER) }
    return
  }
  const size = layer.params.size
  if (typeof size === 'number' && size > 48) {
    layer.params = { ...layer.params, size: 48 }
  }
}

/**
 * Bokeh `ring` outlines at low alpha read as stray ellipse artefacts rather
 * than intentional optics. Keep the shape in the pool but deal it rarely —
 * most ring rolls become soft filled discs.
 */
export function tameRings(layer: Layer, rng: RNG): void {
  if (layer.gen !== 'bokeh') return
  if (layer.params.shape !== 'ring') return
  if (rng.next() < 0.85) {
    layer.params = { ...layer.params, shape: 'round' }
  }
}

export function pickGenerator(rng: RNG): string {
  // read the registry weights so adding a family or re-weighting one place
  // updates every roll; previously this hardcoded a copy of the table.
  // Learned taste multiplies in: family weights scale by member mean,
  // within-family picks weight by per-generator multiplier (1 = neutral).
  const families = FAMILY_WEIGHTS.map(([f]) => f)
  const weights = FAMILY_WEIGHTS.map(([f, w]) => {
    const members = GENERATORS.filter((g) => g.family === f)
    const mean =
      members.length > 0
        ? members.reduce((s, g) => s + genMult(g.id), 0) / members.length
        : 1
    return w * Math.max(0.5, Math.min(2, mean))
  })
  const family = rng.weighted(families, weights)
  const pool = GENERATORS.filter((g) => g.family === family)
  if (!pool.length) return rng.pick(GENERATORS).id
  return rng.weighted(pool, pool.map((g) => genMult(g.id))).id
}

/**
 * Learned taste multipliers (human feedback loop). Module-level and neutral
 * by default: the same seed rolls the same project until the user rates
 * something, at which point taste shifts — deterministically per rater state.
 * Values clamp to [0.3, 3] at the source (`feedback.ts`).
 */
let learnedGenMult: Record<string, number> = {}

export function setLearnedGenMult(mult: Record<string, number>): void {
  learnedGenMult = { ...mult }
}

const genMult = (id: string): number => {
  const m = learnedGenMult[id] ?? 1
  return m > 0 && Number.isFinite(m) ? m : 1
}

/**
 * Busy generators (many small primitives fighting for attention) — at most
 * ONE per project, and never combined with a full-bleed pattern. There is no
 * `glyph`/`snow` generator in the registry; the snowflake *shape* lives in
 * scatter and is covered by `tameScatter`.
 */
const BUSY_GEN_IDS: ReadonlySet<string> = new Set(['particles', 'scatter', 'mosaic', 'bokeh'])
/** Full-bleed pattern layers (cover the canvas edge to edge). */
const PATTERN_GEN_IDS: ReadonlySet<string> = new Set(['mosaic', 'gradShapes', 'smoke', 'grain'])
/** Chance the base (first) layer is drawn from the surface family. */
const SURFACE_BASE_CHANCE = 0.7
/** Chance a mosaic roll is kept as the base layer (cap ≈ 10%). */
const MOSAIC_BASE_KEEP = 0.1

/**
 * Generator pick with composition rules: surface base by default, the busy
 * rule, and the mosaic-base cap. Falls back to an unruled pick rather than
 * looping forever when the rules admit nothing (tiny pools).
 */
export function pickRuled(
  rng: RNG,
  isBase: boolean,
  busyUsed: boolean,
  patternUsed: boolean,
  used: ReadonlySet<string>,
): string {
  for (let tries = 0; tries < 8; tries++) {
    let id: string
    if (isBase && rng.next() < SURFACE_BASE_CHANCE) {
      const pool = GENERATORS.filter((g) => g.family === 'surface')
      id = pool.length ? rng.weighted(pool, pool.map((g) => genMult(g.id))).id : pickGenerator(rng)
    } else {
      id = pickGenerator(rng)
    }
    // avoid the same generator twice more than once
    if (used.has(id) && rng.next() < 0.8) continue
    if (isBase && id === 'mosaic' && rng.next() >= MOSAIC_BASE_KEEP) continue
    // busy bases are rare: heroes and fields carry the base, not scatter
    if (isBase && BUSY_GEN_IDS.has(id) && id !== 'mosaic' && rng.next() < 0.7) continue
    if (BUSY_GEN_IDS.has(id) && busyUsed) continue
    if (BUSY_GEN_IDS.has(id) && patternUsed) continue
    if (PATTERN_GEN_IDS.has(id) && busyUsed) continue
    return id
  }
  // last resort: never break the busy rule — pick among the admissible ids
  // (a lone mosaic is both busy and pattern on one layer, which is allowed)
  const safe = GENERATORS.map((g) => g.id).filter(
    (id) =>
      !(BUSY_GEN_IDS.has(id) && busyUsed) &&
      !(BUSY_GEN_IDS.has(id) && patternUsed) &&
      !(PATTERN_GEN_IDS.has(id) && busyUsed),
  )
  return safe.length ? rng.pick(safe) : pickGenerator(rng)
}

/**
 * Keep a randomised layer inside a primitive budget. Random params can stack
 * (count × sub-blobs × copies), so we scale the offending count back until the
 * generator's declared density fits — randomise stays fast and pretty.
 */
export function fitDensity(
  genId: string,
  params: Params,
  budget = 9000,
): void {
  const gen = getGenerator(genId)
  if (!gen) return
  const keys = gen.params
    .filter(
      (d) =>
        ['count', 'density', 'dustCount'].includes(d.key) &&
        (d.type === 'int' || d.type === 'float'),
    )
    .map((d) => d.key)
  if (!keys.length) return
  let guard = 0
  while (gen.density(params) > budget && guard++ < 14) {
    const key = keys[0]
    const cur = params[key]
    if (typeof cur !== 'number' || cur <= 1) break
    params[key] = Math.max(1, Math.round(cur * 0.6))
  }
}

/* ---- Project-level randomise --------------------------------------------- */

/**
 * Canvas sizes the randomiser may roll — a curated list of coherent (w, h)
 * pairs, never two independent pools. Independent pools pair up arbitrarily and
 * produced shapes nobody asked for: 1920x500 (3.84:1) and 1200x500 (2.40:1)
 * each landed ~2% of rolls, while only 24% came out square.
 *
 * Weighted toward square because that is the common overlay case, and capped at
 * 1920 on the long edge: the quality gate renders every attempt inside a 750 ms
 * budget, and a 4K roll costs ~4x the pixels, which would blow the budget and
 * silently degrade randomise to a single ungated roll.
 */
const RANDOM_CANVAS_SIZES: ReadonlyArray<readonly [number, number]> = [
  [1080, 1080],
  [1080, 1080],
  [1080, 1080],
  [1920, 1080],
  [1080, 1350],
  [1080, 1920],
  [1500, 500],
  [1200, 1200],
]

export interface RandomProjectOpts {
  layers?: number
  bg?: boolean
  /**
   * Pins the canvas to an exact size. The aspect lock in the UI passes the
   * current canvas through so Randomise keeps the shape the user chose — the
   * same treatment `mutateProject` and `breed` already get for free via
   * `structuredClone`.
   */
  canvas?: { w: number; h: number }
}

export function randomProject(seed?: number, opts: RandomProjectOpts = {}): Project {
  const s = seed ?? Math.floor(Math.random() * 0xffffffff)
  const rng = createRng(s)
  const harmony = rng.pick(['analogous', 'complementary', 'triad', 'split', 'warm', 'cool', 'gold', 'neon', 'autumn', 'ice', 'pastel', 'ember', 'jewel', 'monochrome'] as Harmony[])
  const palette = generatePalette(rng, harmony, rng.int(3, 5))

  const nLayers = opts.layers ?? rng.weighted([1, 2, 3, 4], [1.5, 3.5, 3, 1.4])
  const layers: Layer[] = []
  const used = new Set<string>()
  let busyUsed = false
  let patternUsed = false

  for (let i = 0; i < nLayers; i++) {
    const isBase = i === 0
    const genId = pickRuled(rng, isBase, busyUsed, patternUsed, used)
    used.add(genId)
    if (BUSY_GEN_IDS.has(genId)) busyUsed = true
    if (PATTERN_GEN_IDS.has(genId)) patternUsed = true
    const layer = randomLayer({ genId, palette, rng })
    // cutesy scatter is never the main layer
    if (isBase) tameScatter(layer, rng.fork('tame-base', layer.seedOffset), 1)
    layers.push(layer)
  }

  // at most one texture layer, placed on top
  const texture = layers.filter((l) => getGenerator(l.gen)?.family === 'texture')
  if (texture.length > 1) {
    const keep = texture[0]
    for (const l of texture.slice(1)) layers.splice(layers.indexOf(l), 1)
    if (!layers.includes(keep)) layers.push(keep)
  }

  // bring any over-budget additive stack back under control, then choose a
  // ground that the content can actually be seen on
  const built = brightnessBudget(layers)
  const wanted: Project['canvas']['bg'] =
    opts.bg === false ? { kind: 'transparent' } : rng.pick(BACKGROUND_POOL())
  const bg = opts.bg === false ? wanted : pairBackground(wanted, palette, built, rng)

  // locked → the caller's exact size; otherwise one curated coherent pair.
  // Ternary rather than `?? rng.pick(...)` so a locked roll draws nothing
  // extra from the RNG.
  const [pw, ph] = opts.canvas ? [opts.canvas.w, opts.canvas.h] : rng.pick(RANDOM_CANVAS_SIZES)

  return {
    v: 1,
    name: randomProjectName(rng),
    canvas: {
      w: pw,
      h: ph,
      bg,
    },
    seed: s,
    palette,
    layers: built,
    groups: [],
    motion: {
      drift: rng.range(0, 0.6),
      twinkle: rng.range(0, 0.7),
      pulse: rng.next() < 0.35 ? rng.range(0, 0.6) : 0,
      flow: rng.range(0, 0.5),
      speed: rng.range(0.6, 1.6),
    },
  }
}

const NAME_A = ['Gold', 'Neon', 'Velvet', 'Ember', 'Aurora', 'Chrome', 'Solar', 'Midnight', 'Frost', 'Ruby', 'Cobalt', 'Amber', 'Iris', 'Onyx', 'Lumen', 'Nova']
const NAME_B = ['Dust', 'Drift', 'Bloom', 'Rain', 'Haze', 'Rays', 'Sparks', 'Trails', 'Glow', 'Field', 'Veil', 'Waves', 'Embers', 'Glitter', 'Flare', 'Mist']

function randomProjectName(rng: RNG): string {
  return `${rng.pick(NAME_A)} ${rng.pick(NAME_B)}`
}

/* ---- Mutation ------------------------------------------------------------ */

/** Gaussian-ish perturbation of every unlocked parameter. */
export function mutateLayer(layer: Layer, rng: RNG, strength = 0.15): Layer {
  const gen = getGenerator(layer.gen)
  const next: Layer = { ...layer, params: { ...layer.params }, locks: { ...layer.locks } }

  if (gen) {
    for (const def of gen.params) {
      if (layer.locks[def.key]) continue
      const cur = layer.params[def.key]
      if (def.type === 'bool' || def.type === 'text' || def.type === 'path') {
        if (rng.next() < strength * 0.25) next.params[def.key] = !cur
        continue
      }
      if (def.type === 'enum') {
        if (rng.next() < strength * 0.9 && def.options?.length) {
          next.params[def.key] = rng.pick(def.options).value
        }
        continue
      }
      if (def.type === 'color') continue
      if (typeof cur !== 'number') continue
      const lo = def.min ?? 0
      const hi = def.max ?? 1
      const span = hi - lo
      const delta = rng.bipolar(strength) * span * 0.35
      let v = cur + delta
      // occasionally reset a parameter to a sane default
      if (rng.next() < strength * 0.18 && typeof def.default === 'number') v = def.default
      v = Math.max(lo, Math.min(hi, v))
      if (def.step) v = Math.round(v / def.step) * def.step
      next.params[def.key] = def.type === 'int' ? Math.round(v) : Number(v.toFixed(4))
    }
  }

  if (rng.next() < strength * 1.6 && !layer.locked) {
    next.dist = { ...layer.dist, ...mutateDist(layer.dist, rng, strength) }
  }
  if (rng.next() < strength * 1.2) {
    next.blend = rng.weighted(GOOD_BLENDS, GOOD_BLENDS.map(() => 1))
    next.opacity = Number(opacityFor(next.blend, rng).toFixed(3))
  }
  if (rng.next() < strength * 0.9) {
    next.color = {
      ...layer.color,
      mode: rng.weighted(['palette', 'position', 'size', 'random'] as const, [4, 2, 1.4, 1.4]),
      axis: layer.color.axis + Math.round(rng.normal(0, 60)),
      ramp: rng.pick(['linear', 'ease', 'bilinear', 'mirror'] as const),
    }
  }
  if (rng.next() < strength * 0.5) {
    next.mods = mutateMods(layer.mods, rng, strength)
  }
  // Filters are re-sampled, not rebuilt: an evolve walk nudges magnitudes
  // inside each filter's safe range rather than wiping a deliberate stack.
  // Locked layers keep theirs untouched. Forked, so the guard draw and the
  // re-sample never shift the rest of the walk.
  if (!layer.locked) {
    const filterRng = rng.fork('filters', layer.seedOffset, layer.gen)
    if (filterRng.next() < strength) {
      next.filters = resampleFilterStack(ensureFilters(layer), filterRng, strength)
    }
  }
  next.seedOffset = layer.seedOffset + (rng.next() < strength ? rng.int(1, 97) : 0)
  fitDensity(layer.gen, next.params, 9000)
  return next
}

function mutateDist(dist: DistSpec, rng: RNG, strength: number): Partial<DistSpec> {
  const out: Partial<DistSpec> = {}
  if (rng.next() < strength * 0.7) {
    out.type = rng.pick(ALL_DISTS as DistSpec['type'][])
  }
  out.depth = clamp01(dist.depth + rng.bipolar(strength) * 0.4)
  out.sizePower = Math.max(0.1, dist.sizePower + rng.bipolar(strength) * 1.5)
  out.opacityFalloff = clamp01(dist.opacityFalloff + rng.bipolar(strength) * 0.35)
  out.edgeFalloff = clamp01(dist.edgeFalloff + rng.bipolar(strength) * 0.4)
  out.sizeMin = clamp01(dist.sizeMin + rng.bipolar(strength) * 0.3)
  if (rng.next() < strength * 0.5) out.clusters = Math.max(2, Math.round(dist.clusters + rng.bipolar(1) * 6))
  if (rng.next() < strength * 0.5) out.curveAmount = clamp01(dist.curveAmount + rng.bipolar(1) * 0.4)
  if (rng.next() < strength * 0.4) out.curve = rng.pick(['sine', 'arc', 'diagonal', 'spiral', 'v'] as const)
  if (rng.next() < strength * 0.4) out.radius = Math.max(0.01, dist.radius + rng.bipolar(1) * 0.05)
  if (rng.next() < strength * 0.4) out.noiseScale = Math.max(0.3, dist.noiseScale + rng.bipolar(1) * 2)
  if (rng.next() < strength * 0.4) out.noiseThreshold = clamp01(dist.noiseThreshold + rng.bipolar(1) * 0.25)
  return out
}

function mutateMods(mods: ModifierSpec[], rng: RNG, strength: number): ModifierSpec[] {
  const next = mods.map((m) => ({ ...m }))
  if (next.length === 0 || rng.next() < 0.35) {
    if (rng.next() < 0.6) {
      const type = rng.pick(['noise', 'twist', 'kaleido', 'mirror', 'array', 'scaleByPos', 'colorByPos', 'axisFade', 'jitter'] as ModType[])
      if (!next.some((m) => m.type === type)) next.push(defaultModifier(type))
    }
  }
  if (next.length > 0 && rng.next() < 0.4) next.splice(rng.int(0, next.length - 1), 1)
  for (const m of next) {
    if (rng.next() < strength * 2) m.amount = Number((m.amount + rng.bipolar(strength * 2) * 0.6).toFixed(3))
    if (rng.next() < strength) m.secondary = Number((m.secondary + rng.bipolar(strength * 2) * 0.5).toFixed(3))
    if (rng.next() < strength * 0.5) m.enabled = !m.enabled
  }
  return next
}

/** Structural mutation: sometimes add/remove/duplicate/swap a layer. */
export function mutateProject(base: Project, strength = 0.15, seed?: number): Project {
  const s = seed ?? Math.floor(Math.random() * 0xffffffff)
  const rng = createRng(hash32(s, base.seed))
  const next: Project = structuredClone(base)
  next.seed = rng.next() < 0.35 ? rng.int(1, 0xffffffff) : base.seed

  next.layers = base.layers.map((l) => mutateLayer(l, rng, strength))

  const roll = rng.next()
  if (roll < strength * 0.55 && next.layers.length < 6) {
    // add a new layer
    next.layers.push(randomLayer({ rng, palette: base.palette }))
  } else if (roll < strength * 0.8 && next.layers.length > 1) {
    // remove one (never the last visible)
    const idx = rng.int(0, next.layers.length - 1)
    if (next.layers.filter((l) => l.visible).length > 1) next.layers.splice(idx, 1)
  } else if (roll < strength * 1.1) {
    // duplicate an existing layer with a fresh seed
    const idx = rng.int(0, next.layers.length - 1)
    const copy = duplicateLayer(next.layers[idx])
    copy.seedOffset += rng.int(1, 500)
    next.layers.splice(idx + 1, 0, copy)
  } else if (roll < strength * 1.35) {
    // swap the generator of one layer, keeping the palette
    const idx = rng.int(0, next.layers.length - 1)
    const layer = next.layers[idx]
    if (!layer.locked) {
      const replacement = randomLayer({ rng, palette: layer.color.palette })
      replacement.id = layer.id
      replacement.name = layer.name
      replacement.visible = layer.visible
      replacement.opacity = layer.opacity
      replacement.blend = layer.blend
      replacement.groupId = layer.groupId
      replacement.locks = layer.locks
      next.layers[idx] = replacement
    }
  }

  if (rng.next() < strength * 0.6) {
    next.palette = generatePalette(rng, rng.pick(['analogous', 'complementary', 'triad', 'warm', 'cool', 'gold', 'neon', 'autumn', 'ember'] as Harmony[]))
    for (const l of next.layers) {
      if (!l.locked) l.color = { ...l.color, linked: true, palette: { name: next.palette.name, colors: next.palette.colors.slice() } }
    }
  }
  return next
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/* ---- Gallery of variations ---------------------------------------------- */

export function variations(base: Project, count = 8): Project[] {
  const out: Project[] = []
  for (let i = 0; i < count; i++) {
    const strength = i < count / 2 ? 0.08 : 0.3
    out.push(mutateProject(base, strength, hash32(base.seed, 'var', i)))
  }
  return out
}

/* ---- Breeding ------------------------------------------------------------ */

export function breed(a: Project, b: Project, seed?: number): Project {
  const s = seed ?? Math.floor(Math.random() * 0xffffffff)
  const rng = createRng(hash32(s, a.seed, b.seed))
  const child: Project = structuredClone(a)
  child.seed = s
  child.name = `${a.name} × ${b.name}`.slice(0, 48)
  child.palette = rng.next() < 0.5 ? a.palette : b.palette
  child.canvas = rng.next() < 0.6 ? a.canvas : b.canvas
  child.motion = {
    drift: (a.motion.drift + b.motion.drift) / 2,
    twinkle: (a.motion.twinkle + b.motion.twinkle) / 2,
    pulse: (a.motion.pulse + b.motion.pulse) / 2,
    flow: (a.motion.flow + b.motion.flow) / 2,
    speed: (a.motion.speed + b.motion.speed) / 2,
  }

  // layer-level crossover
  const pool = [...a.layers.map((l) => ({ l, from: 0 })), ...b.layers.map((l) => ({ l, from: 1 }))]
  rng.shuffle(pool)
  const count = Math.max(1, Math.min(6, Math.round((a.layers.length + b.layers.length) / 2)))
  const chosen = pool.slice(0, count)
  child.layers = chosen.map(({ l, from }) => {
    const other = from === 0 ? b : a
    const partner = other.layers.find((x) => x.gen === l.gen)
    let copy = structuredClone(l)
    copy.id = newId()
    copy.groupId = null
    copy.locks = { ...l.locks }
    if (partner) copy = blendLayer(copy, partner, rng)
    return copy
  })

  // ensure at least one of each parent survives when possible
  if (child.layers.length === 0) child.layers = structuredClone(a.layers)
  return child
}

function blendLayer(target: Layer, other: Layer, rng: RNG): Layer {
  const out: Layer = structuredClone(target)
  const t = rng.range(0.2, 0.8)
  const gen = getGenerator(target.gen)
  for (const def of gen?.params ?? []) {
    if (target.locks[def.key]) continue
    const av = target.params[def.key]
    const bv = other.params[def.key]
    if (typeof av === 'number' && typeof bv === 'number') {
      const v = av + (bv - av) * t
      out.params[def.key] = def.type === 'int' ? Math.round(v) : Number(v.toFixed(4))
    } else if (rng.next() < 0.5 && bv !== undefined) {
      out.params[def.key] = bv
    }
  }
  if (rng.next() < 0.5) out.dist = structuredClone(other.dist)
  if (rng.next() < 0.35) out.mods = structuredClone(other.mods)
  if (rng.next() < 0.5) out.blend = other.blend
  if (rng.next() < 0.5) out.color = { ...out.color, mode: other.color.mode, ramp: other.color.ramp }
  return out
}

/* ---- Saved project library (breeding pool) ------------------------------- */

export function randomPresetPalette(rng: RNG): Palette {
  return generatePalette(rng, rng.pick(['gold', 'neon', 'autumn', 'cool'] as Harmony[]))
}

export { PRESET_PALETTES, PALETTE_KEYS }
