/**
 * network/edges.ts — Link nearby nodes into a calm plexus.
 *
 * A spatial hash grid keeps neighbour search O(n). Four connection modes:
 * k-nearest, radius, Gabriel (empty diametral circle ≈ Delaunay minus long
 * hops) and MST plus extras. Degree + length caps keep the composition calm —
 * never uniform spaghetti. Deterministic: ties break by node index.
 */

import { MAX_EDGES } from './params'

export interface Edge {
  a: number
  b: number
  len: number
}

/** Hash-grid neighbour lookup over projected points. */
function buildGrid(xs: Float64Array, ys: Float64Array, cell: number): Map<string, number[]> {
  const grid = new Map<string, number[]>()
  for (let i = 0; i < xs.length; i++) {
    const k = `${Math.floor(xs[i] / cell)},${Math.floor(ys[i] / cell)}`
    const arr = grid.get(k)
    if (arr) arr.push(i)
    else grid.set(k, [i])
  }
  return grid
}

function near(
  grid: Map<string, number[]>, xs: Float64Array, ys: Float64Array,
  i: number, cell: number, maxLen: number,
): { j: number; d: number }[] {
  const gx = Math.floor(xs[i] / cell)
  const gy = Math.floor(ys[i] / cell)
  const out: { j: number; d: number }[] = []
  for (let ax = gx - 1; ax <= gx + 1; ax++) {
    for (let ay = gy - 1; ay <= gy + 1; ay++) {
      const arr = grid.get(`${ax},${ay}`)
      if (!arr) continue
      for (const j of arr) {
        if (j === i) continue
        const d = Math.hypot(xs[i] - xs[j], ys[i] - ys[j])
        if (d <= maxLen && d > 1e-6) out.push({ j, d })
      }
    }
  }
  // deterministic order: distance, then index
  out.sort((p, q) => (p.d - q.d) || (p.j - q.j))
  return out
}

/** Link nodes; returns at most MAX_EDGES edges. */
export function buildEdges(
  xs: Float64Array,
  ys: Float64Array,
  mode: string,
  maxDegree: number,
  maxLen: number,
): Edge[] {
  const n = xs.length
  if (n < 2) return []
  const deg = Math.max(1, Math.min(8, Math.round(maxDegree)))
  const cell = Math.max(8, maxLen / 2)
  const grid = buildGrid(xs, ys, cell)
  const seen = new Set<number>()
  const edges: Edge[] = []
  const push = (a: number, b: number, len: number): void => {
    const x = Math.min(a, b)
    const y = Math.max(a, b)
    const key = x * n + y
    if (seen.has(key)) return
    seen.add(key)
    if (edges.length < MAX_EDGES) edges.push({ a: x, b: y, len })
  }

  if (mode === 'mst') {
    // Prim's over grid-limited neighbourhoods, then extras for lonely nodes
    const inTree = new Uint8Array(n)
    const best = new Float64Array(n).fill(Infinity)
    const parent = new Int32Array(n).fill(-1)
    inTree[0] = 1
    for (const c of near(grid, xs, ys, 0, cell, maxLen)) {
      if (c.d < best[c.j]) { best[c.j] = c.d; parent[c.j] = 0 }
    }
    for (let k = 1; k < n; k++) {
      let m = -1
      let md = Infinity
      for (let i = 0; i < n; i++) {
        if (!inTree[i] && (best[i] < md || (best[i] === md && i < m))) { md = best[i]; m = i }
      }
      if (m < 0 || md === Infinity) break
      inTree[m] = 1
      if (parent[m] >= 0) push(parent[m], m, md)
      for (const c of near(grid, xs, ys, m, cell, maxLen)) {
        if (!inTree[c.j] && c.d < best[c.j]) { best[c.j] = c.d; parent[c.j] = m }
      }
    }
    const degree = new Uint8Array(n)
    for (const e of edges) { degree[e.a]++; degree[e.b]++ }
    for (let i = 0; i < n && edges.length < MAX_EDGES; i++) {
      if (degree[i] >= 2) continue
      for (const c of near(grid, xs, ys, i, cell, maxLen)) {
        if (degree[i] >= deg || degree[c.j] >= deg) continue
        push(i, c.j, c.d)
        degree[i]++
        degree[c.j]++
        if (degree[i] >= 2) break
      }
    }
    return edges
  }

  if (mode === 'gabriel') {
    for (let i = 0; i < n; i++) {
      const cands = near(grid, xs, ys, i, cell, maxLen).slice(0, deg * 3)
      let kept = 0
      for (const c of cands) {
        if (kept >= deg) break
        const mx = (xs[i] + xs[c.j]) / 2
        const my = (ys[i] + ys[c.j]) / 2
        const rr = c.d / 2
        let empty = true
        for (const o of near(grid, xs, ys, i, cell, maxLen)) {
          if (o.j === i || o.j === c.j) continue
          if (Math.hypot(xs[o.j] - mx, ys[o.j] - my) < rr * 0.98) { empty = false; break }
        }
        if (empty) { push(i, c.j, c.d); kept++ }
      }
    }
    return edges
  }

  // knn + radius share the candidate walk; radius keeps everything ≤ maxLen
  const degree = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const cands = near(grid, xs, ys, i, cell, maxLen)
    const take = mode === 'radius' ? cands.length : Math.min(deg, cands.length)
    for (let k = 0; k < take && edges.length < MAX_EDGES; k++) {
      const c = cands[k]
      if (degree[i] >= deg || degree[c.j] >= deg) continue
      push(i, c.j, c.d)
      degree[i]++
      degree[c.j]++
    }
  }
  return edges
}
