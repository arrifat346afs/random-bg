/**
 * tile-mosaic/cells.ts — Split grid cells into triangles.
 *
 * Each cell splits into 2 triangles (either diagonal) or 4 (both diagonals
 * through a centre point). Vertices are inset toward the triangle centroid
 * by `gap`, which reads as grout without extra stroke nodes.
 */

/** Split families. */
export type SplitKind = 'diagA' | 'diagB' | 'quad' | 'mixed'

/** True for every valid split id. */
export function isSplitKind(v: string): v is SplitKind {
  return v === 'diagA' || v === 'diagB' || v === 'quad' || v === 'mixed'
}

/** Triangle as three [x, y] corners. */
export type Triangle = [number, number, number, number, number, number]

/** Corners of a cell: TL, TR, BR, BL. */
function corners(x0: number, y0: number, cw: number, ch: number): number[] {
  return [x0, y0, x0 + cw, y0, x0 + cw, y0 + ch, x0, y0 + ch]
}

/** Inset a triangle toward its centroid by `gap` px (approx). */
function inset(tri: Triangle, gap: number): Triangle {
  if (!(gap > 0.05)) return tri
  const cx: number = (tri[0] + tri[2] + tri[4]) / 3
  const cy: number = (tri[1] + tri[3] + tri[5]) / 3
  const out: number[] = []
  for (let i = 0; i < 3; i++) {
    const x: number = tri[i * 2]
    const y: number = tri[i * 2 + 1]
    const dx: number = x - cx
    const dy: number = y - cy
    const len: number = Math.hypot(dx, dy) || 1
    const k: number = Math.max(0, len - gap * 0.7) / len
    out.push(cx + dx * k, cy + dy * k)
  }
  return [out[0], out[1], out[2], out[3], out[4], out[5]]
}

/**
 * Split one cell into triangles.
 */
export function splitCell(
  x0: number,
  y0: number,
  cw: number,
  ch: number,
  split: SplitKind,
  gap: number,
  centreJitterX = 0,
  centreJitterY = 0,
): Triangle[] {
  const [tlx, tly, trx, try_, brx, bry, blx, bly] = corners(x0, y0, cw, ch)
  if (split === 'quad') {
    const cx: number = x0 + cw / 2 + centreJitterX
    const cy: number = y0 + ch / 2 + centreJitterY
    const tris: Triangle[] = [
      [tlx, tly, trx, try_, cx, cy],
      [trx, try_, brx, bry, cx, cy],
      [brx, bry, blx, bly, cx, cy],
      [blx, bly, tlx, tly, cx, cy],
    ]
    return tris.map((t) => inset(t, gap))
  }
  // diagA: TL–BR diagonal; diagB: TR–BL diagonal
  const tris: Triangle[] =
    split === 'diagB'
      ? [
          [trx, try_, brx, bry, blx, bly],
          [trx, try_, blx, bly, tlx, tly],
        ]
      : [
          [tlx, tly, trx, try_, brx, bry],
          [tlx, tly, brx, bry, blx, bly],
        ]
  return tris.map((t) => inset(t, gap))
}
