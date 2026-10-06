/**
 * mesh-gradient/presets.ts — Two mesh gradient presets.
 *
 * Partial layer specs merged onto generator defaults by `src/lib/presets.ts`.
 * Colours are explicit so presets never drift with the project palette.
 */

import type { PresetLayerSpec } from '../../presets'
import type { BackgroundSpec } from '../../schema'

export interface MeshPreset {
  id: string
  name: string
  tags: string[]
  description: string
  seed: number
  bg: BackgroundSpec
  layer: PresetLayerSpec
}

export const MESH_PRESETS: MeshPreset[] = [
  {
    id: 'aurora-mesh',
    name: 'Aurora Mesh',
    tags: ['mesh', 'gradient', 'aurora', 'teal', 'violet', 'background'],
    description: 'Dark teal-to-violet mesh gradient with a soft grain-ready ground.',
    seed: 54001,
    bg: { kind: 'solid', color: '#04141f' },
    layer: {
      gen: 'mesh',
      params: { cols: 3, rows: 3, jitter: 0.5, warp: 0.4, warpScale: 1.4, mapping: 'ramp', softness: 0.85, alpha: 1 },
      palette: ['#032b3a', '#00c2a8', '#5e35b1', '#b39ddb'],
      blend: 'normal',
      opacity: 1,
    },
  },
  {
    id: 'rose-mesh',
    name: 'Rose Mesh',
    tags: ['mesh', 'gradient', 'rose', 'pink', 'warm', 'background'],
    description: 'Warm rose-and-amber mesh gradient on a deep plum ground.',
    seed: 54007,
    bg: { kind: 'solid', color: '#1c0a12' },
    layer: {
      gen: 'mesh',
      params: { cols: 3, rows: 2, jitter: 0.4, warp: 0.3, warpScale: 1.8, mapping: 'ramp', softness: 0.9, alpha: 1 },
      palette: ['#5c2430', '#c2185b', '#ff8b1f', '#ffe082'],
      blend: 'normal',
      opacity: 1,
    },
  },
]
