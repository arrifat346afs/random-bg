/**
 * tile-mosaic/params.ts — Parameter schema for the tile mosaic generator.
 *
 * Pure data for the inspector, randomiser and presets. No React, no DOM.
 */

import type { ParamDef } from '../../schema'

/** How each cell is split into triangles. */
export const SPLIT_OPTIONS: { value: string; label: string }[] = [
  { value: 'mixed', label: 'Mixed diagonals' },
  { value: 'diagA', label: 'Diagonal ⁄' },
  { value: 'diagB', label: 'Diagonal ⁄ flipped' },
  { value: 'quad', label: 'Four triangles' },
]

/** Symmetry applied to the colour source (geometry stays a full grid). */
export const SYMMETRY_OPTIONS: { value: string; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'mirrorX', label: 'Mirror X' },
  { value: 'mirrorY', label: 'Mirror Y' },
  { value: 'fourWay', label: 'Four-way' },
  { value: 'kaleido', label: 'Kaleidoscope' },
]

/** How triangle colours are picked from the palette. */
export const MAPPING_OPTIONS: { value: string; label: string }[] = [
  { value: 'random', label: 'Seeded random' },
  { value: 'position', label: 'By position (gradient)' },
  { value: 'noise', label: 'By noise field' },
]

export const MOSAIC_PARAMS: ParamDef[] = [
  {
    key: 'cols',
    label: 'Columns',
    type: 'int',
    min: 2,
    max: 40,
    step: 1,
    default: 12,
    section: 'shape',
    rand: { min: 6, max: 20 },
  },
  {
    key: 'rows',
    label: 'Rows',
    type: 'int',
    min: 2,
    max: 40,
    step: 1,
    default: 12,
    section: 'shape',
    rand: { min: 6, max: 20 },
  },
  {
    key: 'split',
    label: 'Split mode',
    type: 'enum',
    options: SPLIT_OPTIONS,
    default: 'mixed',
    section: 'shape',
  },
  {
    key: 'spin',
    label: 'Diagonal randomness',
    type: 'float',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.7,
    section: 'shape',
    hint: 'How often mixed mode flips the diagonal; also jitters quad centres.',
  },
  {
    key: 'symmetry',
    label: 'Symmetry',
    type: 'enum',
    options: SYMMETRY_OPTIONS,
    default: 'none',
    section: 'shape',
  },
  {
    key: 'mapping',
    label: 'Palette mapping',
    type: 'enum',
    options: MAPPING_OPTIONS,
    default: 'random',
    section: 'style',
  },
  {
    key: 'axis',
    label: 'Gradient axis',
    type: 'float',
    min: 0,
    max: 360,
    step: 1,
    default: 45,
    section: 'style',
    unit: '°',
    when: { key: 'mapping', equals: 'position' },
  },
  {
    key: 'shade',
    label: 'Shade variance',
    type: 'float',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.55,
    section: 'style',
    hint: 'Lighter/darker ladder around each picked colour.',
    rand: { min: 0.2, max: 0.9 },
  },
  {
    key: 'gap',
    label: 'Gap width',
    type: 'float',
    min: 0,
    max: 14,
    step: 0.5,
    default: 1.5,
    section: 'style',
    unit: 'px',
    hint: 'Inset of each triangle toward its centroid — reads as grout.',
    rand: { min: 0, max: 5 },
  },
  {
    key: 'alpha',
    label: 'Opacity',
    type: 'float',
    min: 0,
    max: 1,
    step: 0.01,
    default: 1,
    section: 'style',
    rand: { min: 0.7, max: 1 },
  },
]

/** Designed defaults. */
export function mosaicDefaults(): Record<string, number | string> {
  return {
    cols: 12,
    rows: 12,
    split: 'mixed',
    spin: 0.7,
    symmetry: 'none',
    mapping: 'random',
    axis: 45,
    shade: 0.55,
    gap: 1.5,
    alpha: 1,
  }
}
