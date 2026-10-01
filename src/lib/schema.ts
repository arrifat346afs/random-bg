/**
 * schema.ts — Data model and parameter-schema types.
 *
 * A generator declares `ParamDef[]` only; the inspector builds its entire UI
 * from that array, so adding a generator requires **zero UI code**.
 */

import type { BlendMode, IR } from './ir'
import type { ColorMapping, ColorMode, Harmony, Palette, Ramp } from './palette'
import type { RNG } from './rng'

/* ---- Parameter definitions --------------------------------------------- */

export type ParamType =
  | 'float'
  | 'int'
  | 'bool'
  | 'enum'
  | 'color'
  | 'text'
  | 'path'
  | 'range'

export type SectionId =
  | 'shape'
  | 'distribution'
  | 'style'
  | 'depth'
  | 'motion'
  | 'mask'

export interface ParamDef {
  key: string
  label: string
  type: ParamType
  min?: number
  max?: number
  step?: number
  default: number | string | boolean | [number, number]
  /** enum options */
  options?: { value: string | number; label: string }[]
  section?: SectionId
  unit?: string
  /** description shown as a tooltip */
  hint?: string
  /** excluded from randomize when false */
  randomize?: boolean
  /** randomize sampling bounds (defaults to [min,max]) */
  rand?: { min?: number; max?: number; bias?: 'low' | 'high' | 'even' }
  /** show even when a dependency condition holds */
  when?: { key: string; equals: string | number | boolean }
}

export type ParamValue = number | string | boolean | [number, number]
export type Params = Record<string, ParamValue>

/* ---- Distribution ------------------------------------------------------ */

export type DistType =
  | 'uniform'
  | 'gaussian'
  | 'clustered'
  | 'curve'
  | 'sineBand'
  | 'radial'
  | 'spiral'
  | 'gridJitter'
  | 'poisson'
  | 'noiseMask'
  | 'imageMask'

export interface DistSpec {
  type: DistType
  /** cluster/grid count for clustered & gridJitter */
  clusters: number
  /** curve shape selector for 'curve' */
  curve: 'sine' | 'arc' | 'diagonal' | 'spiral' | 'v'
  curveAmount: number
  /** band thickness for sineBand */
  band: number
  /** radial inner radius fraction */
  inner: number
  /** radial falloff power (density toward centre or edge) */
  radialFalloff: number
  /** spiral arms */
  arms: number
  /** poisson minimum distance as fraction of canvas min dimension */
  radius: number
  /** noise mask scale / contrast / threshold */
  noiseScale: number
  noiseContrast: number
  noiseThreshold: number
  /** global density falloff toward edges (0 = none, 1 = strong) */
  edgeFalloff: number
  /** size distribution power curve (1 = uniform) */
  sizePower: number
  sizeMin: number
  sizeMax: number
  /** opacity falloff with distance from centre / with depth */
  opacityFalloff: number
  /** depth spread: how much z varies (drives blur + scale) */
  depth: number
  /** user-drawn gradient mask (greyscale PNG data-url / generated pattern) */
  mask?: string
  maskInvert?: boolean
  maskStrength?: number
}

export const DIST_OPTIONS: { value: DistType; label: string }[] = [
  { value: 'uniform', label: 'Uniform' },
  { value: 'gaussian', label: 'Gaussian' },
  { value: 'clustered', label: 'Clustered' },
  { value: 'curve', label: 'Along curve' },
  { value: 'sineBand', label: 'Sine band' },
  { value: 'radial', label: 'Radial' },
  { value: 'spiral', label: 'Spiral' },
  { value: 'gridJitter', label: 'Grid + jitter' },
  { value: 'poisson', label: 'Poisson disc' },
  { value: 'noiseMask', label: 'Noise mask' },
  { value: 'imageMask', label: 'Image mask' },
]

export function defaultDist(): DistSpec {
  return {
    type: 'uniform',
    clusters: 6,
    curve: 'sine',
    curveAmount: 0.35,
    band: 0.16,
    inner: 0,
    radialFalloff: 1,
    arms: 3,
    radius: 0.06,
    noiseScale: 3,
    noiseContrast: 1,
    noiseThreshold: 0.4,
    edgeFalloff: 0,
    sizePower: 1,
    sizeMin: 0.4,
    sizeMax: 1,
    opacityFalloff: 0.2,
    depth: 0.4,
    maskInvert: false,
    maskStrength: 1,
  }
}

/* ---- Modifiers --------------------------------------------------------- */

export type ModType =
  | 'noise'
  | 'twist'
  | 'kaleido'
  | 'array'
  | 'scaleByPos'
  | 'colorByPos'
  | 'axisFade'
  | 'jitter'

export interface ModifierSpec {
  type: ModType
  enabled: boolean
  amount: number
  /** modifier-specific secondary parameter */
  secondary: number
  /** modifier-specific tertiary parameter */
  tertiary: number
}

export interface ModifierDef {
  type: ModType
  label: string
  hint: string
  amount: { label: string; min: number; max: number; step: number; default: number }
  secondary?: { label: string; min: number; max: number; step: number; default: number }
  tertiary?: { label: string; min: number; max: number; step: number; default: number }
  /** allowed blend of modifiers */
  colorCapable?: boolean
}

/* ---- Generator --------------------------------------------------------- */

export interface GenContext {
  rng: RNG
  w: number
  h: number
  minDim: number
  dist: DistSpec
  color: ColorMapping
  /** per-layer seed (already mixed with the project seed) */
  seed: number
  /** sample an image mask at a normalised point (1 = fully inside) */
  maskAt?: (nx: number, ny: number) => number
}

export interface GeneratorDef<P extends Params = Params> {
  id: string
  name: string
  icon: string
  family: 'particles' | 'light' | 'atmosphere' | 'geometry' | 'texture'
  tags: string[]
  description: string
  params: ParamDef[]
  defaults(): P
  /** expected primitive count — drives progress + caps */
  density(p: P): number
  generate(p: P, ctx: GenContext): IR
}

/* ---- Layers & project -------------------------------------------------- */

export interface Layer {
  id: string
  name: string
  gen: string
  params: Params
  dist: DistSpec
  mods: ModifierSpec[]
  color: ColorMapping
  blend: BlendMode
  opacity: number
  visible: boolean
  solo: boolean
  locked: boolean
  /**
   * Fold the layer's RNG into a different stream.
   *
   * Deterministic: assigned at creation from the seed that created the layer,
   * never from `id` — ids carry `Date.now()` + `Math.random()`, so seeding
   * artwork from them would mean a project built twice from the same seed
   * renders differently each time.
   */
  seedOffset: number
  /** stable content salt; omitted on legacy projects, which fall back to `id` */
  salt?: number
  /** parameter keys locked against randomize */
  locks: Record<string, true>
  /** group id when the layer belongs to a group */
  groupId?: string | null
  /**
   * Manual placement, in canvas units, applied when the layer is drawn.
   *
   * Optional so every project saved before drag-to-move loads unchanged, and
   * deliberately *absent* from `layerCacheKey` — dragging must reuse the cached
   * IR rather than regenerating up to 40k primitives per pointer move. The
   * offset is stamped onto nodes at compose time instead.
   */
  offset?: { x: number; y: number }
}

/** A layer's manual placement, defaulting to the origin. */
export function layerOffset(l: Pick<Layer, 'offset'>): { x: number; y: number } {
  return l.offset ?? { x: 0, y: 0 }
}

export interface LayerGroup {
  id: string
  name: string
  collapsed: boolean
}

export type BackgroundSpec =
  | { kind: 'transparent' }
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number }
  | { kind: 'noise'; color: string; amount: number }

export interface CanvasSpec {
  w: number
  h: number
  bg: BackgroundSpec
}

export interface Project {
  v: 1
  name: string
  canvas: CanvasSpec
  seed: number
  palette: Palette
  layers: Layer[]
  groups: LayerGroup[]
  /** animation motion (used by WebM export + preview twinkle) */
  motion: MotionSpec
}

export interface MotionSpec {
  drift: number
  twinkle: number
  pulse: number
  flow: number
  speed: number
}

export function defaultMotion(): MotionSpec {
  return { drift: 0.2, twinkle: 0.3, pulse: 0, flow: 0.2, speed: 1 }
}

/* ---- Canvas size presets ---------------------------------------------- */

export const SIZE_PRESETS = [
  { label: 'Square 1080', w: 1080, h: 1080 },
  { label: 'HD 1920×1080', w: 1920, h: 1080 },
  { label: 'Portrait 1080×1350', w: 1080, h: 1350 },
  { label: 'Story 1080×1920', w: 1080, h: 1920 },
  { label: 'Wide 2560×1080', w: 2560, h: 1080 },
  { label: '4K 3840×2160', w: 3840, h: 2160 },
  { label: 'Banner 1500×500', w: 1500, h: 500 },
  { label: 'Icon 512', w: 512, h: 512 },
  { label: 'Small 640×360', w: 640, h: 360 },
] as const

/* ---- Exported convenience types --------------------------------------- */

export type { Palette, ColorMapping, ColorMode, Ramp, Harmony, BlendMode, IR }
