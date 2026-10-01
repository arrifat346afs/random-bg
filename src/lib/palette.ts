/**
 * palette.ts — Colour system: harmonious palette generation, gradient ramps
 * and per-layer colour mapping (by position / size / random).
 */

import type { RNG } from './rng'
import type { Color, GradientStop } from './ir'

export interface Palette {
  name?: string
  /** 2–8 hex colours */
  colors: Color[]
}

/* ---- Conversions ------------------------------------------------------- */

export function hexToRgb(hex: string): [number, number, number, number] {
  let h = hex.replace('#', '').trim()
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }
  if (h.length === 4) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]
  }
  const n = parseInt(h.slice(0, 8), 16)
  if (Number.isNaN(n)) return [255, 255, 255, 1]
  if (h.length >= 8) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, (n & 255) / 255]
  }
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
}

export function rgbToHex(r: number, g: number, b: number): Color {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function hslToHex(h: number, s: number, l: number): Color {
  h = ((h % 360) + 360) % 360
  s = Math.max(0, Math.min(100, s)) / 100
  l = Math.max(0, Math.min(100, l)) / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let rgb: [number, number, number]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255)
}

export function hexToHsl(hex: string): [number, number, number] {
  const [r0, g0, b0] = hexToRgb(hex)
  const r = r0 / 255
  const g = g0 / 255
  const b = b0 / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return [h, s * 100, l * 100]
}

export function mixColor(a: Color, b: Color, t: number): Color {
  const A = hexToRgb(a)
  const B = hexToRgb(b)
  const k = Math.max(0, Math.min(1, t))
  return rgbToHex(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k)
}

/** Attach alpha without touching RGB (used for premultiplied-safe glow). */
export function withAlpha(hex: Color, a: number): Color {
  const [r, g, b] = hexToRgb(hex)
  const al = Math.max(0, Math.min(255, Math.round(a * 255)))
    .toString(16)
    .padStart(2, '0')
  return `#${al}${to2(r)}${to2(g)}${to2(b)}`
}
const to2 = (v: number) =>
  Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')

/* ---- Ramps ------------------------------------------------------------- */

export type Ramp = 'linear' | 'ease' | 'bilinear' | 'mirror'

/** Sample a palette as a gradient ramp at t∈[0,1]. */
export function rampColor(colors: Color[], t: number, shape: Ramp = 'linear'): Color {
  if (colors.length === 0) return '#ffffff'
  if (colors.length === 1) return colors[0]
  let x = Math.max(0, Math.min(1, t))
  if (shape === 'ease') x = x * x * (3 - 2 * x)
  if (shape === 'mirror') x = x < 0.5 ? x * 2 : (1 - x) * 2
  const scaled = x * (colors.length - 1)
  const i = Math.min(colors.length - 2, Math.floor(scaled))
  const f = scaled - i
  if (shape === 'bilinear') {
    // hard bands (confetti-like) with a tiny blend to avoid jaggies
    return mixColor(colors[i], colors[i + 1], Math.min(1, f * 6))
  }
  return mixColor(colors[i], colors[i + 1], f)
}

export function rampStops(colors: Color[], shape: Ramp = 'linear'): GradientStop[] {
  const n = Math.max(2, colors.length)
  const out: GradientStop[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    let col = colors[Math.min(colors.length - 1, i)] ?? '#ffffff'
    if (shape === 'bilinear') {
      const scaled = t * (colors.length - 1)
      const idx = Math.min(colors.length - 1, Math.round(scaled))
      col = colors[idx]
    }
    out.push({ t, c: col, o: 1 })
  }
  return out
}

/* ---- Harmonious palette generation ------------------------------------- */

export type Harmony =
  | 'analogous'
  | 'complementary'
  | 'triad'
  | 'split'
  | 'monochrome'
  | 'warm'
  | 'cool'
  | 'gold'
  | 'neon'
  | 'autumn'
  | 'ice'
  | 'pastel'
  | 'ember'
  | 'jewel'

export const HARMONIES: Harmony[] = [
  'analogous',
  'complementary',
  'triad',
  'split',
  'monochrome',
  'warm',
  'cool',
  'gold',
  'neon',
  'autumn',
  'ice',
  'pastel',
  'ember',
  'jewel',
]

interface HarmonySpec {
  hue: (rng: RNG) => number
  sat: (rng: RNG) => number
  light: (rng: RNG, i: number, n: number) => number
  /** hue offset in degrees per palette entry */
  spread?: (i: number, n: number, rng: RNG) => number
}

const HARMONY_SPEC: Record<Harmony, HarmonySpec> = {
  analogous: {
    hue: (r) => r.range(0, 360),
    sat: (r) => r.range(45, 78),
    light: (r, i, n) => 28 + (i / Math.max(1, n - 1)) * 42 + r.range(-4, 4),
    spread: (i, n, r) => ((i / Math.max(1, n - 1)) - 0.5) * r.range(40, 80),
  },
  complementary: {
    hue: (r) => r.range(0, 360),
    sat: (r) => r.range(50, 85),
    light: (r, i) => (i % 2 === 0 ? r.range(35, 58) : r.range(58, 82)),
    spread: (i) => (i % 2 === 0 ? 0 : 180),
  },
  triad: {
    hue: (r) => r.range(0, 360),
    sat: (r) => r.range(50, 82),
    light: (r, i) => 34 + (i % 3) * 14 + r.range(-4, 6),
    spread: (i) => (i % 3) * 120,
  },
  split: {
    hue: (r) => r.range(0, 360),
    sat: (r) => r.range(55, 85),
    light: (r, i) => 32 + (i % 3) * 16 + r.range(-5, 5),
    spread: (i) => [0, 150, 210][i % 3],
  },
  monochrome: {
    hue: (r) => r.range(0, 360),
    sat: (r) => r.range(20, 70),
    light: (r, i, n) => 24 + (i / Math.max(1, n - 1)) * 58 + r.range(-3, 3),
  },
  warm: {
    hue: (r) => r.range(-12, 55),
    sat: (r) => r.range(55, 95),
    light: (r, i, n) => 34 + (i / Math.max(1, n - 1)) * 36 + r.range(-5, 5),
    spread: (i, n, r) => ((i / Math.max(1, n - 1)) - 0.3) * r.range(20, 45),
  },
  cool: {
    hue: (r) => r.range(175, 265),
    sat: (r) => r.range(45, 85),
    light: (r, i, n) => 32 + (i / Math.max(1, n - 1)) * 42 + r.range(-5, 5),
    spread: (i, n, r) => ((i / Math.max(1, n - 1)) - 0.4) * r.range(25, 60),
  },
  gold: {
    hue: (r) => r.range(36, 52),
    sat: (r) => r.range(70, 96),
    light: (r, i, n) => 30 + (i / Math.max(1, n - 1)) * 46 + r.range(-4, 6),
    spread: (i, n, r) => ((i / Math.max(1, n - 1)) - 0.5) * r.range(8, 22),
  },
  neon: {
    hue: (r) => r.range(0, 360),
    sat: (r) => r.range(85, 100),
    light: (r, i, n) => 55 + (i / Math.max(1, n - 1)) * 22 + r.range(-4, 4),
    spread: (i, n, r) => ((i / Math.max(1, n - 1)) - 0.5) * r.range(90, 180),
  },
  autumn: {
    hue: (r) => r.range(8, 48),
    sat: (r) => r.range(55, 92),
    light: (r, i, n) => 30 + (i / Math.max(1, n - 1)) * 38 + r.range(-4, 5),
    spread: (i, n, r) => ((i / Math.max(1, n - 1)) - 0.25) * r.range(20, 55),
  },
  ice: {
    hue: (r) => r.range(186, 225),
    sat: (r) => r.range(35, 75),
    light: (r, i, n) => 52 + (i / Math.max(1, n - 1)) * 34 + r.range(-4, 4),
    spread: (i, n, r) => ((i / Math.max(1, n - 1)) - 0.5) * r.range(15, 40),
  },
  pastel: {
    hue: (r) => r.range(0, 360),
    sat: (r) => r.range(35, 62),
    light: (r) => r.range(70, 86),
    spread: (i, n, r) => ((i / Math.max(1, n - 1)) - 0.5) * r.range(30, 90),
  },
  ember: {
    hue: (r) => r.range(-6, 32),
    sat: (r) => r.range(85, 100),
    light: (r, i, n) => 34 + (i / Math.max(1, n - 1)) * 34 + r.range(-5, 5),
    spread: (i, n, r) => ((i / Math.max(1, n - 1)) - 0.35) * r.range(10, 30),
  },
  jewel: {
    hue: (r) => r.pick([280, 320, 190, 145, 45, 20]),
    sat: (r) => r.range(60, 92),
    light: (r, i, n) => 34 + (i / Math.max(1, n - 1)) * 34 + r.range(-5, 5),
    spread: (i, n, r) => ((i / Math.max(1, n - 1)) - 0.5) * r.range(20, 55),
  },
}

/** Generate a 2–8 colour harmonious palette. */
export function generatePalette(rng: RNG, harmony?: Harmony, size?: number): Palette {
  const h = harmony ?? rng.pick(HARMONIES)
  const spec = HARMONY_SPEC[h]
  const n = size ?? rng.int(3, 5)
  const baseHue = spec.hue(rng)
  const colors: Color[] = []
  for (let i = 0; i < n; i++) {
    const offset = spec.spread ? spec.spread(i, n, rng) : 0
    const s = spec.sat(rng)
    const l = spec.light(rng, i, n)
    colors.push(hslToHex(baseHue + offset, s, l))
  }
  return { name: h, colors }
}

/* ---- Colour mapping ---------------------------------------------------- */

export type ColorMode = 'palette' | 'position' | 'size' | 'random' | 'rampAngle'

export interface ColorMapping {
  mode: ColorMode
  palette: Palette
  ramp: Ramp
  /** for 'position': angle in degrees of the mapping axis */
  axis: number
  /** invert mapping */
  invert: boolean
  /**
   * When true (default), this layer follows `Project.palette`.
   * When false, `palette` is a per-layer override.
   * `undefined` is treated as linked for backward compat.
   */
  linked?: boolean
}

/** Linked unless explicitly unlinked. */
export function isPaletteLinked(m: Pick<ColorMapping, 'linked'> | null | undefined): boolean {
  return m?.linked !== false
}

export function palettesEqual(a: Palette | null | undefined, b: Palette | null | undefined): boolean {
  if (!a || !b) return false
  if (a.colors.length !== b.colors.length) return false
  for (let i = 0; i < a.colors.length; i++) {
    if (a.colors[i]?.toLowerCase() !== b.colors[i]?.toLowerCase()) return false
  }
  return true
}

/** Resolve the palette a layer actually renders with. */
export function effectivePalette(projectPalette: Palette, layerColor: ColorMapping): Palette {
  return isPaletteLinked(layerColor) ? projectPalette : layerColor.palette
}

/** Pick a colour for one primitive. `t` and `size` are generator-supplied. */
export function mapColor(
  m: ColorMapping,
  rng: RNG,
  opts: { x?: number; y?: number; w?: number; h?: number; t?: number; size?: number } = {},
): Color {
  const colors = m.palette.colors.length ? m.palette.colors : ['#ffffff']
  // every branch below assigns `t` (or returns), so no initialiser is needed
  let t: number
  switch (m.mode) {
    case 'random':
      return colors[Math.floor(rng.next() * colors.length)]
    case 'size':
      t = clamp01(opts.size ?? 0)
      break
    case 'position': {
      const a = (m.axis * Math.PI) / 180
      const cx = (opts.w ?? 1) / 2
      const cy = (opts.h ?? 1) / 2
      // project position onto the axis, normalised to 0..1 across the canvas
      const proj =
        ((opts.x ?? cx) - cx) * Math.cos(a) + ((opts.y ?? cy) - cy) * Math.sin(a)
      const extent = Math.abs(Math.cos(a)) * cx + Math.abs(Math.sin(a)) * cy
      t = extent > 0 ? 0.5 + proj / (2 * extent) : 0.5
      break
    }
    case 'rampAngle':
      t = opts.t ?? 0
      break
    default:
      t = opts.t ?? rng.next()
  }
  if (m.invert) t = 1 - t
  return rampColor(colors, t, m.ramp)
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/* ---- Named palettes used by presets/randomize -------------------------- */

export const PRESET_PALETTES: Record<string, Color[]> = {
  gold: ['#7a4a08', '#c98a1a', '#ffd97a', '#fff6d8'],
  fire: ['#5c1200', '#c33500', '#ff8b1f', '#ffe9a8'],
  blueGlitter: ['#0a1f5c', '#2a63d8', '#74b8ff', '#e9f6ff'],
  neonPurple: ['#3a0ca3', '#7b2ff7', '#c77dff', '#ffb3f0'],
  embers: ['#4a0d00', '#b33000', '#ff6b1a', '#ffd08a'],
  silver: ['#2b2f36', '#8b949e', '#d7dde5', '#ffffff'],
  autumn: ['#5a1b00', '#a8410a', '#e07a12', '#f5c542'],
  neonCyan: ['#002b3d', '#00e5ff', '#7af9ff', '#e6feff'],
  roseGold: ['#5c2430', '#b76e79', '#f0b8ad', '#ffe4dd'],
  forest: ['#04150c', '#16603a', '#3fae6a', '#c8f5d0'],
  violetMist: ['#1b0a33', '#5e35b1', '#b39ddb', '#ede7f6'],
  sunset: ['#2d0a3e', '#c2185b', '#ff7043', '#ffe082'],
  aurora: ['#032b3a', '#00c2a8', '#7cf5c4', '#e9fff9'],
  magma: ['#1a0000', '#8b0000', '#ff4500', '#ffd700'],
  iceBlue: ['#071a2e', '#1565c0', '#64b5f6', '#e3f2fd'],
  candy: ['#ff4081', '#ff9100', '#ffee58', '#40c4ff'],
}

export const PALETTE_KEYS = Object.keys(PRESET_PALETTES)
