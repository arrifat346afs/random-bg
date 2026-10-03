/**
 * tile-mosaic/generate.ts — Turn params into IR nodes.
 *
 * A grid of square cells; each cell splits into 2 or 4 triangles filled
 * with palette colours (plus shade ladder). Colour symmetry folds the source
 * cell; geometry stays a full grid. One node per triangle, solid fills — the
 * SVG export matches the canvas exactly. Pure, no DOM.
 */

import type { GenContext, Params } from '../../schema'
import { solid, type Node } from '../../ir'
import { done, int, num, str } from '../kit'
import { alphaForLoad } from '../density'
import { isSplitKind, splitCell, type SplitKind } from './cells'
import { isMosaicMapping, mosaicColor, type MosaicMapping } from './palette'
import { isSymmetryKind, sourceCell, type SymmetryKind } from './symmetry'

/** Overlap guard budget: mosaic is opaque, barely needs dimming. */
const MOSAIC_LOAD_BUDGET = 4000

/** Clamp grid axes so the node count stays under the layer cap. */
const GRID_MIN = 2
const GRID_MAX = 40

export function generateMosaic(p: Params, ctx: GenContext): ReturnType<typeof done> {
  const cols: number = Math.max(GRID_MIN, Math.min(GRID_MAX, int(p, 'cols', 12)))
  const rows: number = Math.max(GRID_MIN, Math.min(GRID_MAX, int(p, 'rows', 12)))
  const rawSplit: string = str(p, 'split', 'mixed')
  const split: SplitKind = isSplitKind(rawSplit) ? rawSplit : 'mixed'
  const spin: number = num(p, 'spin', 0.7)
  const rawSym: string = str(p, 'symmetry', 'none')
  const symmetry: SymmetryKind = isSymmetryKind(rawSym) ? rawSym : 'none'
  const rawMap: string = str(p, 'mapping', 'random')
  const mapping: MosaicMapping = isMosaicMapping(rawMap) ? rawMap : 'random'
  const axis: number = num(p, 'axis', 45)
  const shade: number = num(p, 'shade', 0.55)
  const gap: number = num(p, 'gap', 1.5)
  const alpha: number = num(p, 'alpha', 1)

  const cw: number = ctx.w / cols
  const ch: number = ctx.h / rows
  const guarded: number = alphaForLoad(alpha, cols * rows * 3, MOSAIC_LOAD_BUDGET)
  const colors: string[] = ctx.color.palette.colors.length ? ctx.color.palette.colors : ['#ffffff']
  const nodes: Node[] = []
  const cellRng = ctx.rng.fork('cells')

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [sc, sr] = sourceCell(c, r, cols, rows, symmetry)
      // split choice: mixed flips by `spin`, fixed modes stay put
      let kind: SplitKind = split
      if (split === 'mixed') kind = cellRng.next() < 0.5 + (spin - 0.5) * 0.4 ? 'diagA' : 'diagB'
      if (split === 'quad' && spin > 0.02) {
        // keep quad but jitter the centre so it does not look stamped
      }
      const useQuad: boolean = split === 'quad' || (split === 'mixed' && cellRng.next() < spin * 0.18)
      const actual: SplitKind = useQuad ? 'quad' : kind
      const jx: number = actual === 'quad' ? cellRng.normal(0, cw * 0.08 * spin) : 0
      const jy: number = actual === 'quad' ? cellRng.normal(0, ch * 0.08 * spin) : 0
      const tris = splitCell(c * cw, r * ch, cw, ch, actual, gap, jx, jy)
      for (let t = 0; t < tris.length; t++) {
        const tri = tris[t]
        const cx: number = (tri[0] + tri[2] + tri[4]) / 3
        const cy: number = (tri[1] + tri[3] + tri[5]) / 3
        // mosaic owns its colour mapping via the `mapping` param; the layer
        // palette still flows through ctx.color.palette
        const fill: string = mosaicColor(cellRng, ctx.seed, colors, cx, cy, ctx.w, ctx.h, mapping, axis, sc + sr + t, shade)
        nodes.push({
          g: { k: 'poly', pts: [tri[0], tri[1], tri[2], tri[3], tri[4], tri[5]] },
          fill: solid(fill),
          op: guarded,
        })
      }
    }
  }
  return done(ctx.w, ctx.h, nodes)
}
