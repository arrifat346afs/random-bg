/**
 * wallpaper/flow-waves/params.ts — Parameter schema for the flow waves generator.
 *
 * Pure data for the inspector, randomiser and presets. No React, no DOM.
 */

import type { ParamDef } from '../../../schema'

export const FLOW_VARIANT_OPTIONS: { value: string; label: string }[] = [
  { value: 'dark', label: 'Dark base' },
  { value: 'light', label: 'Light airy base' },
]

export const FLOW_WAVE_PARAMS: ParamDef[] = [
  {
    key: 'bands',
    label: 'Wave bands',
    type: 'int',
    min: 3,
    max: 5,
    step: 1,
    default: 4,
    section: 'shape',
    rand: { min: 3, max: 5 },
  },
  {
    key: 'amplitude',
    label: 'Amplitude',
    type: 'float',
    min: 0.02,
    max: 0.3,
    step: 0.01,
    default: 0.12,
    section: 'shape',
    unit: '×h',
    hint: 'Wave height as a fraction of canvas height.',
    rand: { min: 0.05, max: 0.22 },
  },
  {
    key: 'wavelength',
    label: 'Wavelength',
    type: 'float',
    min: 0.4,
    max: 2.5,
    step: 0.05,
    default: 1.1,
    section: 'shape',
    unit: '×w',
    hint: 'Wave length as a fraction of canvas width.',
  },
  {
    key: 'tilt',
    label: 'Tilt',
    type: 'float',
    min: -30,
    max: 30,
    step: 1,
    default: -8,
    section: 'shape',
    unit: '°',
    hint: 'Overall slope of the flow across the canvas.',
  },
  {
    key: 'thickness',
    label: 'Band thickness',
    type: 'float',
    min: 0.08,
    max: 0.5,
    step: 0.01,
    default: 0.22,
    section: 'shape',
    unit: '×h',
    hint: 'Band width as a fraction of canvas height.',
  },
  {
    key: 'twist',
    label: 'Twist',
    type: 'float',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.3,
    section: 'shape',
    hint: 'Second-harmonic bend so bands fold rather than repeat.',
  },
  {
    key: 'variant',
    label: 'Variant',
    type: 'enum',
    options: FLOW_VARIANT_OPTIONS,
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
    key: 'highlight',
    label: 'Edge light',
    type: 'float',
    min: 0,
    max: 0.5,
    step: 0.01,
    default: 0.22,
    section: 'style',
    hint: 'Soft inner light along one edge of each band.',
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
export function flowWaveDefaults(): Record<string, number | string> {
  return {
    bands: 4,
    amplitude: 0.12,
    wavelength: 1.1,
    tilt: -8,
    thickness: 0.22,
    twist: 0.3,
    variant: 'dark',
    feather: 0.03,
    highlight: 0.22,
    alpha: 1,
  }
}
