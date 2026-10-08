/**
 * randomize.ts — The "infinite possibilities" engine.
 *
 * Randomisation is *curated*: distributions are weighted per generator,
 * palettes come from harmony theory, blend modes come from a tasteful set and
 * modifier counts are bounded. That is the difference between "designed" and
 * "noise" — and it is what makes 20 random projects in a row look good.
 */

import { createRng, hash32, type RNG } from './rng'
import { generatePalette, hexToRgb, isPaletteLinked, PRESET_PALETTES, PALETTE_KEYS, type Harmony, type Palette } from './palette'
import { oklchFromHex, capChroma, capYellow } from './field/oklab'
import { GENERATORS, getGenerator, minCountFor, FAMILY_WEIGHTS } from './generators'
import { createLayer, duplicateLayer, newId } from './project'
import { defaultModifier } from './modifiers'
import { randomFilterStack, resampleFilterStack } from './filters/random'
import { ensureFilters } from './filters/stack'
import { DIST_OPTIONS, defaultDist, type DistSpec, type Layer, type ModifierSpec, type Params, type Project, type ModType, type ParamDef, type ParamValue } from './schema'
import type { BlendMode } from './ir'
import type { RandomPoolPrefs } from './random-pool'
import { allowedBgKinds, allowedGenIds } from './random-pool'

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
  // network places its own 3D nodes; the dist only seeds the cloud layout —
  // clumpy distributions give clumps, anything else falls back internally
  network: { clustered: 3, gaussian: 3, noiseMask: 2.5, uniform: 2, radial: 1.5, poisson: 1 },
  // surface3d places its own grid; the dist only tints accents —
  // uniform keeps it cheap
  surface3d: { uniform: 6 },
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

function poolBackgrounds(pool: RandomPoolPrefs): Project['canvas']['bg'][] {
  const kinds = new Set(allowedBgKinds(pool))
  return BACKGROUND_POOL().filter((bg) => {
    if (bg.kind === 'solid') {
      const light = LIGHT_BGS.includes(bg.color)
      if (light && !pool.allowLightBg) return false
      return kinds.has('solid')
    }
    if (bg.kind === 'gradient') return kinds.has('gradient')
    if (bg.kind === 'transparent') return kinds.has('transparent')
    if (bg.kind === 'noise') return kinds.has('noise')
    return true
  })
}

/** Dark, opaque grounds for the tech-network recipe (glow needs darkness). */
function darkOpaquePool(pool?: RandomPoolPrefs): Project['canvas']['bg'][] {
  const kinds = pool ? new Set(allowedBgKinds(pool)) : null
  const dark = DARK_BACKGROUND_POOL().filter((bg) => bg.kind !== 'transparent')
  if (!kinds) return dark
  const out = dark.filter((bg) => {
    if (bg.kind === 'solid') return kinds.has('solid')
    if (bg.kind === 'gradient') return kinds.has('gradient')
    if (bg.kind === 'noise') return kinds.has('noise')
    return true
  })
  return out.length > 0 ? out : dark
}

function forceDarkBackground(
  _wanted: Project['canvas']['bg'],
  palette: Palette,
  layers: Layer[],
  rng: RNG,
): Project['canvas']['bg'] {
  const pool = DARK_BACKGROUND_POOL()
  const picked = pool[rng.int(0, pool.length - 1)]
  // still run pairing so a pathological palette/layers combo stays readable
  return pairBackground(picked, palette, layers, rng)
}

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
/** Ray layers need a darker ground: bright + additive beams clips to white. */
const RAYS_MAX_BG_LUMA = 130

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
 * One deterministic rescue pass for harsh saturated edges: halve outline
 * strokes, dim flat normal-blend overlays, and leash palette chroma. Pure
 * (a function of the project only) — see `randomProjectChecked`.
 */
export function softenHarsh(project: Project): Project {
  const next: Project = structuredClone(project)
  for (let i = 0; i < next.layers.length; i++) {
    const l = next.layers[i]
    const outline = l.params.outline
    if (typeof outline === 'number' && outline > 0) {
      l.params = { ...l.params, outline: outline * 0.5 }
    }
    if (i > 0 && l.blend === 'normal' && l.opacity > 0.6) {
      l.opacity = Math.max(0.3, round3(l.opacity * 0.8))
    }
    // feather-less emissive fills: soften the available radius/softness
    // params and drop flat overlays to a sheer blend
    if (typeof l.params.softness === 'number') {
      l.params = { ...l.params, softness: Math.max(l.params.softness as number, 0.5) }
    }
    if (typeof l.params.sizeMin === 'number') {
      const floor = 0.08 * Math.min(project.canvas.w, project.canvas.h)
      l.params = { ...l.params, sizeMin: Math.min(l.params.sizeMin as number, floor) }
    }
    if (typeof l.params.alpha === 'number' && l.params.alpha > 0.5) {
      l.params = { ...l.params, alpha: 0.5 }
    }
    if (i > 0 && l.blend === 'normal') l.blend = 'soft-light'
  }
  capProjectChroma(next)
  return next
}

/**
 * Chroma discipline for dark grounds: no high-chroma colours sitting in the
 * dark (they render as cheap neon edges), yellow hues extra-leashed. Applied
 * to the project palette and every unlinked layer override; linked layers
 * follow the project palette automatically.
 */
export function capProjectChroma(project: Project): void {
  tamePalettes(project, 0.18, 0.12)
}

function tamePalettes(project: Project, cMax: number, yMax: number): void {
  const tame = (colors: string[]): string[] =>
    colors.map((c) => {
      const lch = oklchFromHex(c)
      let out = c
      if (lch.C > cMax && lch.L < 0.5) out = capChroma(out, cMax)
      return capYellow(out, yMax)
    })
  project.palette = { ...project.palette, colors: tame(project.palette.colors) }
  for (const l of project.layers) {
    if (isPaletteLinked(l.color)) {
      l.color = { ...l.color, palette: { ...project.palette, colors: project.palette.colors.slice() } }
    } else {
      l.color = { ...l.color, palette: { ...l.color.palette, colors: tame(l.color.palette.colors) } }
    }
  }
}

/**
 * Last-resort rescue for a candidate that is still harsh after soften: cut
 * non-base opacity hard, crush outlines, and take chroma down to a whisper.
 * Deterministic. Applied at most once per gate run (see randomProjectChecked).
 */
export function lastResort(project: Project): Project {
  const next: Project = structuredClone(project)
  for (let i = 0; i < next.layers.length; i++) {
    const l = next.layers[i]
    if (i > 0) l.opacity = Math.max(0.25, round3(l.opacity * 0.6))
    const outline = l.params.outline
    if (typeof outline === 'number' && outline > 0) {
      l.params = { ...l.params, outline: outline * 0.2 }
    }
  }
  tamePalettes(next, 0.1, 0.08)
  return next
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
  // ray layers need a dark or mid-tone ground to read as light; a bright
  // ground plus additive beams has nowhere to go but white
  const lightCap = layers.some((l) => l.gen === 'rays') ? RAYS_MAX_BG_LUMA : LIGHT_BG_LUMA
  const bgLuma =
    bg.kind === 'gradient'
      ? (lumaOf(bg.from) + lumaOf(bg.to)) / 2
      : lumaOf(bg.color)
  if (bgLuma <= lightCap) return bg

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

/** Filter-stack types that soften via blur (excluded when the pool bans blur). */
export const BLUR_FILTER_TYPES: ReadonlySet<string> = new Set([
  'gaussian-blur',
  'feather',
  'outer-glow',
  'inner-glow',
  'drop-shadow',
  'motion-blur',
  'radial-blur',
  'zoom-blur',
])

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
  // (depth-driven blur is stripped at compose time for blur-banned projects,
  // so depth keeps shaping size/opacity here regardless of the pool)
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
  // Smooth fields are never standpoint-modified: displacing a handful of
  // giant blobs only moves colour around (mesh), and duplicating full-canvas
  // wave bands (array/kaleido) breaks coverage into stacked white hard-edged
  // copies. Wallpaper layers compose clean or not at all.
  const family = getGenerator(genId)?.family
  if (genId === 'mesh' || family === 'wallpaper') return []
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
  pool?: RandomPoolPrefs
}

export function randomLayer(opts: LayerSampleOpts): Layer {
  const { rng, pool } = opts
  const genId = opts.genId ?? pickGenerator(rng, pool)
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
  const blends: BlendMode[] =
    pool && !pool.allowAdditiveBlends ? ['normal', 'multiply', 'darken', 'normal'] : GOOD_BLENDS
  layer.blend = rng.weighted(blends, blends.map((b) => (b === 'normal' ? 2.4 : 1)))
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
  // being good work. Wallpaper fields compose clean: even "safe" grain would
  // read as banding-test pollution and break the no-noise look.
  //
  // Forked off the layer seed rather than drawn from `rng`: the filter stack is a
  // *post-process*, so it must not steal draws from the stream that makes the
  // artwork. Drawing here inline silently re-rolled every shape, palette and
  // canvas size for every existing seed the first time filters landed.
  layer.filters =
    getGenerator(genId)?.family === 'wallpaper' || pool?.allowFilters === false
      ? []
      : randomFilterStack(rng.fork('filters', layerSeed)).filter(
          (f) => pool?.allowBlur !== false || !BLUR_FILTER_TYPES.has(f.type),
        )
  layer.filtersBypassed = false
  tameWallpaper(layer)
  tameScatter(layer, rng.fork('tame', layerSeed), 0.8)
  tameRings(layer, rng.fork('rings', layerSeed))
  softenRays(layer, rng.fork('softrays', layerSeed))
  tameNetwork(layer, rng.fork('tame3d', layerSeed))
  tameSurface3d(layer, rng.fork('tame3d', layerSeed))
  if (pool?.allowAdditiveBlends === false && layer.blend !== 'normal' && layer.blend !== 'multiply' && layer.blend !== 'darken') {
    layer.blend = 'normal'
  }
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
 * Light-variant wallpaper sits on a bright ground: additive blends have
 * nowhere to go but white (a plus-lighter light layer measured 10.5% pure
 * white), so they are always composited normally. Dark variants keep their
 * rolled blend — glow needs something to add to.
 */
function tameWallpaper(layer: Layer): void {
  if (getGenerator(layer.gen)?.family !== 'wallpaper') return
  if (layer.params.variant === 'light') layer.blend = 'normal'
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
 * Keep a randomised network layer legible: the focal plane stays inside the
 * depth range, lines never fall below a visible floor, and the minimal MST
 * wiring is dealt rarely (it reads sparse next to fuller graphs — presets
 * and the inspector keep it on demand). Pure clamps plus one forked draw,
 * so other seeds' artwork streams are untouched.
 */
function tameNetwork(layer: Layer, rng: RNG): void {
  if (layer.gen !== 'network') return
  const params = { ...layer.params }
  const focal = params.focal
  if (typeof focal === 'number') params.focal = Math.max(0.2, Math.min(0.8, focal))
  const lineOpacity = params.lineOpacity
  if (typeof lineOpacity === 'number') params.lineOpacity = Math.max(lineOpacity, 0.28)
  const width = params.lineWidth
  if (typeof width === 'number') params.lineWidth = Math.max(width, 0.8)
  const maxEdgeLen = params.maxEdgeLen
  if (typeof maxEdgeLen === 'number') params.maxEdgeLen = Math.max(maxEdgeLen, 0.2)
  const size = params.size
  if (typeof size === 'number') params.size = Math.max(size, 5.5)
  const fog = params.fog
  if (typeof fog === 'number') params.fog = Math.min(fog, 0.55)
  const dof = params.dof
  if (typeof dof === 'number') params.dof = Math.min(dof, 0.8)
  if (params.connection === 'mst' && rng.next() < 0.8) {
    params.connection = rng.pick(['knn', 'knn', 'gabriel', 'radius'])
  }
  // ribbon bands, constellations and small globes are sparse by design —
  // beautiful as presets, but they read blank at thumbnail scale, so deal
  // them rarely
  if ((params.layout === 'ribbon' || params.layout === 'constellation') && rng.next() < 0.7) {
    params.layout = rng.pick(['cloud', 'cloud', 'wave', 'globe', 'grid'])
  }
  if (params.layout === 'globe' && rng.next() < 0.5) {
    params.layout = rng.pick(['cloud', 'cloud', 'wave', 'grid'])
  }
  pleasantPitch(params)
  layer.params = params
  // a nearly-transparent layer is invisible at any scale (precedent:
  // softenRays also owns blend+opacity) — floor it into visibility
  if (layer.opacity < 0.6) layer.opacity = 0.6
}

/**
 * Pleasant camera angles for 3D layers: low or oblique, never edge-on and
 * never straight top-down; kept centred so the content stays in frame.
 * Pure clamps (no RNG).
 */
function pleasantPitch(params: Params): void {
  const pitch = params.pitch
  if (typeof pitch === 'number') params.pitch = Math.max(12, Math.min(68, pitch))
  const yaw = params.yaw
  if (typeof yaw === 'number') params.yaw = Math.max(-22, Math.min(22, yaw))
  const lookX = params.lookX
  if (typeof lookX === 'number') params.lookX = Math.max(-0.08, Math.min(0.08, lookX))
  const lookY = params.lookY
  if (typeof lookY === 'number') params.lookY = Math.max(-0.08, Math.min(0.08, lookY))
  const camHeight = params.camHeight
  if (typeof camHeight === 'number') params.camHeight = Math.max(-0.12, Math.min(0.12, camHeight))
}

/**
 * Keep a randomised Surface 3D layer calm and legible: pleasant camera,
 * restrained resolution, and the sparse contour structure dealt rarely
 * (thin iso-lines read blank at thumbnail scale). Forked draw only.
 */
function tameSurface3d(layer: Layer, rng: RNG): void {
  if (layer.gen !== 'surface3d') return
  const params = { ...layer.params }
  pleasantPitch(params)
  const res = params.resolution
  if (typeof res === 'number') params.resolution = Math.max(36, Math.min(res, 64))
  const fog = params.fog
  if (typeof fog === 'number') params.fog = Math.min(fog, 0.65)
  if (params.structure === 'contours' && rng.next() < 0.85) {
    params.structure = rng.pick(['tri', 'tri', 'dots', 'quad', 'hex'])
  }
  layer.params = params
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

/**
 * Light layers must behave like light: soft volumetric style, additive
 * blends at restrained opacity, a single source. The classic hard-polygon
 * style stays available in the inspector, but the randomizer deals it rarely.
 */
export function softenRays(layer: Layer, rng: RNG): void {
  if (layer.gen !== 'rays') return
  if (rng.next() < 0.85) {
    layer.params = { ...layer.params, style: 'soft' }
  }
  // many distribution origins read as crisscross chaos, not one light source
  if (layer.params.origin === 'distribution' && rng.next() < 0.6) {
    layer.params = { ...layer.params, origin: rng.pick(['center', 'corner'] as const) }
  }
  layer.blend = rng.pick(['screen', 'plus-lighter'] as const)
  layer.opacity = Number(rng.range(0.35, 0.75).toFixed(3))
}

export function pickGenerator(rng: RNG, prefs?: RandomPoolPrefs): string {
  // read the registry weights so adding a family or re-weighting one place
  // updates every roll; previously this hardcoded a copy of the table.
  // Learned taste multiplies in: family weights scale by member mean,
  // within-family picks weight by per-generator multiplier (1 = neutral).
  const allowed = prefs ? new Set(allowedGenIds(prefs)) : null
  const gens = allowed ? GENERATORS.filter((g) => allowed.has(g.id)) : GENERATORS
  const pool = gens.length > 0 ? gens : GENERATORS
  const famWeights = new Map<string, number>()
  for (const [f, w] of FAMILY_WEIGHTS) {
    const members = pool.filter((g) => g.family === f)
    if (members.length === 0) continue
    const mean = members.reduce((s, g) => s + genMult(g.id), 0) / members.length
    famWeights.set(f, w * Math.max(0.5, Math.min(2, mean)))
  }
  const families = [...famWeights.keys()]
  if (families.length === 0) return rng.pick(GENERATORS).id
  const family = rng.weighted(families, families.map((f) => famWeights.get(f) ?? 1))
  const members = pool.filter((g) => g.family === family)
  if (!members.length) return rng.pick(pool).id
  return rng.weighted(members, members.map((g) => genMult(g.id))).id
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
const BUSY_GEN_IDS: ReadonlySet<string> = new Set(['particles', 'scatter', 'mosaic', 'bokeh', 'network', 'surface3d'])
/** Full-bleed pattern layers (cover the canvas edge to edge). */
const PATTERN_GEN_IDS: ReadonlySet<string> = new Set(['mosaic', 'gradShapes', 'smoke', 'grain', 'surface3d'])
/** Chance the base (first) layer is drawn from the surface family. */
const SURFACE_BASE_CHANCE = 0.65
/** Chance a mosaic roll is kept as the base layer (cap ≈ 10%). */
const MOSAIC_BASE_KEEP = 0.1
/** Share of rolls dealt the curated tech-network composition. */
const TECH_NETWORK_CHANCE = 0.2

/** Share of rolls dealt the curated 3D-tech composition. */
const TECH3D_CHANCE = 0.12

/**
 * Curated "3D tech" composition: a dark gradient ground, one 3D generator
 * (surface or network cloud) with a pleasant low/oblique camera, and a very
 * subtle smoke atmosphere. Owns every layer, so busy generators can never
 * combine with it.
 */
function tech3dLayers(rng: RNG, palette: Palette, pool?: RandomPoolPrefs): Layer[] {
  const allowed = pool ? new Set(allowedGenIds(pool)) : null
  const has = (id: string): boolean => !allowed || allowed.has(id)
  const cands = ['surface3d', 'network'].filter(has)
  if (!cands.length) return []
  const layers: Layer[] = []
  // network look leads: that is the background most users ask for
  const heroId = rng.next() < 0.6 ? (has('network') ? 'network' : cands[0]) : rng.pick(cands)
  const hero = randomLayer({ genId: heroId, palette, rng, pool })
  // pleasant cameras only: low or oblique, centred, close enough to fill
  // the frame; glow layers composite normally or additively, never darkened
  const hp = { ...hero.params }
  hp.pitch = rng.range(15, 60)
  hp.distance = rng.range(1.0, 1.7)
  hp.fov = rng.range(40, 60)
  hp.roll = rng.range(-10, 10)
  hp.lookX = rng.range(-0.08, 0.08)
  hp.lookY = rng.range(-0.08, 0.08)
  hero.params = hp
  if (hero.blend !== 'normal' && hero.blend !== 'screen' && hero.blend !== 'plus-lighter') {
    hero.blend = 'normal'
  }
  hero.opacity = Math.max(hero.opacity, 0.7)
  tameNetwork(hero, rng)
  tameSurface3d(hero, rng)
  layers.push(hero)
  if (has('smoke') && rng.next() < 0.5) {
    const haze = randomLayer({ genId: 'smoke', palette, rng, pool })
    const a = haze.params.alpha
    if (typeof a === 'number') haze.params = { ...haze.params, alpha: Math.min(a, 0.1) }
    haze.opacity = Math.min(haze.opacity, 0.5)
    layers.push(haze)
  }
  return layers
}

/**
 * Curated "tech network" composition: a mesh-gradient base (or nothing — a
 * dark ground carries it instead), one network layer, and an optional
 * whisper of smoke atmosphere. Contains no busy generator by construction.
 */
function techNetworkLayers(rng: RNG, palette: Palette, pool?: RandomPoolPrefs): Layer[] {
  const allowed = pool ? new Set(allowedGenIds(pool)) : null
  const has = (id: string): boolean => !allowed || allowed.has(id)
  const layers: Layer[] = []
  // mesh base only when the palette is dark enough to stay a dark ground —
  // a pastel mesh would wash out the whole recipe
  const paletteLuma =
    palette.colors.reduce((s, c) => s + lumaOf(c), 0) / Math.max(1, palette.colors.length)
  if (has('mesh') && paletteLuma < 110 && rng.next() < 0.55) {
    layers.push(randomLayer({ genId: 'mesh', palette, rng, pool }))
  }
  layers.push(randomLayer({ genId: 'network', palette, rng, pool }))
  tameNetwork(layers[layers.length - 1], rng)
  if (has('smoke') && rng.next() < 0.35) {
    const haze = randomLayer({ genId: 'smoke', palette, rng, pool })
    const a = haze.params.alpha
    if (typeof a === 'number') haze.params = { ...haze.params, alpha: Math.min(a, 0.12) }
    haze.opacity = Math.min(haze.opacity, 0.6)
    layers.push(haze)
  }
  return layers
}

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
  prefs?: RandomPoolPrefs,
): string {
  const allowed = prefs ? new Set(allowedGenIds(prefs)) : null
  const allIds = GENERATORS.map((g) => g.id)
  const ok = (id: string) => !allowed || allowed.has(id)
  for (let tries = 0; tries < 8; tries++) {
    let id: string
    if (isBase && rng.next() < SURFACE_BASE_CHANCE) {
      // calm bases: surface fields and wallpaper flows carry the base layer
      const pool = GENERATORS.filter(
        (g) => (g.family === 'surface' || g.family === 'wallpaper') && ok(g.id),
      )
      id = pool.length ? rng.weighted(pool, pool.map((g) => genMult(g.id))).id : pickGenerator(rng, prefs)
    } else {
      id = pickGenerator(rng, prefs)
    }
    // avoid the same generator twice more than once — except rays, which
    // stacks additively and must never double up unless a recipe asks
    if (used.has(id) && (id === 'rays' || rng.next() < 0.8)) continue
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
  const safe = allIds.filter(
    (id) =>
      ok(id) &&
      !(BUSY_GEN_IDS.has(id) && busyUsed) &&
      !(BUSY_GEN_IDS.has(id) && patternUsed) &&
      !(PATTERN_GEN_IDS.has(id) && busyUsed),
  )
  return safe.length ? rng.pick(safe) : pickGenerator(rng, prefs)
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
  pool?: RandomPoolPrefs
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

  // Curated "tech network" recipe (~10%): mesh-gradient or dark base plus
  // one network layer plus a whisper of atmosphere. The recipe owns every
  // layer, so busy generators (particles, mosaic, scatter, …) can never
  // combine with it. Forked: the decision draw never shifts the artwork
  // stream of any other seed.
  const poolAllowed = opts.pool ? new Set(allowedGenIds(opts.pool)) : null
  const deal3d =
    !opts.layers &&
    (!poolAllowed || poolAllowed.has('surface3d') || poolAllowed.has('network')) &&
    rng.fork('tech3d-recipe').next() < TECH3D_CHANCE
  const dealTech =
    !opts.layers &&
    !deal3d &&
    (!poolAllowed || poolAllowed.has('network')) &&
    rng.fork('tech-recipe').next() < TECH_NETWORK_CHANCE

  if (deal3d) {
    layers.push(...tech3dLayers(rng, palette, opts.pool))
  } else if (dealTech) {
    layers.push(...techNetworkLayers(rng, palette, opts.pool))
  } else {
    for (let i = 0; i < nLayers; i++) {
      const isBase = i === 0
      const genId = pickRuled(rng, isBase, busyUsed, patternUsed, used, opts.pool)
      used.add(genId)
      if (BUSY_GEN_IDS.has(genId)) busyUsed = true
      if (PATTERN_GEN_IDS.has(genId)) patternUsed = true
      const layer = randomLayer({ genId, palette, rng, pool: opts.pool })
      // cutesy scatter is never the main layer
      if (isBase) tameScatter(layer, rng.fork('tame-base', layer.seedOffset), 1)
      layers.push(layer)
    }
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
  const poolBg = opts.pool ? poolBackgrounds(opts.pool) : BACKGROUND_POOL()
  const wanted: Project['canvas']['bg'] =
    opts.bg === false
      ? { kind: 'transparent' }
      : dealTech || deal3d
        ? rng.pick(darkOpaquePool(opts.pool))
        : rng.pick(poolBg.length > 0 ? poolBg : BACKGROUND_POOL())
  // The recipe needs its dark ground: a transparent pick (legal elsewhere)
  // would leave glow nodes floating on whatever page they land on.
  const bg0 =
    opts.bg === false
      ? wanted
      : opts.pool?.allowLightBg === false
        ? forceDarkBackground(wanted, palette, built, rng)
        : pairBackground(wanted, palette, built, rng)
  const bg = (dealTech || deal3d) && opts.bg !== false && bg0.kind === 'transparent' ? rng.pick(darkOpaquePool(opts.pool)) : bg0

  // locked → the caller's exact size; otherwise one curated coherent pair.
  // Ternary rather than `?? rng.pick(...)` so a locked roll draws nothing
  // extra from the RNG.
  const [pw, ph] = opts.canvas ? [opts.canvas.w, opts.canvas.h] : rng.pick(RANDOM_CANVAS_SIZES)

  const project: Project = {
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

  // Blur-banned pool: flag the project so composeIR strips every node's blur
  // (preview, exports, gate all read the composed IR). Generator-baked blur
  // has no central parameter switch, so the flag — not param fiddling — is
  // what makes the guarantee hold.
  if (opts.pool?.allowBlur === false) project.noBlur = true

  // taste discipline, applied last so it sees the final ground. Pure value
  // transforms (no RNG): existing seeds keep their shapes and palettes, only
  // the harshest chroma and the flattest blobs-on-gradient get trimmed.
  if (bg.kind !== 'transparent') {
    const bgLuma =
      bg.kind === 'gradient' ? (lumaOf(bg.from) + lumaOf(bg.to)) / 2 : lumaOf(bg.color)
    if (bgLuma < 90) capProjectChroma(project)
    if (bg.kind === 'gradient') {
      // blob rule: flat opaque shapes over a gradient ground must stay sheer
      for (let i = 1; i < project.layers.length; i++) {
        const l = project.layers[i]
        if (l.blend === 'normal' && l.opacity > 0.6) l.opacity = 0.6
      }
    }
  }
  return project
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
