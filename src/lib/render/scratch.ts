/**
 * render/scratch.ts — a depth-indexed pool of offscreen surfaces.
 *
 * Why a pool and not one shared canvas: `drawFilteredRun` owns the surface it
 * rasterises a whole layer onto, then calls `drawNodes` *into that surface*.
 * Any node inside that takes the `drawBlurredWide` or `drawBatch` fast path
 * needs a surface of its own — and with a single shared canvas it was handed
 * the one already in use. The inner call resized it (which clears it, destroying
 * every pixel drawn so far) and then blitted it onto itself. Measured in Chrome
 * with a blurred additive layer: 94 % of the layer silently disappeared, and the
 * surviving fragment was cut along the inner surface's rectangle.
 *
 * Indexing by call depth makes the hazard unrepresentable: a frame can only ever
 * hold the surface at its own depth, so a nested call is guaranteed a different
 * canvas. Every `acquire` must be paired with a `release` in a `finally`.
 *
 * Pure DOM only — no store, no React.
 */

/** A borrowed offscreen surface plus its 2D context. */
export interface Surface {
  c: HTMLCanvasElement
  x: CanvasRenderingContext2D | null
}

/**
 * Ceiling on a single surface, ~64 MB of RGBA. Past it the renderer must reduce
 * quality (a smaller downscale factor) or tile — never crop, and never silently
 * drop the layer's filters.
 */
export const SURFACE_PX_CEILING = 16_000_000

const pool: Surface[] = []
let depth = 0

/**
 * Borrow the surface for the current depth, sized `w × h` and ready to paint
 * into (contents are undefined — the caller clears).
 *
 * Returns null only when there is no canvas to give (headless) or the size is
 * degenerate. Size limits are the caller's problem, so that it can degrade
 * quality rather than lose the effect.
 */
export function acquireScratch(w: number, h: number): Surface | null {
  if (!(w > 0) || !(h > 0)) return null
  if (typeof document === 'undefined') return null
  depth++
  const slot = depth - 1
  let s = pool[slot]
  if (!s) {
    s = { c: document.createElement('canvas'), x: null }
    pool[slot] = s
  }
  if (s.c.width !== w || s.c.height !== h) {
    // resizing a canvas clears it and invalidates its context state
    s.c.width = w
    s.c.height = h
    s.x = null
  }
  if (!s.x) s.x = s.c.getContext('2d')
  return s.x ? s : null
}

/**
 * Return a surface borrowed at the current depth.
 *
 * The surface itself is not identified — depth is what matters, so an unbalanced
 * call (a throw inside a renderer) cannot wedge every later frame onto the
 * wrong surface. The pool clamps at 0 rather than going negative.
 */
export function releaseScratch(surface?: Surface | null): void {
  void surface
  if (depth > 0) depth--
}

/** Current nesting depth — exported so the regression gate can assert on it. */
export function scratchDepth(): number {
  return depth
}

/** Drop every pooled surface. Called after large one-shot renders. */
export function releaseAllScratches(): void {
  for (const s of pool) {
    s.c.width = 0
    s.c.height = 0
    s.x = null
  }
  pool.length = 0
  depth = 0
}

/**
 * The largest downscale factor ≤ `k` that keeps a `w × h` surface under the
 * memory ceiling. Returns `k` unchanged when it already fits.
 *
 * This is how the renderer honours "reduce quality instead of cropping": a blur
 * that wants a huge scratch gets a smaller one rather than a cropped one.
 */
export function fitDownscale(w: number, h: number, k: number, ceiling = SURFACE_PX_CEILING): number {
  const area = Math.max(1, w * h)
  const limit = Math.sqrt(ceiling / area)
  return limit >= k ? k : Math.max(0.0625, limit)
}