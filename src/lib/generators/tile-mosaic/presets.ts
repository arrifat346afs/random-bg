/**
 * tile-mosaic/presets.ts — Four mosaic presets.
 *
 * Partial layer specs merged onto generator defaults by `src/lib/presets.ts`.
 * Colours are explicit so presets never drift with the project palette.
 */

import type { PresetLayerSpec } from '../../presets'
import type { BackgroundSpec } from '../../schema'

export interface MosaicPreset {
  id: string
  name: string
  tags: string[]
  description: string
  seed: number
  bg: BackgroundSpec
  layer: PresetLayerSpec
}

export const MOSAIC_PRESETS: MosaicPreset[] = [
  {
    id: 'coral-triangles',
    name: 'Coral Triangles',
    tags: ['mosaic', 'triangles', 'coral', 'magenta', 'geometric'],
    description: 'Warm magenta-coral triangles with grout gaps.',
    seed: 53001,
    bg: { kind: 'solid', color: '#1c0a12' },
    layer: {
      gen: 'mosaic',
      params: { cols: 14, rows: 14, split: 'mixed', spin: 0.7, symmetry: 'none', mapping: 'random', shade: 0.6, gap: 2 },
      palette: ['#c2185b', '#ff7043', '#ffd166', '#ffe082'],
      blend: 'normal',
      opacity: 1,
    },
  },
  {
    id: 'teal-navy-mosaic',
    name: 'Teal Navy Mosaic',
    tags: ['mosaic', 'teal', 'navy', 'geometric', 'cool'],
    description: 'Teal and navy low-poly triangles by noise field.',
    seed: 53007,
    bg: { kind: 'solid', color: '#04141f' },
    layer: {
      gen: 'mosaic',
      params: { cols: 16, rows: 16, split: 'mixed', spin: 0.8, symmetry: 'none', mapping: 'noise', shade: 0.55, gap: 1.5 },
      palette: ['#032b3a', '#00c2a8', '#1565c0', '#9fd0ff'],
      blend: 'normal',
      opacity: 1,
    },
  },
  {
    id: 'mono-lowpoly',
    name: 'Mono Low-Poly',
    tags: ['mosaic', 'monochrome', 'low-poly', 'minimal'],
    description: 'Monochrome four-triangle cells with four-way symmetry.',
    seed: 53013,
    bg: { kind: 'solid', color: '#0b0d10' },
    layer: {
      gen: 'mosaic',
      params: { cols: 12, rows: 12, split: 'quad', spin: 0.4, symmetry: 'fourWay', mapping: 'position', axis: 45, shade: 0.7, gap: 1 },
      palette: ['#2b2f36', '#8b949e', '#d7dde5', '#ffffff'],
      blend: 'normal',
      opacity: 1,
    },
  },
  {
    id: 'pastel-mosaic',
    name: 'Pastel Mosaic',
    tags: ['mosaic', 'pastel', 'soft', 'triangles'],
    description: 'Soft pastel triangles on a light blush ground.',
    seed: 53019,
    bg: { kind: 'solid', color: '#faf6f0' },
    layer: {
      gen: 'mosaic',
      params: { cols: 13, rows: 13, split: 'mixed', spin: 0.6, symmetry: 'mirrorX', mapping: 'position', axis: 90, shade: 0.4, gap: 2.5 },
      palette: ['#ff4081', '#ff9100', '#ffee58', '#40c4ff'],
      blend: 'normal',
      opacity: 1,
    },
  },
]
