/**
 * gradient-shapes/index.ts — Registry entry for the gradient shapes generator.
 *
 * Only re-exports the `GeneratorDef`; logic lives in `generate.ts`.
 */

import type { GeneratorDef, Params } from '../../schema'
import { num } from '../kit'
import { generateGradientShapes } from './generate'
import { GRADIENT_SHAPE_PARAMS, gradientShapeDefaults } from './params'

export const gradShapesGen: GeneratorDef = {
  id: 'gradShapes',
  name: 'Gradient shapes',
  icon: 'shapes',
  family: 'geometry',
  tags: ['gradient', 'shapes', 'circles', 'spheres', 'columns', 'minimal'],
  description: 'Circles, discs, rects and rings with palette gradients.',
  params: GRADIENT_SHAPE_PARAMS,
  defaults: (): Params => ({ ...gradientShapeDefaults() }),
  density: (p: Params): number => num(p, 'count', 18) * 1.2,
  generate: generateGradientShapes,
}
