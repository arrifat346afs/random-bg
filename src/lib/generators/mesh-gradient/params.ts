/**
 * mesh-gradient/params.ts — Parameter schema for the mesh gradient generator.
 *
 * Pure data for the inspector, randomiser and presets. No React, no DOM.
 */

import type { ParamDef } from '../../schema'

/** How control-point colours are assigned from the palette. */
export const MESH_MAPPING_OPTIONS: { value: string; label: string }[] = [
  { value: 'ramp', label: 'Value ramp' },
  { value: 'random', label: 'Seeded random' },
]

export const MESH_PARAMS: ParamDef[] = [
  {
    key: 'cols',
    label: 'Columns',
    type: 'int',
    min: 2,
    max: 5,
    step: 1,
    default: 3,
    section: 'shape',
    hint: 'Colour control points across (4–9 total with rows).',
    rand: { min: 2, max: 4 },
  },
  {
    key: 'rows',
    label: 'Rows',
    type: 'int',
    min: 2,
    max: 5,
    step: 1,
    default: 3,
    section: 'shape',
    hint: 'Colour control points down (4–9 total with columns).',
    rand: { min: 2, max: 4 },
  },
  {
    key: 'jitter',
    label: 'Point jitter',
    type: 'float',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.45,
    section: 'shape',
    hint: 'Fraction of a cell each control point may wander.',
  },
  {
    key: 'warp',
    label: 'Domain warp',
    type: 'float',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.35,
    section: 'shape',
    hint: 'How far the fBm field displaces the colour regions.',
  },
  {
    key: 'warpScale',
    label: 'Warp scale',
    type: 'float',
    min: 0.5,
    max: 4,
    step: 0.1,
    default: 1.5,
    section: 'shape',
    hint: 'Frequency of the warp field; low = broad flows.',
  },
  {
    key: 'mapping',
    label: 'Colour mapping',
    type: 'enum',
    options: MESH_MAPPING_OPTIONS,
    default: 'ramp',
    section: 'style',
  },
  {
    key: 'softness',
    label: 'Blend softness',
    type: 'float',
    min: 0.3,
    max: 1.2,
    step: 0.01,
    default: 0.8,
    section: 'style',
    hint: 'Blob radius as a multiple of the cell size; high = seamless.',
  },
  {
    key: 'alpha',
    label: 'Opacity',
    type: 'float',
    min: 0.4,
    max: 1,
    step: 0.01,
    default: 1,
    section: 'style',
    rand: { min: 0.8, max: 1 },
  },
]

/** Designed defaults. */
export function meshDefaults(): Record<string, number | string> {
  return {
    cols: 3,
    rows: 3,
    jitter: 0.45,
    warp: 0.35,
    warpScale: 1.5,
    mapping: 'ramp',
    softness: 0.8,
    alpha: 1,
  }
}
