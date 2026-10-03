/**
 * gradient-shapes/presets.ts — Three gradient-shape presets.
 *
 * Partial layer specs merged onto generator defaults by `src/lib/presets.ts`.
 * Colours are explicit so presets never drift with the project palette.
 */

import type { PresetLayerSpec } from '../../presets'
import type { BackgroundSpec } from '../../schema'

export interface GradientShapesPreset {
  id: string
  name: string
  tags: string[]
  description: string
  seed: number
  bg: BackgroundSpec
  layer: PresetLayerSpec
}

export const GRADIENT_SHAPES_PRESETS: GradientShapesPreset[] = [
  {
    id: 'steel-spheres',
    name: 'Steel Spheres on Black',
    tags: ['gradient', 'spheres', 'steel', 'blue', 'minimal'],
    description: 'Steel-blue radial spheres floating on black.',
    seed: 52001,
    bg: { kind: 'solid', color: '#040507' },
    layer: {
      gen: 'gradShapes',
      params: { shape: 'circle', layout: 'scattered', count: 14, sizeMin: 90, sizeMax: 260, gradientKind: 'radial', angleMode: 'aligned', contrast: 0.7, softness: 0.3, alpha: 0.95 },
      palette: ['#071a2e', '#1565c0', '#64b5f6', '#e3f2fd'],
      colorMode: 'size',
      blend: 'screen',
      opacity: 0.95,
    },
  },
  {
    id: 'rainbow-squares',
    name: 'Rainbow Gradient Squares',
    tags: ['gradient', 'squares', 'rainbow', 'colourful'],
    description: 'Packed rainbow squares with linear gradients.',
    seed: 52007,
    bg: { kind: 'solid', color: '#08080c' },
    layer: {
      gen: 'gradShapes',
      params: { shape: 'rect', layout: 'packed', count: 24, sizeMin: 110, sizeMax: 240, overlap: 0.5, gradientKind: 'linear', angleMode: 'random', contrast: 0.6, softness: 0.15, alpha: 0.95 },
      palette: ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff'],
      colorMode: 'position',
      axis: 45,
      blend: 'normal',
      opacity: 1,
    },
  },
  {
    id: 'tide-columns',
    name: 'Tide Columns',
    tags: ['gradient', 'half-disc', 'columns', 'blue', 'green', 'purple'],
    description: 'Blue/green/purple half-discs stacked in offset columns.',
    seed: 52013,
    bg: { kind: 'solid', color: '#05070d' },
    layer: {
      gen: 'gradShapes',
      params: { shape: 'halfDisc', layout: 'offsetCols', count: 21, sizeMin: 100, sizeMax: 220, gradientKind: 'linear', angleMode: 'aligned', contrast: 0.65, softness: 0.25, alpha: 0.95 },
      palette: ['#1565c0', '#00c2a8', '#7c4dff', '#9fd0ff'],
      colorMode: 'position',
      axis: 90,
      blend: 'screen',
      opacity: 0.95,
    },
  },
]
