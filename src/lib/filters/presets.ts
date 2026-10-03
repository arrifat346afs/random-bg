/**
 * filters/presets.ts — Quick stack presets ("Soft glow", "Film grain", …).
 * Pure data: each preset is a list of `{ type, params }` applied in order.
 */

import { defaultFilterParams } from './stack'
import type { Params } from '../schema'

export interface FilterStackPreset {
  id: string
  label: string
  description: string
  stack: { type: string; params?: Params }[]
}

function withDefaults(type: string, params: Params = {}): { type: string; params: Params } {
  return { type, params: { ...defaultFilterParams(type), ...params } }
}

export const FILTER_STACK_PRESETS: FilterStackPreset[] = [
  {
    id: 'soft-glow',
    label: 'Soft glow',
    description: 'Gentle blur plus an outer glow.',
    stack: [withDefaults('gaussian-blur', { sigmaX: 2, sigmaY: 2 }), withDefaults('outer-glow', { blur: 8, opacity: 0.5 })],
  },
  {
    id: 'film-grain',
    label: 'Film grain',
    description: 'Subtle monochrome grain.',
    stack: [withDefaults('grain', { amount: 0.18, size: 1, monochrome: true, seed: 5 })],
  },
  {
    id: 'dreamy-blur',
    label: 'Dreamy blur',
    description: 'Wide soft blur with lifted blacks.',
    stack: [withDefaults('gaussian-blur', { sigmaX: 6, sigmaY: 6 }), withDefaults('levels', { black: 0.04, white: 1, gamma: 1.05 })],
  },
  {
    id: 'neon-bloom',
    label: 'Neon bloom',
    description: 'Saturation push plus outer glow.',
    stack: [withDefaults('hsl', { hue: 0, saturation: 0.35, lightness: 0 }), withDefaults('outer-glow', { blur: 10, opacity: 0.65 })],
  },
  {
    id: 'duotone',
    label: 'Duotone',
    description: 'Two-tone gradient map.',
    stack: [withDefaults('duotone', {})],
  },
  {
    id: 'vintage',
    label: 'Vintage',
    description: 'Sepia, grain and a soft vignette-ish Levels.',
    stack: [withDefaults('sepia', { amount: 0.55 }), withDefaults('grain', { amount: 0.12, seed: 9 }), withDefaults('levels', { black: 0.03, gamma: 1.1 })],
  },
  {
    id: 'glitch',
    label: 'Glitch',
    description: 'Chromatic split plus light pixelation. Raster-only.',
    stack: [withDefaults('chromatic', { amount: 2.5 }), withDefaults('pixelate', { size: 4 })],
  },
]

export function getStackPreset(id: string): FilterStackPreset | undefined {
  return FILTER_STACK_PRESETS.find((p) => p.id === id)
}
