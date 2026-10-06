/**
 * presets.ts — 55 built-in projects (38 originals + 17 new).
 *
 * A preset is nothing special in the data model: it is just a parameter set
 * for the same composable system, which proves the "named effects are only
 * presets" principle. `buildPreset()` merges a partial spec onto generator
 * defaults so presets stay valid when generators gain new parameters.
 */

import { createLayer, createProject, newId } from './project'
import { PRESET_PALETTES, hexToHsl, hslToHex } from './palette'
import { parseSeed } from './rng'
import { RIBBON_PRESETS } from './generators/neon-ribbons/presets'
import { GRADIENT_SHAPES_PRESETS } from './generators/gradient-shapes/presets'
import { MOSAIC_PRESETS } from './generators/tile-mosaic/presets'
import { MESH_PRESETS } from './generators/mesh-gradient/presets'
import type {
  BackgroundSpec,
  BlendMode,
  DistSpec,
  Layer,
  ModType,
  ModifierSpec,
  Params,
  Project,
} from './schema'
import { defaultModifier } from './modifiers'

export interface PresetLayerSpec {
  gen: string
  name?: string
  params?: Params
  dist?: Partial<DistSpec>
  /** palette key from PRESET_PALETTES, or an explicit colour list */
  palette?: string | string[]
  colorMode?: 'palette' | 'position' | 'size' | 'random' | 'rampAngle'
  ramp?: 'linear' | 'ease' | 'bilinear' | 'mirror'
  axis?: number
  invert?: boolean
  mods?: { type: ModType; amount?: number; secondary?: number; tertiary?: number; enabled?: boolean }[]
  blend?: BlendMode
  opacity?: number
  seedOffset?: number
}

export interface PresetDef {
  id: string
  name: string
  tags: string[]
  description: string
  seed: number
  canvas?: { w: number; h: number }
  bg?: BackgroundSpec
  layers: PresetLayerSpec[]
}

function resolvePalette(spec: PresetLayerSpec): { name: string; colors: string[] } {
  if (Array.isArray(spec.palette)) return { name: 'custom', colors: spec.palette }
  if (typeof spec.palette === 'string') {
    const colors = PRESET_PALETTES[spec.palette]
    if (colors) return { name: spec.palette, colors }
  }
  return { name: 'gold', colors: PRESET_PALETTES.gold }
}

export function buildPreset(def: PresetDef): Project {
  const project = createProject({ seed: parseSeed(def.seed), layers: [], name: def.name })
  project.canvas = {
    w: def.canvas?.w ?? 1080,
    h: def.canvas?.h ?? 1080,
    bg: def.bg ?? { kind: 'transparent' },
  }
  const palette = resolvePalette(def.layers[0] ?? { gen: 'particles' })
  project.palette = { name: palette.name, colors: palette.colors }

  project.layers = def.layers.map((spec, i) => {
    const layer: Layer = createLayer(spec.gen, def.seed + i * 7919, { name: spec.name ?? undefined })
    layer.params = { ...layer.params, ...(spec.params ?? {}) }
    layer.dist = { ...layer.dist, ...(spec.dist ?? {}) }
    const pal = resolvePalette(spec)
    const sameAsProject =
      pal.colors.length === palette.colors.length &&
      pal.colors.every((c, k) => c.toLowerCase() === palette.colors[k]?.toLowerCase())
    layer.color = {
      mode: spec.colorMode ?? 'palette',
      palette: { name: pal.name, colors: pal.colors.slice() },
      ramp: spec.ramp ?? 'linear',
      axis: spec.axis ?? 45,
      invert: spec.invert ?? false,
      linked: sameAsProject,
    }
    layer.mods = (spec.mods ?? []).map((m) => {
      const mod: ModifierSpec = defaultModifier(m.type)
      if (m.amount !== undefined) mod.amount = m.amount
      if (m.secondary !== undefined) mod.secondary = m.secondary
      if (m.tertiary !== undefined) mod.tertiary = m.tertiary
      if (m.enabled !== undefined) mod.enabled = m.enabled
      return mod
    })
    if (spec.blend) layer.blend = spec.blend
    if (spec.opacity !== undefined) layer.opacity = spec.opacity
    layer.seedOffset = spec.seedOffset ?? layer.seedOffset
    layer.id = newId()
    layer.groupId = null
    return layer
  })
  return project
}

const DARK = (color = '#08080c'): BackgroundSpec => ({ kind: 'solid', color })
const GRAD = (from: string, to: string, angle = 135): BackgroundSpec => ({
  kind: 'gradient',
  from,
  to,
  angle,
})
const CLEAR: BackgroundSpec = { kind: 'transparent' }

/** Shift every colour of a palette in hue (small helper for variety). */
export function shiftPalette(colors: string[], deg: number): string[] {
  return colors.map((c) => {
    const [h, s, l] = hexToHsl(c)
    return hslToHex(h + deg, s, l)
  })
}

/* ---------------------------------------------------------------- presets */

export const PRESETS: PresetDef[] = [
  {
    id: 'gold-dust',
    name: 'Gold Dust',
    tags: ['gold', 'dust', 'glitter', 'warm'],
    description: 'Fine golden motes with scintillating sparkle cores.',
    seed: 1041,
    bg: DARK('#0a0705'),
    layers: [
      {
        gen: 'particles',
        params: { count: 1400, shape: 'disc', size: 6, sizeVary: 0.8, alpha: 0.7, twinkle: 0.6, hotCore: 0.4, softness: 0.7 },
        dist: { type: 'uniform', depth: 0.7, sizePower: 1.6, sizeMin: 0.2, opacityFalloff: 0.5, edgeFalloff: 0.35 },
        palette: 'gold',
        blend: 'plus-lighter',
        opacity: 0.9,
      },
      {
        gen: 'particles',
        name: 'Sparkles',
        params: { count: 90, shape: 'sparkle', rays: 4, size: 26, sizeVary: 0.7, alpha: 0.85, twinkle: 0.5, hotCore: 0 },
        dist: { type: 'poisson', radius: 0.05, depth: 0.4 },
        palette: 'gold',
        colorMode: 'random',
        blend: 'plus-lighter',
        opacity: 0.85,
      },
      { gen: 'grain', params: { mode: 'vignette', vignette: 0.45 }, palette: 'gold' },
    ],
  },
  {
    id: 'blue-glitter-bokeh',
    name: 'Blue Glitter Bokeh',
    tags: ['blue', 'bokeh', 'glitter', 'cool'],
    description: 'Defocused sapphire highlights over a field of glitter.',
    seed: 2087,
    bg: GRAD('#040a1c', '#0d2b63', 160),
    layers: [
      {
        gen: 'bokeh',
        params: { count: 130, size: 74, softness: 0.3, rim: 0.6, dof: 0.7, chroma: 0.4, alpha: 0.62 },
        dist: { type: 'gaussian', depth: 0.8, sizePower: 1.4, sizeMin: 0.3, opacityFalloff: 0.5 },
        palette: 'blueGlitter',
        colorMode: 'position',
        axis: 40,
        blend: 'screen',
        opacity: 0.85,
      },
      {
        gen: 'particles',
        params: { count: 700, shape: 'point', size: 5, alpha: 0.8, twinkle: 0.7, hotCore: 0.6 },
        dist: { type: 'poisson', radius: 0.03, depth: 0.5, sizePower: 1 },
        palette: 'blueGlitter',
        blend: 'plus-lighter',
        opacity: 0.8,
      },
    ],
  },
  {
    id: 'fire-embers',
    name: 'Fire Embers',
    tags: ['fire', 'embers', 'orange', 'dark'],
    description: 'Rising embers with hot heads and a warm vignette.',
    seed: 3311,
    bg: DARK('#0b0402'),
    layers: [
      {
        gen: 'emitters',
        params: { type: 'embers', count: 260, life: 70, speed: 6, gravity: -1.2, drag: 0.04, wobble: 1.1, size: 4, trail: 0.8, headGlow: 0.8, alpha: 0.9, spread: 40 },
        dist: { type: 'uniform', depth: 0.5, edgeFalloff: 0.4 },
        palette: 'embers',
        colorMode: 'position',
        axis: 90,
        blend: 'plus-lighter',
        opacity: 0.95,
      },
      {
        gen: 'smoke',
        name: 'Heat haze',
        params: { count: 40, radius: 130, alpha: 0.1, blend: 'screen', hueSpread: 6, warp: 1.2, coreBoost: 0.4 },
        dist: { type: 'gaussian', depth: 0.7 },
        palette: 'fire',
        opacity: 0.55,
      },
      { gen: 'grain', params: { mode: 'both', density: 2.4, amount: 0.3, vignette: 0.5, vignetteColor: '#1a0400' }, palette: 'embers' },
    ],
  },
  {
    id: 'autumn-leaves-streak',
    name: 'Autumn Leaves + Streak',
    tags: ['autumn', 'leaves', 'orange', 'streak'],
    description: 'Falling amber leaves crossing a warm light streak.',
    seed: 4457,
    bg: GRAD('#150a04', '#2a1508', 120),
    layers: [
      {
        gen: 'streaks',
        params: { count: 12, length: 1.1, width: 26, taper: 1.1, curve: 0.2, angle: 24, spread: 12, bundle: 2, fade: 0.9, alpha: 0.5, core: 0.4 },
        dist: { type: 'uniform', depth: 0.2 },
        palette: 'gold',
        blend: 'plus-lighter',
        opacity: 0.7,
      },
      {
        gen: 'scatter',
        params: { count: 130, shape: 'leaf', size: 46, sizeVary: 0.7, rotate: 1, wobble: 0.5, outline: 0.3, shade: 0.6, alpha: 0.95, hueJitter: 18 },
        dist: { type: 'uniform', depth: 0.8, sizePower: 1.2, opacityFalloff: 0.35 },
        palette: 'autumn',
        colorMode: 'random',
        opacity: 1,
      },
      { gen: 'grain', params: { mode: 'both', density: 2.6, amount: 0.26, vignette: 0.5 }, palette: 'autumn' },
    ],
  },
  {
    id: 'neon-purple-rails',
    name: 'Neon Purple Rails',
    tags: ['neon', 'purple', 'lines', 'glow'],
    description: 'Layered Lissajous rails with a violet bloom.',
    seed: 5122,
    bg: DARK('#0a0616'),
    layers: [
      {
        gen: 'geometric',
        params: { mode: 'lissajous', count: 9, width: 3, glow: 1, glowWidth: 16, radius: 0.44, ratioA: 3, ratioB: 4, spin: 5, alpha: 0.9, resolution: 220 },
        dist: { type: 'uniform' },
        palette: 'neonPurple',
        colorMode: 'position',
        axis: 45,
        blend: 'screen',
        opacity: 0.95,
      },
      {
        gen: 'geometric',
        name: 'Echo grid',
        params: { mode: 'grid', count: 1, width: 1.4, glow: 0.7, glowWidth: 8, gridSteps: 8, radius: 0.5, alpha: 0.4, jitter: 0.12 },
        dist: { type: 'uniform' },
        palette: 'neonPurple',
        opacity: 0.5,
        blend: 'screen',
      },
      { gen: 'grain', params: { mode: 'both', density: 3, amount: 0.24, vignette: 0.55, vignetteColor: '#120026' }, palette: 'neonPurple' },
    ],
  },
  {
    id: 'sparkle-rain',
    name: 'Sparkle Rain',
    tags: ['rain', 'sparkle', 'silver', 'falling'],
    description: 'Glittering drops falling through a cool haze.',
    seed: 6013,
    bg: CLEAR,
    layers: [
      {
        gen: 'emitters',
        params: { type: 'falling', count: 320, life: 60, speed: 7, gravity: 1.6, drag: 0.02, wobble: 0.3, size: 3.5, trail: 0.9, headGlow: 0.7, alpha: 0.85 },
        dist: { type: 'uniform', depth: 0.6 },
        palette: 'iceBlue',
        blend: 'plus-lighter',
        opacity: 0.85,
      },
      {
        gen: 'particles',
        name: 'Glitter',
        params: { count: 260, shape: 'sparkle', rays: 6, size: 22, alpha: 0.8, twinkle: 0.7, hotCore: 0 },
        dist: { type: 'poisson', radius: 0.045, depth: 0.5 },
        palette: 'silver',
        blend: 'plus-lighter',
        opacity: 0.8,
      },
    ],
  },
  {
    id: 'silver-haze',
    name: 'Silver Haze',
    tags: ['haze', 'smoke', 'silver', 'neutral'],
    description: 'Soft silver smoke — a base layer for almost anything.',
    seed: 7007,
    bg: DARK('#0b0d10'),
    layers: [
      {
        gen: 'smoke',
        params: { count: 120, radius: 120, sub: 4, warp: 1, alpha: 0.14, blend: 'screen', elongation: 1.4, hueSpread: 4, coreBoost: 0.3, depthMix: 0.6, softness: 0.85 },
        dist: { type: 'gaussian', depth: 0.8, edgeFalloff: 0.4 },
        palette: 'silver',
        colorMode: 'position',
        axis: 60,
        opacity: 0.9,
      },
      {
        gen: 'particles',
        params: { count: 240, shape: 'glow', size: 10, alpha: 0.5, twinkle: 0.6, hotCore: 0.5 },
        dist: { type: 'noiseMask', noiseScale: 3, noiseThreshold: 0.45, depth: 0.7 },
        palette: 'silver',
        blend: 'plus-lighter',
        opacity: 0.7,
      },
    ],
  },
  {
    id: 'sunrise-god-rays',
    name: 'Sunrise God Rays',
    tags: ['god rays', 'sun', 'warm', 'light'],
    description: 'Golden shafts fanning from a low sun.',
    seed: 8123,
    bg: GRAD('#1c0f06', '#3b1e08', 180),
    layers: [
      {
        gen: 'rays',
        params: { mode: 'godRays', count: 34, origin: 'center', angle: 90, spread: 150, length: 1.35, width: 24, taper: 0.85, intensity: 0.55, coreSize: 0.7, jitter: 0.6, alpha: 0.75 },
        dist: { type: 'uniform' },
        palette: 'gold',
        blend: 'plus-lighter',
        opacity: 0.85,
      },
      {
        gen: 'smoke',
        name: 'Atmosphere',
        params: { count: 70, radius: 150, alpha: 0.12, blend: 'screen', hueSpread: 10 },
        dist: { type: 'radial', inner: 0.1, radialFalloff: 2 },
        palette: 'gold',
        opacity: 0.7,
      },
    ],
  },
  {
    id: 'anamorphic-flare',
    name: 'Anamorphic Flare',
    tags: ['flare', 'anamorphic', 'blue', 'cinematic'],
    description: 'A horizontal lens streak with ghosted optics.',
    seed: 9001,
    bg: DARK('#05070d'),
    layers: [
      {
        gen: 'rays',
        params: { mode: 'flare', count: 9, origin: 'center', angle: 0, length: 0.7, width: 14, ghosts: 6, coreSize: 0.55, intensity: 0.7, alpha: 0.8, jitter: 0.4 },
        dist: { type: 'uniform' },
        palette: 'iceBlue',
        blend: 'plus-lighter',
        opacity: 0.9,
      },
      {
        gen: 'rays',
        name: 'Streak',
        params: { mode: 'anamorphic', count: 1, origin: 'center', width: 22, intensity: 0.8, coreSize: 0.35, alpha: 0.7 },
        dist: { type: 'uniform' },
        palette: 'neonCyan',
        blend: 'plus-lighter',
        opacity: 0.9,
      },
      { gen: 'grain', params: { mode: 'both', density: 3.6, amount: 0.3, vignette: 0.6 }, palette: 'iceBlue' },
    ],
  },
  {
    id: 'emerald-silk-flow',
    name: 'Emerald Silk Flow',
    tags: ['flow', 'green', 'silk', 'curl noise'],
    description: 'Curl-noise ribbons in jade and mint.',
    seed: 10111,
    bg: DARK('#04120b'),
    layers: [
      {
        gen: 'flow',
        params: { count: 420, steps: 96, stepSize: 6, fieldScale: 2, curlStrength: 1.1, width: 5, taper: 0.6, alpha: 0.5, wander: 0.5, headDot: 0.25, colorFlow: 0.65 },
        dist: { type: 'uniform', depth: 0.5 },
        palette: 'forest',
        colorMode: 'position',
        axis: 30,
        opacity: 0.9,
      },
      { gen: 'grain', params: { mode: 'both', density: 2.4, amount: 0.22, vignette: 0.45 }, palette: 'forest' },
    ],
  },
  {
    id: 'confetti-pop',
    name: 'Confetti Pop',
    tags: ['confetti', 'party', 'candy', 'burst'],
    description: 'A burst of tumbling confetti.',
    seed: 11233,
    bg: CLEAR,
    layers: [
      {
        gen: 'scatter',
        params: { count: 420, shape: 'confetti', size: 30, sizeVary: 0.6, rotate: 1, outline: 0.15, shade: 0.2, alpha: 1, hueJitter: 22 },
        dist: { type: 'radial', inner: 0.05, radialFalloff: 1.4, depth: 0.5, sizePower: 1.1 },
        palette: 'candy',
        colorMode: 'random',
        opacity: 1,
      },
      {
        gen: 'emitters',
        params: { type: 'burst', count: 140, life: 45, speed: 14, gravity: 2, drag: 0.05, size: 3, trail: 0.85, headGlow: 0.6, alpha: 0.9 },
        dist: { type: 'radial', radialFalloff: 1.5 },
        palette: 'candy',
        blend: 'plus-lighter',
        opacity: 0.8,
      },
    ],
  },
  {
    id: 'winter-snowfall',
    name: 'Winter Snowfall',
    tags: ['snow', 'winter', 'ice', 'falling'],
    description: 'Snowflakes drifting with soft bokeh behind.',
    seed: 12277,
    bg: GRAD('#0a1424', '#132a44', 180),
    layers: [
      {
        gen: 'bokeh',
        params: { count: 70, size: 88, softness: 0.55, rim: 0.3, dof: 0.8, chroma: 0.2, alpha: 0.4 },
        dist: { type: 'gaussian', depth: 0.9, sizePower: 1.6, sizeMin: 0.25, opacityFalloff: 0.6 },
        palette: 'iceBlue',
        blend: 'screen',
        opacity: 0.7,
      },
      {
        gen: 'scatter',
        name: 'Snowflakes',
        params: { count: 200, shape: 'snowflake', size: 30, sizeVary: 0.75, rotate: 1, wobble: 0.35, outline: 0.5, shade: 0.2, alpha: 0.9, hueJitter: 6, outlineWidth: 1.8 },
        dist: { type: 'uniform', depth: 0.7, sizePower: 1.3, opacityFalloff: 0.4 },
        palette: 'iceBlue',
        colorMode: 'random',
        blend: 'screen',
        opacity: 0.9,
      },
    ],
  },
  {
    id: 'rose-petal-drift',
    name: 'Rose Petal Drift',
    tags: ['petals', 'rose', 'pink', 'soft'],
    description: 'Rose petals scattered over a warm blush gradient.',
    seed: 13303,
    bg: GRAD('#2b0d18', '#5a1e33', 150),
    layers: [
      {
        gen: 'scatter',
        params: { count: 160, shape: 'petal', size: 54, sizeVary: 0.7, rotate: 1, wobble: 0.6, outline: 0.2, shade: 0.7, alpha: 0.95, hueJitter: 12 },
        dist: { type: 'uniform', depth: 0.8, sizePower: 1.2, opacityFalloff: 0.4 },
        palette: 'roseGold',
        colorMode: 'size',
        opacity: 1,
      },
      {
        gen: 'particles',
        name: 'Highlights',
        params: { count: 220, shape: 'ring', size: 16, ringWidth: 0.25, alpha: 0.5, twinkle: 0.6, softness: 0.4 },
        dist: { type: 'poisson', radius: 0.05, depth: 0.5 },
        palette: 'roseGold',
        blend: 'plus-lighter',
        opacity: 0.7,
      },
    ],
  },
  {
    id: 'cyan-horizon-grid',
    name: 'Cyan Horizon Grid',
    tags: ['grid', 'synthwave', 'cyan', 'retro'],
    description: 'A glowing hex lattice fading into the distance.',
    seed: 14441,
    bg: GRAD('#01060c', '#032030', 200),
    layers: [
      {
        gen: 'geometric',
        params: { mode: 'hexGrid', count: 1, width: 2, glow: 1, glowWidth: 12, radius: 0.7, gridSteps: 10, alpha: 0.7, jitter: 0 },
        dist: { type: 'uniform' },
        palette: 'neonCyan',
        colorMode: 'position',
        axis: 90,
        blend: 'screen',
        opacity: 0.85,
        mods: [{ type: 'axisFade', amount: 0.75, secondary: 90 }],
      },
      {
        gen: 'particles',
        params: { count: 180, shape: 'point', size: 4, alpha: 0.7, twinkle: 0.6, hotCore: 0.7 },
        dist: { type: 'uniform', depth: 0.6 },
        palette: 'neonCyan',
        blend: 'plus-lighter',
        opacity: 0.7,
      },
    ],
  },
  {
    id: 'deep-starfield',
    name: 'Deep Starfield',
    tags: ['stars', 'space', 'blue', 'night'],
    description: 'A dense field of twinkling stars with faint nebula.',
    seed: 15501,
    bg: DARK('#02030a'),
    layers: [
      {
        gen: 'smoke',
        params: { count: 40, radius: 240, alpha: 0.09, blend: 'screen', hueSpread: 30, warp: 1.4, coreBoost: 0.3, elongation: 1.6 },
        dist: { type: 'noiseMask', noiseScale: 2, noiseThreshold: 0.42, depth: 0.9 },
        palette: 'violetMist',
        opacity: 0.75,
      },
      {
        gen: 'particles',
        params: { count: 2600, shape: 'point', size: 3.4, sizeVary: 0.9, alpha: 0.9, twinkle: 0.55, hotCore: 0.35 },
        dist: { type: 'uniform', depth: 0.85, sizePower: 2.2, sizeMin: 0.15, opacityFalloff: 0.55 },
        palette: ['#ffffff'],
        colorMode: 'random',
        blend: 'plus-lighter',
        opacity: 0.9,
      },
    ],
  },
  {
    id: 'ember-vortex',
    name: 'Ember Vortex',
    tags: ['vortex', 'embers', 'fire', 'swirl'],
    description: 'Spinning embers spiralling around a hot core.',
    seed: 16607,
    bg: DARK('#0c0300'),
    layers: [
      {
        gen: 'emitters',
        params: { type: 'vortex', count: 320, life: 90, speed: 10, gravity: -0.4, drag: 0.02, wobble: 0.5, size: 4, trail: 0.7, headGlow: 0.85, alpha: 0.9, spin: 1.4 },
        dist: { type: 'radial', inner: 0.1, radialFalloff: 1.4, depth: 0.5 },
        palette: 'magma',
        colorMode: 'position',
        axis: 0,
        blend: 'plus-lighter',
        opacity: 0.95,
      },
      { gen: 'grain', params: { mode: 'both', density: 3, amount: 0.3, vignette: 0.6, vignetteColor: '#1c0500' }, palette: 'magma' },
    ],
  },
  {
    id: 'film-haze-grain',
    name: 'Film Haze & Grain',
    tags: ['film', 'grain', 'overlay', 'texture'],
    description: 'A finishing layer: haze, heavy grain and vignette.',
    seed: 17701,
    bg: CLEAR,
    layers: [
      {
        gen: 'smoke',
        params: { count: 60, radius: 200, alpha: 0.1, blend: 'normal', hueSpread: 8, elongation: 1.8 },
        dist: { type: 'uniform', depth: 0.7 },
        palette: 'silver',
        opacity: 0.6,
      },
      { gen: 'grain', params: { mode: 'both', density: 6, grainSize: 1.6, amount: 0.4, grainBlend: 'overlay', vignette: 0.6, vignetteColor: '#000000' }, palette: 'silver' },
    ],
  },
  {
    id: 'prism-spirograph',
    name: 'Prism Spirograph',
    tags: ['spirograph', 'prism', 'geometry', 'rainbow'],
    description: 'Kaleidoscopic spirograph lines in prismatic colour.',
    seed: 18817,
    bg: DARK('#07070c'),
    layers: [
      {
        gen: 'geometric',
        params: { mode: 'spirograph', count: 8, width: 1.8, glow: 0.9, glowWidth: 10, radius: 0.46, teeth: 8, phase: 15, spin: 4, alpha: 0.8, resolution: 320 },
        dist: { type: 'uniform' },
        palette: ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff'],
        colorMode: 'position',
        axis: 45,
        blend: 'screen',
        opacity: 0.9,
        mods: [{ type: 'kaleido', amount: 6, secondary: 0.08 }],
      },
      { gen: 'grain', params: { mode: 'vignette', vignette: 0.5 }, palette: 'silver' },
    ],
  },
  {
    id: 'winter-mountain-bokeh',
    name: 'Frost Bokeh',
    tags: ['bokeh', 'ice', 'winter', 'soft'],
    description: 'Cold defocused highlights with chromatic fringing.',
    seed: 19923,
    bg: GRAD('#061018', '#0d2436', 200),
    layers: [
      {
        gen: 'bokeh',
        params: { count: 90, size: 110, shape: 'round', softness: 0.25, rim: 0.7, rimWidth: 0.07, dof: 0.6, focal: 0.35, chroma: 0.6, alpha: 0.55 },
        dist: { type: 'uniform', depth: 0.9, sizePower: 1.5, sizeMin: 0.3, opacityFalloff: 0.55 },
        palette: 'iceBlue',
        colorMode: 'random',
        blend: 'screen',
        opacity: 0.85,
      },
      {
        gen: 'particles',
        params: { count: 400, shape: 'disc', size: 7, alpha: 0.6, twinkle: 0.5, softness: 0.8 },
        dist: { type: 'poisson', radius: 0.04, depth: 0.6 },
        palette: 'iceBlue',
        blend: 'screen',
        opacity: 0.7,
      },
    ],
  },
  {
    id: 'candy-confetti-rain',
    name: 'Candy Confetti Rain',
    tags: ['confetti', 'candy', 'rain', 'pastel'],
    description: 'Pastel confetti falling in a wide band.',
    seed: 20011,
    bg: CLEAR,
    layers: [
      {
        gen: 'scatter',
        params: { count: 300, shape: 'confetti', size: 26, rotate: 1, outline: 0, shade: 0.1, alpha: 1, hueJitter: 20 },
        dist: { type: 'sineBand', band: 0.32, arms: 2, curveAmount: 0.4, depth: 0.6, sizePower: 1.1 },
        palette: 'candy',
        colorMode: 'random',
        opacity: 1,
      },
      {
        gen: 'emitters',
        params: { type: 'falling', count: 200, life: 70, speed: 6, gravity: 1.2, drag: 0.02, wobble: 0.8, size: 3, trail: 0.8, headGlow: 0.4, alpha: 0.8 },
        dist: { type: 'uniform', depth: 0.5 },
        palette: 'candy',
        blend: 'screen',
        opacity: 0.8,
      },
    ],
  },
  {
    id: 'molten-sparks',
    name: 'Molten Sparks',
    tags: ['sparks', 'welding', 'metal', 'burst'],
    description: 'A tight burst of white-hot sparks with long tails.',
    seed: 21107,
    bg: DARK('#08080a'),
    layers: [
      {
        gen: 'emitters',
        params: { type: 'burst', count: 240, life: 55, speed: 20, gravity: 2.6, drag: 0.04, wobble: 0.4, size: 3.5, trail: 0.75, headGlow: 1, alpha: 0.95, spread: 180 },
        dist: { type: 'clustered', clusters: 3, depth: 0.4 },
        palette: 'fire',
        colorMode: 'size',
        blend: 'plus-lighter',
        opacity: 1,
      },
      {
        gen: 'streaks',
        name: 'Fast streaks',
        params: { count: 26, length: 0.4, width: 4, taper: 1.3, curve: 0.1, angle: 0, spread: 180, bundle: 2, fade: 0.9, alpha: 0.7, core: 0.7 },
        dist: { type: 'clustered', clusters: 3, depth: 0.3 },
        palette: 'gold',
        blend: 'plus-lighter',
        opacity: 0.8,
      },
    ],
  },
  {
    id: 'violet-nebula',
    name: 'Violet Nebula',
    tags: ['nebula', 'space', 'purple', 'smoke'],
    description: 'Deep violet clouds threaded with stars.',
    seed: 22213,
    bg: DARK('#05030d'),
    layers: [
      {
        gen: 'smoke',
        params: { count: 140, radius: 170, sub: 5, warp: 1.3, alpha: 0.12, blend: 'screen', elongation: 1.3, hueSpread: 34, coreBoost: 0.45, depthMix: 0.7, softness: 0.85 },
        dist: { type: 'noiseMask', noiseScale: 1.6, noiseThreshold: 0.4, noiseContrast: 1.4, depth: 0.9, edgeFalloff: 0.3 },
        palette: 'violetMist',
        colorMode: 'position',
        axis: 45,
        opacity: 0.95,
      },
      {
        gen: 'particles',
        name: 'Stars',
        params: { count: 1600, shape: 'point', size: 3, sizeVary: 0.9, alpha: 0.85, twinkle: 0.6, hotCore: 0.4 },
        dist: { type: 'uniform', depth: 0.8, sizePower: 2, sizeMin: 0.2, opacityFalloff: 0.5 },
        palette: ['#ffffff', '#dfe6ff', '#ffd9f0'],
        blend: 'plus-lighter',
        opacity: 0.85,
      },
    ],
  },
  {
    id: 'spiral-galaxy',
    name: 'Spiral Galaxy',
    tags: ['spiral', 'galaxy', 'space', 'radial'],
    description: 'A log-spiral star cloud with a luminous core.',
    seed: 23307,
    bg: DARK('#02040a'),
    layers: [
      {
        gen: 'particles',
        params: { count: 2600, shape: 'glow', size: 5, sizeVary: 0.8, alpha: 0.6, twinkle: 0.5, hotCore: 0.45, softness: 0.75 },
        dist: { type: 'spiral', arms: 4, inner: 0.05, curveAmount: 0.9, depth: 0.6, sizePower: 1.6, sizeMin: 0.2, opacityFalloff: 0.5 },
        palette: 'blueGlitter',
        colorMode: 'size',
        blend: 'plus-lighter',
        opacity: 0.9,
      },
      {
        gen: 'particles',
        name: 'Core',
        params: { count: 400, shape: 'glow', size: 16, alpha: 0.5, twinkle: 0.4, hotCore: 0.8 },
        dist: { type: 'radial', inner: 0, radialFalloff: 3.2, depth: 0.3 },
        palette: 'gold',
        blend: 'plus-lighter',
        opacity: 0.8,
      },
    ],
  },
  {
    id: 'golden-starburst',
    name: 'Golden Starburst',
    tags: ['starburst', 'gold', 'rays', 'celebration'],
    description: 'A radial burst of gold spokes around a hot centre.',
    seed: 24401,
    bg: DARK('#0b0704'),
    layers: [
      {
        gen: 'rays',
        params: { mode: 'starburst', count: 40, origin: 'center', angle: 0, length: 1.1, width: 20, taper: 0.8, intensity: 0.6, coreSize: 0.8, jitter: 0.5, alpha: 0.8 },
        dist: { type: 'uniform' },
        palette: 'gold',
        blend: 'plus-lighter',
        opacity: 0.9,
      },
      {
        gen: 'particles',
        params: { count: 500, shape: 'sparkle', rays: 8, size: 30, alpha: 0.7, twinkle: 0.6, hotCore: 0 },
        dist: { type: 'radial', inner: 0.2, radialFalloff: 1.6, depth: 0.5 },
        palette: 'gold',
        blend: 'plus-lighter',
        opacity: 0.8,
      },
    ],
  },
  {
    id: 'mint-rings',
    name: 'Mint Rings',
    tags: ['rings', 'mint', 'minimal', 'green'],
    description: 'Hollow mint rings scattered like soap bubbles.',
    seed: 25501,
    bg: CLEAR,
    layers: [
      {
        gen: 'particles',
        params: { count: 260, shape: 'ring', size: 42, ringWidth: 0.14, softness: 0.5, alpha: 0.75, twinkle: 0.3, hotCore: 0 },
        dist: { type: 'poisson', radius: 0.06, depth: 0.7, sizePower: 1.2, opacityFalloff: 0.4 },
        palette: ['#0d3b2e', '#17a37a', '#7ef0c9', '#e7fff8'],
        colorMode: 'position',
        axis: 135,
        blend: 'screen',
        opacity: 0.9,
      },
      {
        gen: 'particles',
        name: 'Dots',
        params: { count: 500, shape: 'disc', size: 5, alpha: 0.7, twinkle: 0.5, softness: 0.9 },
        dist: { type: 'uniform', depth: 0.6 },
        palette: ['#17a37a', '#7ef0c9'],
        blend: 'screen',
        opacity: 0.7,
      },
    ],
  },
  {
    id: 'sunset-light-trails',
    name: 'Sunset Light Trails',
    tags: ['trails', 'sunset', 'warm', 'streaks'],
    description: 'Long warm trails sweeping across the frame.',
    seed: 26603,
    bg: GRAD('#22071a', '#57172b', 30),
    layers: [
      {
        gen: 'streaks',
        params: { count: 34, length: 1.25, width: 18, taper: 1, curve: 0.5, angle: 18, spread: 30, bundle: 4, fade: 0.9, alpha: 0.7, core: 0.6, segments: 30 },
        dist: { type: 'curve', curve: 'arc', curveAmount: 0.5, depth: 0.5, sizePower: 1 },
        palette: 'sunset',
        colorMode: 'position',
        axis: 20,
        blend: 'plus-lighter',
        opacity: 0.85,
      },
      { gen: 'grain', params: { mode: 'both', density: 3, amount: 0.3, vignette: 0.55 }, palette: 'sunset' },
    ],
  },
  {
    id: 'aurora-veil',
    name: 'Aurora Veil',
    tags: ['aurora', 'green', 'flow', 'sky'],
    description: 'Curl-noise curtains with a soft atmospheric glow.',
    seed: 27719,
    bg: GRAD('#010409', '#04141f', 90),
    layers: [
      {
        gen: 'flow',
        params: { count: 520, steps: 120, stepSize: 7, fieldScale: 1.6, curlStrength: 1.3, width: 8, taper: 0.5, alpha: 0.4, wander: 0.7, headDot: 0.15, colorFlow: 0.8 },
        dist: { type: 'sineBand', band: 0.3, arms: 2, curveAmount: 0.5, depth: 0.6, sizePower: 1 },
        palette: 'aurora',
        colorMode: 'position',
        axis: 0,
        blend: 'screen',
        opacity: 0.85,
        mods: [{ type: 'scaleByPos', amount: 0.4, secondary: 90 }],
      },
      {
        gen: 'smoke',
        params: { count: 40, radius: 260, alpha: 0.08, blend: 'screen', hueSpread: 20, elongation: 2.4 },
        dist: { type: 'uniform', depth: 0.8 },
        palette: 'aurora',
        opacity: 0.7,
      },
    ],
  },
  {
    id: 'diamond-dust',
    name: 'Diamond Dust',
    tags: ['diamond', 'glitter', 'white', 'sparkle'],
    description: 'Hard white glitter on a near-black field.',
    seed: 28807,
    bg: DARK('#050507'),
    layers: [
      {
        gen: 'particles',
        params: { count: 1800, shape: 'sparkle', rays: 4, size: 18, sizeVary: 0.9, alpha: 0.8, twinkle: 0.75, hotCore: 0 },
        dist: { type: 'poisson', radius: 0.028, depth: 0.7, sizePower: 1.8, sizeMin: 0.15, opacityFalloff: 0.5, edgeFalloff: 0.3 },
        palette: ['#ffffff', '#eaf4ff', '#cfd8e8', '#a9b6cc'],
        colorMode: 'size',
        blend: 'plus-lighter',
        opacity: 0.9,
      },
      { gen: 'grain', params: { mode: 'vignette', vignette: 0.5 }, palette: 'silver' },
    ],
  },
  {
    id: 'sunset-bokeh-field',
    name: 'Sunset Bokeh Field',
    tags: ['bokeh', 'sunset', 'warm', 'soft'],
    description: 'Warm hexagonal highlights drifting out of focus.',
    seed: 29903,
    bg: GRAD('#2a0f06', '#4a1d0b', 160),
    layers: [
      {
        gen: 'bokeh',
        params: { count: 110, size: 96, shape: 'hex', softness: 0.3, rim: 0.55, rimWidth: 0.09, dof: 0.7, chroma: 0.35, alpha: 0.6, hexRotate: true },
        dist: { type: 'gaussian', depth: 0.85, sizePower: 1.3, sizeMin: 0.3, opacityFalloff: 0.55 },
        palette: 'sunset',
        colorMode: 'position',
        axis: 120,
        blend: 'screen',
        opacity: 0.9,
      },
      {
        gen: 'particles',
        params: { count: 300, shape: 'glow', size: 9, alpha: 0.55, twinkle: 0.5, hotCore: 0.5, softness: 0.85 },
        dist: { type: 'uniform', depth: 0.6 },
        palette: 'gold',
        blend: 'plus-lighter',
        opacity: 0.7,
      },
    ],
  },
  {
    id: 'cosmic-dust-tunnel',
    name: 'Cosmic Dust Tunnel',
    tags: ['twist', 'cosmic', 'noise mask', 'violet'],
    description: 'A noise-masked dust field twisted into a tunnel.',
    seed: 31103,
    bg: DARK('#060309'),
    layers: [
      {
        gen: 'particles',
        params: { count: 3000, shape: 'disc', size: 8, sizeVary: 0.85, alpha: 0.6, twinkle: 0.5, hotCore: 0.35, softness: 0.8 },
        dist: { type: 'noiseMask', noiseScale: 3.4, noiseThreshold: 0.44, noiseContrast: 1.6, depth: 0.8, sizePower: 1.7, sizeMin: 0.2, opacityFalloff: 0.5 },
        palette: 'violetMist',
        colorMode: 'position',
        axis: 0,
        blend: 'plus-lighter',
        opacity: 0.85,
        mods: [{ type: 'twist', amount: 1.4, secondary: 1.6 }],
      },
      { gen: 'grain', params: { mode: 'both', density: 3.4, amount: 0.28, vignette: 0.6, vignetteColor: '#0b0018' }, palette: 'violetMist' },
    ],
  },
  {
    id: 'neon-hex-lattice',
    name: 'Neon Hex Lattice',
    tags: ['neon', 'hex', 'grid', 'cyber'],
    description: 'A magenta-cyan hex lattice with a bloom pass.',
    seed: 32207,
    bg: DARK('#08050e'),
    layers: [
      {
        gen: 'geometric',
        params: { mode: 'hexGrid', count: 1, width: 2.6, glow: 1, glowWidth: 14, radius: 0.62, gridSteps: 7, alpha: 0.75, jitter: 0 },
        dist: { type: 'uniform' },
        palette: ['#ff2fb9', '#8a5cff', '#22e0ff'],
        colorMode: 'position',
        axis: 30,
        blend: 'screen',
        opacity: 0.9,
      },
      {
        gen: 'particles',
        params: { count: 260, shape: 'point', size: 5, alpha: 0.75, twinkle: 0.5, hotCore: 0.6 },
        dist: { type: 'gridJitter', clusters: 49, curveAmount: 0.4, depth: 0.3 },
        palette: ['#ff2fb9', '#22e0ff'],
        colorMode: 'random',
        blend: 'plus-lighter',
        opacity: 0.8,
      },
    ],
  },
  {
    id: 'gold-leaf-fall',
    name: 'Falling Gold Leaves',
    tags: ['leaves', 'gold', 'autumn', 'falling'],
    description: 'Gold leaves tumbling down a dark gradient.',
    seed: 33301,
    bg: GRAD('#0d0903', '#241604', 170),
    layers: [
      {
        gen: 'scatter',
        params: { count: 200, shape: 'leaf', size: 60, sizeVary: 0.8, rotate: 1, wobble: 0.7, wobblePhase: 5, outline: 0.35, shade: 0.75, alpha: 0.95, hueJitter: 16 },
        dist: { type: 'uniform', depth: 0.8, sizePower: 1.25, sizeMin: 0.35, opacityFalloff: 0.4, edgeFalloff: 0.25 },
        palette: 'gold',
        colorMode: 'position',
        axis: 90,
        opacity: 1,
        mods: [{ type: 'colorByPos', amount: 40, secondary: 90 }],
      },
      {
        gen: 'particles',
        name: 'Motes',
        params: { count: 700, shape: 'disc', size: 6, alpha: 0.6, twinkle: 0.6, softness: 0.8 },
        dist: { type: 'uniform', depth: 0.7, sizePower: 1.5, sizeMin: 0.25 },
        palette: 'gold',
        blend: 'plus-lighter',
        opacity: 0.65,
      },
    ],
  },
  {
    id: 'smoke-signals',
    name: 'Smoke Signals',
    tags: ['smoke', 'grey', 'dramatic', 'shadow'],
    description: 'Dense grey smoke drifting across a black field.',
    seed: 34407,
    bg: DARK('#000000'),
    layers: [
      {
        gen: 'smoke',
        params: { count: 160, radius: 150, sub: 6, warp: 1.5, alpha: 0.13, blend: 'normal', elongation: 1.5, hueSpread: 0, coreBoost: 0.2, depthMix: 0.75, softness: 0.9, noiseScale: 4 },
        dist: { type: 'clustered', clusters: 7, depth: 0.9, edgeFalloff: 0.35 },
        palette: ['#101010', '#4a4a4a', '#9a9a9a', '#e8e8e8'],
        colorMode: 'size',
        opacity: 0.95,
      },
      {
        gen: 'smoke',
        name: 'Backlight',
        params: { count: 30, radius: 260, alpha: 0.1, blend: 'screen', hueSpread: 0, elongation: 1.8 },
        dist: { type: 'gaussian', depth: 0.6 },
        palette: ['#2a2a2a', '#8a8a8a', '#ffffff'],
        opacity: 0.7,
      },
    ],
  },
  {
    id: 'liquid-waves',
    name: 'Liquid Neon Waves',
    tags: ['waves', 'liquid', 'neon', 'lines'],
    description: 'Stacked sine ribbons with a neon bloom.',
    seed: 35501,
    bg: DARK('#04060f'),
    layers: [
      {
        gen: 'geometric',
        params: { mode: 'waves', count: 16, width: 3, glow: 1, glowWidth: 14, radius: 0.5, waveAmp: 0.3, alpha: 0.75, jitter: 0.1, resolution: 240 },
        dist: { type: 'uniform' },
        palette: ['#00e5ff', '#7c4dff', '#ff4081'],
        colorMode: 'position',
        axis: 90,
        blend: 'screen',
        opacity: 0.9,
        mods: [{ type: 'colorByPos', amount: 70, secondary: 0 }],
      },
      { gen: 'grain', params: { mode: 'both', density: 3, amount: 0.26, vignette: 0.55 }, palette: 'neonCyan' },
    ],
  },
  {
    id: 'rain-on-lens',
    name: 'Rain on Lens',
    tags: ['rain', 'bokeh', 'blue', 'moody'],
    description: 'Rain streaks over out-of-focus street lights.',
    seed: 36607,
    bg: GRAD('#03060e', '#0a1526', 190),
    layers: [
      {
        gen: 'bokeh',
        params: { count: 80, size: 120, softness: 0.4, rim: 0.5, dof: 0.9, chroma: 0.5, alpha: 0.5 },
        dist: { type: 'gaussian', depth: 0.9, sizePower: 1.4, sizeMin: 0.3, opacityFalloff: 0.6 },
        palette: ['#ffb454', '#ffd9a0', '#5aa9ff', '#9fd0ff'],
        colorMode: 'random',
        blend: 'screen',
        opacity: 0.8,
      },
      {
        gen: 'emitters',
        params: { type: 'falling', count: 420, life: 55, speed: 16, gravity: 2.4, drag: 0.01, wobble: 0.2, size: 2.5, trail: 0.95, headGlow: 0.5, alpha: 0.7 },
        dist: { type: 'uniform', depth: 0.6 },
        palette: 'iceBlue',
        blend: 'screen',
        opacity: 0.7,
      },
    ],
  },
  {
    id: 'kaleido-gems',
    name: 'Kaleido Gems',
    tags: ['kaleidoscope', 'jewel', 'geometry', 'symmetric'],
    description: 'Jewel-toned radial lines folded six ways.',
    seed: 37703,
    bg: DARK('#05050a'),
    layers: [
      {
        gen: 'geometric',
        params: { mode: 'lines', count: 24, width: 3, glow: 0.9, glowWidth: 12, radius: 0.5, alpha: 0.8, jitter: 0.35, resolution: 60 },
        dist: { type: 'radial', inner: 0.1, radialFalloff: 1.4 },
        palette: 'jewel',
        colorMode: 'size',
        blend: 'screen',
        opacity: 0.9,
        mods: [{ type: 'kaleido', amount: 6, secondary: 0.04 }],
      },
      {
        gen: 'particles',
        params: { count: 400, shape: 'ring', size: 18, ringWidth: 0.3, alpha: 0.6, twinkle: 0.4, hotCore: 0 },
        dist: { type: 'radial', inner: 0.25, radialFalloff: 2, depth: 0.5 },
        palette: 'jewel',
        blend: 'plus-lighter',
        opacity: 0.7,
      },
    ],
  },
  {
    id: 'sandstorm-dust',
    name: 'Sandstorm Dust',
    tags: ['dust', 'amber', 'storm', 'warm'],
    description: 'Wind-blown amber dust with directional streaks.',
    seed: 38801,
    bg: GRAD('#1b1004', '#3a2409', 105),
    layers: [
      {
        gen: 'particles',
        params: { count: 4000, shape: 'disc', size: 5, sizeVary: 0.9, alpha: 0.5, twinkle: 0.4, hotCore: 0.2, softness: 0.9 },
        dist: { type: 'noiseMask', noiseScale: 5, noiseThreshold: 0.36, noiseContrast: 1.1, depth: 0.7, sizePower: 1.8, sizeMin: 0.15, opacityFalloff: 0.4 },
        palette: 'autumn',
        colorMode: 'position',
        axis: 15,
        blend: 'plus-lighter',
        opacity: 0.8,
        mods: [{ type: 'noise', amount: 0.2, secondary: 6, tertiary: 3 }],
      },
      {
        gen: 'streaks',
        name: 'Wind',
        params: { count: 40, length: 0.5, width: 5, taper: 1.2, curve: 0.3, angle: 12, spread: 14, bundle: 2, fade: 0.9, alpha: 0.4, core: 0.3 },
        dist: { type: 'uniform', depth: 0.5 },
        palette: 'gold',
        blend: 'screen',
        opacity: 0.6,
      },
    ],
  },
  {
    id: 'vapor-bloom',
    name: 'Vapor Bloom',
    tags: ['vaporwave', 'pastel', 'bokeh', 'pink'],
    description: 'Pastel highlights with a soft halation layer.',
    seed: 39907,
    bg: GRAD('#1a0b2e', '#37154d', 145),
    layers: [
      {
        gen: 'bokeh',
        params: { count: 70, size: 140, softness: 0.5, rim: 0.45, dof: 0.7, chroma: 0.7, alpha: 0.45 },
        dist: { type: 'radial', inner: 0.15, radialFalloff: 1.6, depth: 0.8, sizePower: 1.4, sizeMin: 0.35 },
        palette: 'pastel',
        colorMode: 'position',
        axis: 60,
        blend: 'screen',
        opacity: 0.85,
      },
      {
        gen: 'smoke',
        params: { count: 50, radius: 220, alpha: 0.09, blend: 'screen', hueSpread: 40, elongation: 1.7 },
        dist: { type: 'uniform', depth: 0.7 },
        palette: 'pastel',
        opacity: 0.7,
      },
      {
        gen: 'particles',
        params: { count: 300, shape: 'sparkle', rays: 6, size: 24, alpha: 0.7, twinkle: 0.7, hotCore: 0 },
        dist: { type: 'poisson', radius: 0.06, depth: 0.5 },
        palette: 'pastel',
        blend: 'plus-lighter',
        opacity: 0.75,
      },
    ],
  },
  ...RIBBON_PRESETS.map((r): PresetDef => ({
    id: r.id,
    name: r.name,
    tags: r.tags,
    description: r.description,
    seed: r.seed,
    bg: r.bg,
    layers: [r.layer],
  })),
  ...GRADIENT_SHAPES_PRESETS.map((r): PresetDef => ({
    id: r.id,
    name: r.name,
    tags: r.tags,
    description: r.description,
    seed: r.seed,
    bg: r.bg,
    layers: [r.layer],
  })),
  ...MOSAIC_PRESETS.map((r): PresetDef => ({
    id: r.id,
    name: r.name,
    tags: r.tags,
    description: r.description,
    seed: r.seed,
    bg: r.bg,
    layers: [r.layer],
  })),
  ...MESH_PRESETS.map((r): PresetDef => ({
    id: r.id,
    name: r.name,
    tags: r.tags,
    description: r.description,
    seed: r.seed,
    bg: r.bg,
    layers: [r.layer],
  })),
]

export const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]))
export const ALL_PRESET_TAGS = [...new Set(PRESETS.flatMap((p) => p.tags))].sort()

export function getPreset(id: string): Project | null {
  const def = PRESET_BY_ID.get(id)
  return def ? buildPreset(def) : null
}
