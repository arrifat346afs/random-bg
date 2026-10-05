/**
 * snap.ts — snapping a dragged edge to the canvas edges and centre.
 *
 * Pure, and deliberately conservative: it reports which rule fired so the stage
 * can draw a guide, and it only ever *nudges* a value by less than the
 * tolerance. Snapping that jumps artwork across the canvas is worse than none.
 *
 * Off by default in the store; the option lives in `ViewState` so it persists
 * with the rest of the view settings.
 */

/** Canvas units a dragged edge may be pulled to a rule before it snaps. */
export const SNAP_TOLERANCE = 6

/** A rule the artwork can snap to. */
export interface SnapRule {
  axis: 'x' | 'y'
  /** the canvas coordinate of the rule */
  at: number
}

/** A rule that fired, plus the span it covers so it reads as a guide. */
export interface SnapGuide {
  axis: 'x' | 'y'
  at: number
  from: number
  to: number
}

/**
 * The rules for a canvas: both edges and the centre line on each axis.
 *
 * Edges are included because a layer dragged to the border should sit *on* it;
 * the centre because centring is the other thing a user reaches for.
 */
export function canvasRules(width: number, height: number): SnapRule[] {
  const out: SnapRule[] = []
  for (const at of [0, width / 2, width]) out.push({ axis: 'x', at })
  for (const at of [0, height / 2, height]) out.push({ axis: 'y', at })
  return out
}

export interface SnapResult {
  value: number
  /** the rule that fired, or null */
  rule: SnapRule | null
}

/**
 * Pull `value` onto the nearest rule within `tolerance`.
 *
 * Ties go to the rule nearest the value, and a tie between two rules goes to the
 * first, so the result is deterministic — a drag must never oscillate between
 * two equally close rules.
 */
export function snapValue(
  value: number,
  axis: 'x' | 'y',
  rules: readonly SnapRule[],
  tolerance: number = SNAP_TOLERANCE,
): SnapResult {
  let best: SnapRule | null = null
  let bestDist = Infinity
  for (const r of rules) {
    if (r.axis !== axis) continue
    const d = Math.abs(r.at - value)
    if (d <= tolerance && d < bestDist) {
      best = r
      bestDist = d
    }
  }
  return best ? { value: best.at, rule: best } : { value, rule: null }
}

/**
 * Snap a dragged box's edges and centre on both axes.
 *
 * `box` is the axis-aligned bounds of the transformed box, which is what the
 * user's eye is judging against even when the box is rotated. `width`/`height`
 * size the guides, which span the canvas so they read as canvas rules rather
 * than as marks that belong to the dragged layer.
 */
export function snapBox(
  box: { x0: number; y0: number; x1: number; y1: number },
  rules: readonly SnapRule[],
  width: number,
  height: number,
  tolerance: number = SNAP_TOLERANCE,
): { dx: number; dy: number; guides: SnapGuide[] } {
  // candidate anchors on each axis: the two edges and the centre
  const xs = [box.x0, (box.x0 + box.x1) / 2, box.x1]
  const ys = [box.y0, (box.y0 + box.y1) / 2, box.y1]
  const dx = bestSnap(xs, 'x', rules, tolerance)
  const dy = bestSnap(ys, 'y', rules, tolerance)
  const guides: SnapGuide[] = []
  if (dx.rule) guides.push({ axis: 'x', at: dx.rule.at, from: 0, to: height })
  if (dy.rule) guides.push({ axis: 'y', at: dy.rule.at, from: 0, to: width })
  return { dx: dx.shift, dy: dy.shift, guides }
}

function bestSnap(
  candidates: readonly number[],
  axis: 'x' | 'y',
  rules: readonly SnapRule[],
  tolerance: number,
): { shift: number; rule: SnapRule | null } {
  let bestRule: SnapRule | null = null
  let bestShift = 0
  let bestDist = Infinity
  for (const v of candidates) {
    const r = snapValue(v, axis, rules, tolerance)
    if (!r.rule) continue
    const shift = r.value - v
    const dist = Math.abs(shift)
    if (dist < bestDist) {
      bestDist = dist
      bestRule = r.rule
      bestShift = shift
    }
  }
  return { shift: bestRule ? bestShift : 0, rule: bestRule }
}