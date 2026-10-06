/**
 * wallpaper/ribbon-flow/presets.ts — Two ribbon flow presets.
 *
 * Partial layer specs merged onto generator defaults by `src/lib/presets.ts`.
 * Colours are explicit so presets never drift with the project palette.
 */

import type { PresetLayerSpec } from '../../../presets'
import type { BackgroundSpec } from '../../../schema'

export interface RibbonFlowPreset {
  id: string
  name: string
  tags: string[]
  description: string
  seed: number
  bg: BackgroundSpec
  layer: PresetLayerSpec
}

export const RIBBON_FLOW_PRESETS: RibbonFlowPreset[] = [
  {
    id: 'midnight-silk',
    name: 'Midnight Silk',
    tags: ['wallpaper', 'ribbon', 'silk', 'midnight', 'teal', 'dark'],
    description: 'Teal silk ribbons folding over a midnight base.',
    seed: 57001,
    bg: { kind: 'solid', color: '#04141f' },
    layer: {
      gen: 'ribbonFlow',
      params: { ribbons: 2, width: 0.2, curvature: 0.6, twist: 0.45, rim: 0.3, variant: 'dark', feather: 0.03 },
      palette: ['#04141f', '#032b3a', '#00c2a8', '#9fd0d8'],
      blend: 'normal',
      opacity: 1,
    },
  },
  {
    id: 'ice-ribbon',
    name: 'Ice Ribbon',
    tags: ['wallpaper', 'ribbon', 'ice', 'blue', 'light', 'airy'],
    description: 'Airy light-variant ice ribbons on pale frost.',
    seed: 57007,
    bg: { kind: 'solid', color: '#eef3f8' },
    layer: {
      gen: 'ribbonFlow',
      params: { ribbons: 2, width: 0.16, curvature: 0.5, twist: 0.35, rim: 0.28, variant: 'light', feather: 0.032 },
      palette: ['#9fc3d8', '#c4dcea', '#e2eef5', '#f7fafc'],
      blend: 'normal',
      opacity: 1,
    },
  },
]
