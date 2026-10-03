/**
 * tile-mosaic/symmetry.ts — Colour-source symmetry for the mosaic grid.
 *
 * Geometry stays a full grid (stable node counts); symmetry folds the cell
 * coordinate used for colour picking, so the pattern reads as mirrored.
 * Pure math, no DOM.
 */

/** Symmetry families. */
export type SymmetryKind = 'none' | 'mirrorX' | 'mirrorY' | 'fourWay' | 'kaleido'

/** True for every valid symmetry id. */
export function isSymmetryKind(v: string): v is SymmetryKind {
  return v === 'none' || v === 'mirrorX' || v === 'mirrorY' || v === 'fourWay' || v === 'kaleido'
}

/**
 * Fold (c, r) into its colour-source cell.
 */
export function sourceCell(c: number, r: number, cols: number, rows: number, kind: SymmetryKind): [number, number] {
  const mx: number = cols - 1 - c
  const my: number = rows - 1 - r
  switch (kind) {
    case 'mirrorX':
      return [Math.min(c, mx), r]
    case 'mirrorY':
      return [c, Math.min(r, my)]
    case 'fourWay':
      return [Math.min(c, mx), Math.min(r, my)]
    case 'kaleido': {
      // fold to a quarter, then fold across the diagonal for an 8-way feel
      const qx: number = Math.min(c, mx)
      const qy: number = Math.min(r, my)
      return qx <= qy ? [qx, qy] : [qy, qx]
    }
    case 'none':
    default:
      return [c, r]
  }
}
