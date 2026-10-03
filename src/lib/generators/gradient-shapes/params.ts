/**
 * gradient-shapes/params.ts — Parameter schema for the gradient shapes generator.
 *
 * Pure data for the inspector, randomiser and presets. No React, no DOM.
 */

import type { ParamDef } from '../../schema'

/** Shape selector; `mixed` draws from every family per item. */
export const SHAPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'mixed', label: 'Mixed' },
  { value: 'circle', label: 'Circles' },
  { value: 'halfDisc', label: 'Half-discs' },
  { value: 'rect', label: 'Rectangles' },
  { value: 'roundRect', label: 'Rounded rects' },
  { value: 'ring', label: 'Rings' },
]

/** Layout selector. */
export const LAYOUT_OPTIONS: { value: string; label: string }[] = [
  { value: 'vStack', label: 'Vertical stack' },
  { value: 'hStack', label: 'Horizontal stack' },
  { value: 'offsetCols', label: 'Offset columns' },
  { value: 'packed', label: 'Packed + overlap' },
  { value: 'scattered', label: 'Scattered' },
  { value: 'concentric', label: 'Concentric' },
]

/** Gradient angle selector. */
export const ANGLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'fixed', label: 'Fixed angle' },
  { value: 'random', label: 'Random per shape' },
  { value: 'aligned', label: 'Aligned to layout' },
]

export const GRADIENT_SHAPE_PARAMS: ParamDef[] = [
  {
    key: 'shape',
    label: 'Shape',
    type: 'enum',
    options: SHAPE_OPTIONS,
    default: 'mixed',
    section: 'shape',
  },
  {
    key: 'layout',
    label: 'Layout',
    type: 'enum',
    options: LAYOUT_OPTIONS,
    default: 'offsetCols',
    section: 'shape',
  },
  {
    key: 'count',
    label: 'Count',
    type: 'int',
    min: 1,
    max: 240,
    step: 1,
    default: 18,
    section: 'shape',
    hint: 'One shape is a valid result — exempt from the particle floor.',
    rand: { min: 4, max: 32 },
  },
  {
    key: 'sizeMin',
    label: 'Min size',
    type: 'float',
    min: 8,
    max: 600,
    step: 2,
    default: 90,
    section: 'shape',
    unit: 'px',
    rand: { min: 40, max: 140 },
  },
  {
    key: 'sizeMax',
    label: 'Max size',
    type: 'float',
    min: 16,
    max: 900,
    step: 2,
    default: 260,
    section: 'shape',
    unit: 'px',
    rand: { min: 150, max: 340 },
  },
  {
    key: 'overlap',
    label: 'Overlap',
    type: 'float',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.35,
    section: 'shape',
    hint: 'How much packed / stacked shapes cover each other.',
    rand: { min: 0, max: 0.7 },
  },
  {
    key: 'angleMode',
    label: 'Gradient angle',
    type: 'enum',
    options: ANGLE_OPTIONS,
    default: 'aligned',
    section: 'style',
  },
  {
    key: 'angle',
    label: 'Fixed angle',
    type: 'float',
    min: 0,
    max: 360,
    step: 1,
    default: 135,
    section: 'style',
    unit: '°',
    when: { key: 'angleMode', equals: 'fixed' },
  },
  {
    key: 'gradientKind',
    label: 'Gradient',
    type: 'enum',
    options: [
      { value: 'mixed', label: 'Mixed linear + radial' },
      { value: 'linear', label: 'Linear' },
      { value: 'radial', label: 'Radial' },
    ],
    default: 'mixed',
    section: 'style',
  },
  {
    key: 'contrast',
    label: 'Gradient contrast',
    type: 'float',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.65,
    section: 'style',
    hint: 'Light-to-dark span across the two palette stops.',
  },
  {
    key: 'softness',
    label: 'Edge softness',
    type: 'float',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.25,
    section: 'style',
    hint: 'Soft edge / shadow falloff; 0 = crisp vector edge.',
  },
  {
    key: 'alpha',
    label: 'Opacity',
    type: 'float',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.95,
    section: 'style',
    rand: { min: 0.6, max: 1 },
  },
]

/** Designed defaults. */
export function gradientShapeDefaults(): Record<string, number | string> {
  return {
    shape: 'mixed',
    layout: 'offsetCols',
    count: 18,
    sizeMin: 90,
    sizeMax: 260,
    overlap: 0.35,
    angleMode: 'aligned',
    angle: 135,
    gradientKind: 'mixed',
    contrast: 0.65,
    softness: 0.25,
    alpha: 0.95,
  }
}
