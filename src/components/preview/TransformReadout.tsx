/**
 * preview/TransformReadout.tsx — the W × H / angle panel beside the box.
 *
 * Shown only while a gesture is running, because that is the only time the
 * numbers are otherwise invisible: the artwork moves, but nothing says by how
 * much. Reads the same live transform the overlay draws from, so it cannot show
 * a value the box is not using.
 */

import { useRenderStore } from '@/store/renderStore'
import { layerLocalBounds } from '@/lib/select'
import { useUiStore } from '@/store/uiStore'
import { useProjectStore } from '@/store/projectStore'

/** Below this, a value is noise from a rounding error, not a real dimension. */
const EPS = 0.01

export function TransformReadout() {
  const live = useUiStore((s) => s.liveTransform)
  const selectedLayerId = useProjectStore((s) => s.selectedLayerId)
  const results = useRenderStore((s) => s.results)
  if (!live || !selectedLayerId || !results) return null

  const local = layerLocalBounds(results, live.layerId)
  if (!local) return null
  const w = Math.abs((local.x1 - local.x0) * live.transform.scaleX)
  const h = Math.abs((local.y1 - local.y0) * live.transform.scaleY)
  const angle = Math.round(live.transform.rotation * 10) / 10
  const moved = Math.abs(live.transform.x) > EPS || Math.abs(live.transform.y) > EPS

  return (
    <div className="pointer-events-none absolute bottom-14 left-1/2 z-10 -translate-x-1/2 rounded-lg border bg-background/90 px-3 py-1.5 font-mono text-[11px] tabular-nums text-muted-foreground shadow backdrop-blur">
      {Math.round(w)} × {Math.round(h)}
      {Math.abs(angle) > EPS ? ` · ${angle}°` : ''}
      {moved ? ` · ${Math.round(live.transform.x)}, ${Math.round(live.transform.y)}` : ''}
    </div>
  )
}