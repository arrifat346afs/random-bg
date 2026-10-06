/**
 * wallpaper/flow-waves/presets.ts — Four flow waves presets.
 *
 * Partial layer specs merged onto generator defaults by `src/lib/presets.ts`.
 * Colours are explicit so presets never drift with the project palette.
 */

import type { PresetLayerSpec } from '../../../presets'
import type { BackgroundSpec } from '../../../schema'

export interface FlowWavePreset {
  id: string
  name: string
  tags: string[]
  description: string
  seed: number
  bg: BackgroundSpec
  layer: PresetLayerSpec
}

export const FLOW_WAVE_PRESETS: FlowWavePreset[] = [
  {
    id: 'dusk-waves',
    name: 'Dusk Waves',
    tags: ['wallpaper', 'waves', 'dusk', 'violet', 'dark'],
    description: 'Violet dusk bands with a lit upper edge over deep indigo.',
    seed: 56001,
    bg: { kind: 'solid', color: '#14101f' },
    layer: {
      gen: 'flowWaves',
      params: { bands: 4, amplitude: 0.12, wavelength: 1.1, tilt: -8, thickness: 0.24, twist: 0.3, variant: 'dark', feather: 0.03, highlight: 0.22 },
      palette: ['#14101f', '#3a2a5e', '#7b5fc0', '#c9a8e8'],
      blend: 'normal',
      opacity: 1,
    },
  },
  {
    id: 'graphite-flow',
    name: 'Graphite Flow',
    tags: ['wallpaper', 'waves', 'graphite', 'grey', 'minimal', 'dark'],
    description: 'Near-monochrome graphite flow, calm and minimal.',
    seed: 56007,
    bg: { kind: 'solid', color: '#0b0d10' },
    layer: {
      gen: 'flowWaves',
      params: { bands: 3, amplitude: 0.08, wavelength: 1.4, tilt: -5, thickness: 0.3, twist: 0.2, variant: 'dark', feather: 0.035, highlight: 0.16 },
      palette: ['#0b0d10', '#2b2f36', '#8b949e', '#d7dde5'],
      blend: 'normal',
      opacity: 1,
    },
  },
  {
    id: 'coral-tide',
    name: 'Coral Tide',
    tags: ['wallpaper', 'waves', 'coral', 'warm', 'sunset'],
    description: 'Warm coral tide bands over deep plum water.',
    seed: 56013,
    bg: { kind: 'solid', color: '#1c0a12' },
    layer: {
      gen: 'flowWaves',
      params: { bands: 5, amplitude: 0.15, wavelength: 0.9, tilt: 6, thickness: 0.2, twist: 0.4, variant: 'dark', feather: 0.028, highlight: 0.25 },
      palette: ['#1c0a12', '#5c2430', '#c2185b', '#ff8b6e'],
      blend: 'normal',
      opacity: 1,
    },
  },
  {
    id: 'forest-mist',
    name: 'Forest Mist',
    tags: ['wallpaper', 'waves', 'forest', 'green', 'mist', 'light'],
    description: 'Airy light-variant mist bands in sage and eucalyptus.',
    seed: 56019,
    bg: { kind: 'solid', color: '#eef3ec' },
    layer: {
      gen: 'flowWaves',
      params: { bands: 4, amplitude: 0.1, wavelength: 1.2, tilt: -6, thickness: 0.26, twist: 0.25, variant: 'light', feather: 0.032, highlight: 0.2 },
      palette: ['#9db8a4', '#c4d6c5', '#e2ebe0', '#f4f8f2'],
      blend: 'normal',
      opacity: 1,
    },
  },
]
