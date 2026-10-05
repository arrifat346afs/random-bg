/**
 * preview/TransformOverlay.tsx — the interactive box over the selected layer.
 *
 * The box tracks the layer's **geometry**, transformed, and is deliberately not
 * clamped to the canvas: a layer dragged half off the edge still shows its box,
 * the way it does in a paint app. The stage does not clip this overlay.
 *
 * Handles are real hit targets — the SVG itself is `pointer-events-none` and only
 * the handles opt back in, so the box can never steal a click meant for the
 * artwork underneath. They are drawn at a constant **screen** size, so zooming
 * does not turn them into targets you cannot hit.
 *
 * Geometry comes from `layerLocalBounds` once, and the placement from
 * `liveTransform` while a gesture runs, so no frame re-measures 40k nodes.
 *
 * All handle positions are computed by `computeTransformBox` in `src/lib/transformBox.ts`
 * — the single source of truth for box geometry, used by both drawing and hit-testing.
 */

import { useMemo } from 'react'
import type { LayerResult } from '@/lib/pipeline'
import { layerLocalBounds } from '@/lib/select'
import { layerTransformOf, type Project } from '@/lib/schema'
import { cursorForHandle, HANDLE_IDS, ROTATE_CURSOR } from '@/lib/handles'
import { computeTransformBox, HANDLE_PX, isValidTransformBox } from '@/lib/transformBox'
import type { Point } from '@/lib/transform'
import { useUiStore } from '@/store/uiStore'
import { toScreen, type StageView } from './view'

export interface TransformOverlayProps {
  results: LayerResult[] | null
  project: Project
  view: StageView | null
  selectedLayerId: string | null
  /** locked or hidden layers get no handles */
  interactive: boolean
  onHandleDown: (e: React.PointerEvent, handle: string) => void
}

export function TransformOverlay({
  results,
  project,
  view,
  selectedLayerId,
  interactive,
  onHandleDown,
}: TransformOverlayProps) {
  const live = useUiStore((s) => s.liveTransform)
  const guides = useUiStore((s) => s.guides)
  const stageSize = useUiStore((s) => s.stageSize)

  const shape = useMemo(() => {
    if (!results || !selectedLayerId || !view) return null
    const layer = project.layers.find((l) => l.id === selectedLayerId)
    if (!layer) return null
    const local = layerLocalBounds(results, selectedLayerId)
    if (!local) return null
    // Mid-gesture the live placement wins; otherwise the committed one.
    const t = live && live.layerId === selectedLayerId ? live.transform : layerTransformOf(layer)
    const stage = stageSize.w > 0 && stageSize.h > 0 ? { width: stageSize.w, height: stageSize.h } : null
    const box = computeTransformBox(local, t, view, stage)
    if (!isValidTransformBox(box)) return null
    return box
  }, [results, project, selectedLayerId, live, view, stageSize])

  if (!shape || !view) return null

  const { corners, edgeMids, rotateStemEnd, angleDeg } = shape
  const path = `M ${corners.map((p) => `${round(p.x)} ${round(p.y)}`).join(' L ')} Z`

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ zIndex: 5 }}
      aria-hidden="true"
    >
      {guides.map((g, i) => (
        <line
          key={`${g.axis}${i}`}
          {...guideAttrs(g, view)}
          stroke="var(--color-primary)"
          strokeWidth={1}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path
        d={path}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth={1}
        strokeDasharray="5 4"
        vectorEffect="non-scaling-stroke"
      />

      {interactive && (
        <>
          {/* the stem out to the rotation grip */}
          <line
            x1={edgeMids.n.x}
            y1={edgeMids.n.y}
            x2={rotateStemEnd.x}
            y2={rotateStemEnd.y}
            stroke="var(--color-primary)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            className="pointer-events-auto cursor-grab"
            cx={rotateStemEnd.x}
            cy={rotateStemEnd.y}
            r={HANDLE_PX}
            fill="var(--color-primary)"
            stroke="var(--color-primary-foreground)"
            strokeWidth={1}
            style={{ cursor: ROTATE_CURSOR }}
            onPointerDown={(e) => onHandleDown(e, 'rotate')}
          />
          {HANDLE_IDS.map((id) => {
            const p = handlePosition(id, corners, edgeMids)
            return (
              <rect
                key={id}
                className="pointer-events-auto"
                x={p.x - HANDLE_PX / 2}
                y={p.y - HANDLE_PX / 2}
                width={HANDLE_PX}
                height={HANDLE_PX}
                fill="var(--color-primary)"
                stroke="var(--color-primary-foreground)"
                strokeWidth={1}
                style={{ cursor: cursorForHandle(id, angleDeg) }}
                onPointerDown={(e) => onHandleDown(e, id)}
              />
            )
          })}
        </>
      )}
    </svg>
  )
}

/** Get the screen-space position of a handle by ID. */
function handlePosition(
  id: string,
  corners: [Point, Point, Point, Point],
  edgeMids: { n: Point; e: Point; s: Point; w: Point },
): Point {
  switch (id) {
    case 'nw': return corners[0]
    case 'n': return edgeMids.n
    case 'ne': return corners[1]
    case 'e': return edgeMids.e
    case 'se': return corners[2]
    case 's': return edgeMids.s
    case 'sw': return corners[3]
    case 'w': return edgeMids.w
    default: return corners[0]
  }
}

const round = (v: number): number => Math.round(v * 100) / 100

/** Map a snap guide into screen space, ready for an SVG `<line>`. */
function guideAttrs(
  g: { axis: 'x' | 'y'; at: number; from: number; to: number },
  view: StageView,
): { x1: number; y1: number; x2: number; y2: number } {
  return g.axis === 'x'
    ? {
        x1: toScreen(view, g.at, g.from).x,
        y1: toScreen(view, g.at, g.from).y,
        x2: toScreen(view, g.at, g.to).x,
        y2: toScreen(view, g.at, g.to).y,
      }
    : {
        x1: toScreen(view, g.from, g.at).x,
        y1: toScreen(view, g.from, g.at).y,
        x2: toScreen(view, g.to, g.at).x,
        y2: toScreen(view, g.to, g.at).y,
      }
}
