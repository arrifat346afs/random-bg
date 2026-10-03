/**
 * filters/cost.ts — Cost model for the filter stack.
 *
 * Reuses the existing budgets from `render/canvas.ts` rather than inventing
 * new ones: `FILTER_PX_BUDGET` (600M filtered pixels) bounds the worst case,
 * and wide blurs already degrade through the downscale path. Each filter
 * declares a small relative `cost`; the stack sums it into an estimated
 * megapixel weight the UI shows as a "heavy" badge.
 */

/** Mirror of `FILTER_PX_BUDGET` in `render/canvas.ts`. */
export const FILTER_PX_BUDGET = 600_000_000
/** Mirror of `MAX_FILTERED_OPS` in `render/canvas.ts`. */
export const MAX_FILTERED_OPS = 3500

/** Estimated cost weight of one stack (sum of enabled `cost`). */
export function stackCostWeight(filters: { enabled: boolean; type: string }[], costOf: (type: string) => number): number {
  let sum = 0
  for (const f of filters) {
    if (!f.enabled) continue
    sum += costOf(f.type)
  }
  return sum
}

/**
 * Estimated filtered megapixels for a layer of `pixels` with stack weight.
 * Cheap colour ops cost ~1× pixels, heavy distorts/blurs up to ~4×.
 */
export function estimateFilterMp(pixels: number, weight: number): number {
  return (pixels * (1 + weight * 0.35)) / 1_000_000
}

/** Above this weight the UI shows the "heavy" badge. */
export const HEAVY_STACK_WEIGHT = 14

/** Above this weight preview degrades to half resolution. */
export const DEGRADE_STACK_WEIGHT = 22

/** True when the stack should show the "heavy" badge. */
export function isHeavyStack(weight: number): boolean {
  return weight >= HEAVY_STACK_WEIGHT
}
