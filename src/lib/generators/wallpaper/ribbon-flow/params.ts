/**
 * wallpaper/ribbon-flow/params.ts — Parameter schema for the ribbon flow generator.
 *
 * Pure data for the inspector, randomiser and presets. No React, no DOM.
 */

import type { ParamDef } from '../../../schema'

export const RIBBON_VARIANT_OPTIONS: { value: string; label: string }[] = [
  { value: 'dark', label: 'Dark base' },
  { value: 'light', label: 'Light airy base' },
]

export const RIBBON_FLOW_PARAMS: ParamDef[] = [
  {
    key: 'ribbons',
    label: 'Ribbons',
    type: 'int',
    min: 1,
    max: 3,
    step: 1,
    default: 2,
    section: 'shape',
    rand: { min: 1, max: 3 },
  },
  {
    key: 'width',
    label: 'Ribbon width',
    type: 'float',
    min: 0.06,
    max: 0.4,
    step: 0.01,
    default: 0.18,
    section: 'shape',
    unit: '×min',
    hint: 'Width as a fraction of the short side.',
    rand: { min: 0.1, max: 0.3 },
  },
  {
    key: 'curvature',
    label: 'Curvature',
    type: 'float',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.55,
    section: 'shape',
    hint: 'How far the ribbon folds across the canvas.',
  },
  {
    key: 'twist',
    label: 'Twist',
    type: 'float',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.4,
    section: 'shape',
    hint: 'Width pinch-and-swell along the ribbon, like folded silk.',
  },
  {
    key: 'rim',
    label: 'Rim light',
    type: 'float',
    min: 0,
    max: 0.6,
    step: 0.01,
    default: 0.3,
    section: 'style',
    hint: 'Light along both ribbon edges; capped so it never clips.',
  },
  {
    key: 'variant',
    label: 'Variant',
    type: 'enum',
    options: RIBBON_VARIANT_OPTIONS,
    default: 'dark',
    section: 'style',
    hint: 'Same design remapped: deep dark base or bright airy base.',
  },
  {
    key: 'feather',
    label: 'Edge feather',
    type: 'float',
    min: 0.015,
    max: 0.08,
    step: 0.005,
    default: 0.03,
    section: 'style',
    unit: '×min',
    hint: 'Minimum edge softness as a fraction of the short side — never a hard edge.',
  },
  {
    key: 'alpha',
    label: 'Opacity',
    type: 'float',
    min: 0.5,
    max: 1,
    step: 0.01,
    default: 1,
    section: 'style',
    rand: { min: 0.85, max: 1 },
  },
]

/** Designed defaults. */
export function ribbonFlowDefaults(): Record<string, number | string> {
  return {
    ribbons: 2,
    width: 0.18,
    curvature: 0.55,
    twist: 0.4,
    rim: 0.3,
    variant: 'dark',
    feather: 0.03,
    alpha: 1,
  }
}
