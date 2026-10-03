/**
 * neon-ribbons/presets.ts — Eight ribbon presets on dark grounds.
 *
 * Each preset is a partial layer spec; `src/lib/presets.ts` merges it onto
 * generator defaults. Colours are explicit so presets never drift with the
 * project palette.
 */

import type { PresetLayerSpec } from '../../presets'
import type { BackgroundSpec } from '../../schema'

export interface RibbonPreset {
  id: string
  name: string
  tags: string[]
  description: string
  seed: number
  bg: BackgroundSpec
  layer: PresetLayerSpec
}

/** Dark solid ground helper. */
const DARK = (color: string): BackgroundSpec => ({ kind: 'solid', color })

export const RIBBON_PRESETS: RibbonPreset[] = [
  {
    id: 'blue-swirl-rings',
    name: 'Blue Swirl Rings',
    tags: ['ribbons', 'swirl', 'blue', 'neon', 'dark'],
    description: 'Concentric blue light swirls with hot white cores.',
    seed: 51001,
    bg: DARK('#030711'),
    layer: {
      gen: 'ribbons',
      params: { curve: 'swirl', count: 3, strands: 34, length: 0.85, spread: 26, twist: 1, width: 5, glowRadius: 16, core: 0.75, alpha: 0.85, colorFlow: 0.7, sparkle: 0.6 },
      palette: ['#0a1f5c', '#2a63d8', '#74b8ff', '#e9f6ff'],
      colorMode: 'palette',
      blend: 'screen',
      opacity: 0.95,
    },
  },
  {
    id: 'purple-cyan-scurve',
    name: 'Purple Cyan S-Curve',
    tags: ['ribbons', 's-curve', 'purple', 'cyan', 'neon'],
    description: 'A purple-to-cyan S ribbon with a soft halo.',
    seed: 51007,
    bg: DARK('#0a0616'),
    layer: {
      gen: 'ribbons',
      params: { curve: 'sCurve', count: 2, strands: 30, length: 1.1, spread: 20, twist: 0.7, width: 5, glowRadius: 18, core: 0.7, alpha: 0.85, colorFlow: 0.9, sparkle: 0.4 },
      palette: ['#3a0ca3', '#7b2ff7', '#22e0ff', '#c77dff'],
      colorMode: 'position',
      axis: 25,
      blend: 'screen',
      opacity: 0.95,
    },
  },
  {
    id: 'green-vortex',
    name: 'Green Vortex',
    tags: ['ribbons', 'vortex', 'green', 'swirl'],
    description: 'A tightening green vortex ring stack.',
    seed: 51013,
    bg: DARK('#04120b'),
    layer: {
      gen: 'ribbons',
      params: { curve: 'vortex', count: 3, strands: 36, length: 0.9, spread: 24, twist: 1.2, width: 4.5, glowRadius: 15, core: 0.7, perspective: 0.5, alpha: 0.85, sparkle: 0.55 },
      palette: ['#04150c', '#16603a', '#3fae6a', '#c8f5d0'],
      colorMode: 'palette',
      blend: 'screen',
      opacity: 0.95,
    },
  },
  {
    id: 'ember-speed-lines',
    name: 'Ember Speed Lines',
    tags: ['ribbons', 'speed', 'orange', 'blue', 'contrast'],
    description: 'Orange and blue converging speed lines.',
    seed: 51019,
    bg: DARK('#0b0704'),
    layer: {
      gen: 'ribbons',
      params: { curve: 'fan', count: 2, strands: 42, length: 1.25, spread: 40, twist: 0.25, width: 4, glowRadius: 12, core: 0.65, alpha: 0.8, colorFlow: 0.5, sparkle: 0.25 },
      palette: ['#ff6b1a', '#ffd08a', '#2a63d8', '#9fd0ff'],
      colorMode: 'random',
      blend: 'screen',
      opacity: 0.9,
    },
  },
  {
    id: 'blue-fiber-fan',
    name: 'Blue Fiber Fan',
    tags: ['ribbons', 'fan', 'blue', 'fiber'],
    description: 'Fine blue fibres fanning from one edge.',
    seed: 51023,
    bg: DARK('#040a1c'),
    layer: {
      gen: 'ribbons',
      params: { curve: 'fan', count: 3, strands: 48, length: 1, spread: 34, twist: 0.4, width: 3, glowRadius: 10, core: 0.6, taper: 1.2, alpha: 0.8, sparkle: 0.35 },
      palette: ['#0a1f5c', '#2a63d8', '#74b8ff', '#e9f6ff'],
      colorMode: 'position',
      axis: 90,
      blend: 'screen',
      opacity: 0.9,
    },
  },
  {
    id: 'glowing-arrow',
    name: 'Glowing Arrow',
    tags: ['ribbons', 'arrow', 'chevron', 'streak'],
    description: 'A chevron light streak with a bright head.',
    seed: 51031,
    bg: DARK('#060309'),
    layer: {
      gen: 'ribbons',
      params: { curve: 'chevron', count: 2, strands: 26, length: 1, spread: 16, twist: 0.5, width: 5, glowRadius: 16, core: 0.85, alpha: 0.9, sparkle: 0.5 },
      palette: ['#ffd97a', '#ff8b1f', '#c2185b', '#ffffff'],
      colorMode: 'palette',
      blend: 'screen',
      opacity: 0.95,
    },
  },
  {
    id: 'magenta-ellipse-rings',
    name: 'Magenta Ellipse Rings',
    tags: ['ribbons', 'rings', 'magenta', 'ellipse', '3d'],
    description: 'Tilted magenta ellipse rings with perspective squash.',
    seed: 51037,
    bg: DARK('#08050e'),
    layer: {
      gen: 'ribbons',
      params: { curve: 'ellipse', count: 4, strands: 22, length: 0.75, spread: 14, twist: 0.3, width: 4, glowRadius: 14, core: 0.7, perspective: 0.35, alpha: 0.85, sparkle: 0.4 },
      palette: ['#ff2fb9', '#8a5cff', '#22e0ff', '#ffd9f0'],
      colorMode: 'position',
      axis: 35,
      blend: 'screen',
      opacity: 0.9,
    },
  },
  {
    id: 'gold-sweep',
    name: 'Gold Sweep',
    tags: ['ribbons', 'gold', 'sweep', 'elegant'],
    description: 'A long golden bezier sweep across black.',
    seed: 51043,
    bg: DARK('#0a0705'),
    layer: {
      gen: 'ribbons',
      params: { curve: 'bezier', count: 2, strands: 30, length: 1.2, spread: 22, twist: 0.6, width: 5, glowRadius: 17, core: 0.75, alpha: 0.85, colorFlow: 0.6, sparkle: 0.6 },
      palette: ['#7a4a08', '#c98a1a', '#ffd97a', '#fff6d8'],
      colorMode: 'palette',
      blend: 'screen',
      opacity: 0.95,
    },
  },
]
