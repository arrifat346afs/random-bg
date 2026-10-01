/**
 * inspector/schema.ts — the field tables that drive the Distribute and Params
 * tabs.
 *
 * Data, not components: each entry says which layer key to edit, how to render
 * it, and when it applies. Adding a knob is a row here rather than new JSX.
 */

import type { DistSpec } from '@/lib/schema'

export const SECTION_LABELS: Record<string, string> = {
  shape: 'Shape',
  style: 'Style',
  depth: 'Depth & focus',
  motion: 'Motion',
}

/* ---- distribution field schema ------------------------------------------ */

export interface DistField {
  key: keyof DistSpec
  label: string
  min?: number
  max?: number
  step?: number
  unit?: string
  hint?: string
  when?: DistSpec['type'][]
  options?: { value: string; label: string }[]
}

export const DIST_FIELDS: DistField[] = [
  { key: 'clusters', label: 'Clusters / cells', min: 2, max: 64, step: 1, when: ['clustered', 'gridJitter'] },
  { key: 'curve', label: 'Curve', options: [
    { value: 'sine', label: 'Sine' },
    { value: 'arc', label: 'Arc' },
    { value: 'diagonal', label: 'Diagonal' },
    { value: 'spiral', label: 'Spiral' },
    { value: 'v', label: 'V shape' },
  ], when: ['curve'] },
  { key: 'curveAmount', label: 'Curve amount', min: 0, max: 1, step: 0.01, when: ['curve', 'sineBand', 'spiral'] },
  { key: 'band', label: 'Band thickness', min: 0.02, max: 0.6, step: 0.01, when: ['sineBand'] },
  { key: 'arms', label: 'Arms', min: 1, max: 10, step: 1, when: ['spiral', 'sineBand'] },
  { key: 'inner', label: 'Inner radius', min: 0, max: 0.9, step: 0.01, when: ['radial', 'spiral'] },
  { key: 'radialFalloff', label: 'Radial falloff', min: 0.2, max: 3, step: 0.05, when: ['radial'], hint: '>1 packs toward the rim, <1 toward the centre' },
  { key: 'radius', label: 'Min spacing', min: 0.01, max: 0.25, step: 0.005, when: ['poisson'], hint: 'As a fraction of the shorter edge' },
  { key: 'noiseScale', label: 'Noise scale', min: 0.3, max: 12, step: 0.1, when: ['noiseMask'] },
  { key: 'noiseThreshold', label: 'Noise threshold', min: 0, max: 1, step: 0.01, when: ['noiseMask'] },
  { key: 'noiseContrast', label: 'Noise contrast', min: 0.3, max: 3, step: 0.05, when: ['noiseMask'] },
]

export const SHAPE_FIELDS: DistField[] = [
  { key: 'sizePower', label: 'Size curve', min: 0.1, max: 4, step: 0.05, hint: 'Power curve applied to the size ramp' },
  { key: 'sizeMin', label: 'Size min', min: 0, max: 1, step: 0.01 },
  { key: 'sizeMax', label: 'Size max', min: 0.01, max: 1, step: 0.01 },
  { key: 'opacityFalloff', label: 'Opacity falloff', min: 0, max: 1, step: 0.01, hint: 'Fade with depth and distance' },
  { key: 'edgeFalloff', label: 'Edge density falloff', min: 0, max: 1, step: 0.01, hint: 'Fewer primitives near the border' },
  { key: 'depth', label: 'Depth spread', min: 0, max: 1, step: 0.01, hint: 'Drives size & blur variation' },
]
