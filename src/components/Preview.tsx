import { useCallback, useEffect, useMemo } from 'react'
import { type IR } from '@/lib/ir'
import { drawBackground, drawIR } from '@/lib/render/canvas'
import { composeIR } from '@/lib/pipeline'
import { projectFilterOpts } from '@/lib/filters/attach'
import { hitTestLayers, layerBoundsFor } from '@/lib/select'
import { layerOffset } from '@/lib/schema'
import { isTyping, isSpaceHeld, setSpaceHeld } from '@/lib/keyboard'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Maximize2, Minus, Plus, Layers } from 'lucide-react'
import { useProjectStore } from '@/store/projectStore'
import { useRenderStore } from '@/store/renderStore'
import { useUiStore } from '@/store/uiStore'

const MIN_ZOOM = 0.05
const MAX_ZOOM = 8

/**
 * The stage keeps one raster of the whole canvas and blits it while the user
 * pans or zooms, instead of replaying thousands of primitives per pointer
 * move. Rebuilds happen only when the *content* changes, or (debounced) when
 * the zoom settles at a resolution worth re-rasterising.
 */
const MAX_RASTER_PIXELS = 12_000_000
const MAX_RASTER_EDGE = 6144
/** rebuild only when the raster resolution drifts more than this (5 %) */
const RASTER_TOLERANCE = 0.05
/** how long after the last zoom before we re-raster at full sharpness */
const RASTER_REFINE_MS = 180

export function Preview() {
  const ui = () => useUiStore.getState()
  // Element handles live in the store but are read fresh at each use site via
  // getState(). Capturing them into a local ref object at render time would
  // snapshot a stale value, since the store is filled by the ref callbacks after
  // this render.
  /**
   * The stage element, read fresh on each use.
   *
   * This cannot be a `useRef` snapshot taken during render: the ref callback
   * populates the store *after* this render, so a captured handle would still be
   * null when the wheel handler first runs. Reading on use gets the live value.
   */
  const stageEl = () => useUiStore.getState().stageRef
  const canvasEl = () => useUiStore.getState().canvasRef

  /**
   * Stable ref callbacks.
   *
   * These must NOT be inline arrows. React re-invokes a ref callback whenever
   * its identity changes — old one with `null`, new one with the element — so an
   * inline callback writes on every render, and a write that notifies sends React
   * straight back for another one. That is an infinite render loop, which React
   * eventually reports as "Maximum update depth exceeded". `useCallback` with an
   * empty dep list gives them a fixed identity for the component's lifetime.
   */
  const attachStage = useCallback((el: HTMLDivElement | null) => {
    useUiStore.getState().setRefs({ stageRef: el })
  }, [])
  const attachCanvas = useCallback((el: HTMLCanvasElement | null) => {
    useUiStore.getState().setRefs({ canvasRef: el })
  }, [])
  // Stage size comes from the ResizeObserver; the stage element handle itself is
  // in the store but read via getState() so nothing subscribes to a DOM node.
  const size = useUiStore((s) => s.stageSize)

  const zoom = useUiStore((s) => s.view.zoom)
  const panX = useUiStore((s) => s.view.panX)
  const panY = useUiStore((s) => s.view.panY)
  const checker = useUiStore((s) => s.view.checker)
  const resultsVersion = useRenderStore((s) => s.resultsVersion)
  const results = useRenderStore((s) => s.results)
  const generating = useRenderStore((s) => s.generating)
  const progress = useRenderStore((s) => s.progress)
  const primitiveCount = useRenderStore((s) => s.primitiveCount)
  const truncated = useRenderStore((s) => s.truncated)
  const renderMs = useRenderStore((s) => s.renderMs)
  const error = useRenderStore((s) => s.error)
  const canvas = useProjectStore((s) => s.project.canvas)
  const project = useProjectStore((s) => s.project)
  const layerCount = useProjectStore((s) => s.project.layers.length)
  const selectedLayerId = useProjectStore((s) => s.selectedLayerId)

  const ir: IR | null = useMemo(() => {
    if (!results) return null
    // composeIR (not a hand-rolled flatMap) so manual layer placement lands in
    // the preview through the same path the exporters use. `project` is a real
    // dependency, not a `getState()` peek: dragging mutates the layer offsets
    // without touching `results`, so keying this on results alone would leave the
    // artwork visually pinned while the numbers moved underneath.
    return composeIR(project, results)
  }, [results, project])

  /**
   * Per-layer filter stacks, rebuilt from the project. Derived (not stored) so
   * editing a filter never touches the render store — only the raster refresh
   * below, while generation stays cached and instant.
   */
  const filterOpts = useMemo(() => projectFilterOpts(project), [project])

  /* observe container size */
  useEffect(() => {
    const el = stageEl()
    if (!el) return
    const ro = new ResizeObserver(() => {
      ui().setStageSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    useUiStore.getState().setStageSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  /**
   * Stage transform, shared by the raster blit and the selection overlay so the
   * box can never drift from the pixels it is drawn over.
   */
  const view = useMemo(() => {
    if (!ir || !size.w || !size.h) return null
    const fit = Math.min(size.w / ir.w, size.h / ir.h) * 0.93
    const scale = fit * zoom
    return {
      scale,
      ox: (size.w - ir.w * scale) / 2 + panX,
      oy: (size.h - ir.h * scale) / 2 + panY,
    }
  }, [ir, zoom, panX, panY, size.w, size.h])

  /* ---- raster cache + draw ---------------------------------------------- */

  const refine = useUiStore((s) => s.refineTick)

  useEffect(() => {
    const cvs = canvasEl()
    if (!cvs || !size.w || !size.h) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const pw = Math.round(size.w * dpr)
    const ph = Math.round(size.h * dpr)
    if (cvs.width !== pw) cvs.width = pw
    if (cvs.height !== ph) cvs.height = ph
    const ctx = cvs.getContext('2d')
    if (!ctx) return

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, pw, ph)
    if (!ir || !view) return

    const { scale, ox, oy } = view
    // one device-pixel grid shared by the background and the blit
    const dx = Math.round(ox * dpr)
    const dy = Math.round(oy * dpr)
    const dw = Math.max(1, Math.round(ir.w * scale * dpr))
    const dh = Math.max(1, Math.round(ir.h * scale * dpr))

    // background is a single fill, drawn every frame so panning never exposes
    // a gap around the artwork
    if (canvas.bg.kind !== 'transparent') {
      ctx.save()
      ctx.setTransform(dw / ir.w, 0, 0, dh / ir.h, dx, dy)
      drawBackground(ctx, ir.w, ir.h, canvas.bg)
      ctx.restore()
    }

    const contentKey = `${resultsVersion}|${ir.w}x${ir.h}`
    // Read through getState(): these hold DOM nodes and cache metadata, and
    // selecting them would re-render the stage on every cache write.
    const meta = ui().rasterMeta
    const cached = ui().rasterCanvas
    const contentStale = !meta || !cached || meta.key !== contentKey || meta.ir !== ir

    // resolution the raster *should* have for this zoom (capped for memory)
    let unit = scale * dpr
    unit = Math.min(
      unit,
      Math.sqrt(MAX_RASTER_PIXELS / Math.max(1, ir.w * ir.h)),
      MAX_RASTER_EDGE / Math.max(1, ir.w, ir.h),
    )
    const unitStale =
      meta !== null && !contentStale && Math.abs(meta.unit - unit) > unit * RASTER_TOLERANCE

    if (contentStale) {
      let r = cached
      if (!r) {
        r = document.createElement('canvas')
        ui().setRefs({ rasterCanvas: r })
      }
      const w = Math.max(1, Math.round(ir.w * unit))
      const h = Math.max(1, Math.round(ir.h * unit))
      if (r.width !== w) r.width = w
      if (r.height !== h) r.height = h
      const rc = r.getContext('2d')
      if (rc) {
        rc.setTransform(1, 0, 0, 1, 0, 0)
        rc.clearRect(0, 0, w, h)
        rc.setTransform(unit, 0, 0, unit, 0, 0)
        drawIR(rc, ir, 1, undefined, filterOpts)
        ui().setRasterMeta({ key: contentKey, unit, ir })
      }
    } else if (unitStale) {
      // zoom moved on: show the existing raster stretched (free) and sharpen
      // it once the user stops
      if (ui().refineTimer) clearTimeout(ui().refineTimer as number)
      ui().setRefineTimer(
        window.setTimeout(() => {
          ui().setRefineTimer(null)
          ui().bumpRefine()
        }, RASTER_REFINE_MS),
      )
    }

    const r = ui().rasterCanvas
    if (r && r.width) ctx.drawImage(r, dx, dy, dw, dh)
  }, [ir, view, resultsVersion, size.w, size.h, canvas.bg, canvas.w, canvas.h, refine, filterOpts])

  // clear the pending sharpen on unmount only — each draw re-arms its own
  useEffect(
    () => () => {
      const t = useUiStore.getState().refineTimer
      if (t) clearTimeout(t)
    },
    [],
  )

  /* ---- interaction ------------------------------------------------------ */

  const applyView = useCallback((patch: Partial<{ zoom: number; panX: number; panY: number }>) => {
    const current = useUiStore.getState().view.zoom
    const zoom2 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, patch.zoom ?? current))
    useUiStore.getState().patchView({ ...patch, zoom: zoom2 })
  }, [])

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const s = useUiStore.getState().view
      const rect = stageEl()?.getBoundingClientRect()
      if (!rect) return
      const mx = e.clientX - rect.left - rect.width / 2
      const my = e.clientY - rect.top - rect.height / 2
      const factor = Math.exp(-e.deltaY * 0.0016)
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s.zoom * factor))
      const k = nextZoom / s.zoom
      applyView({
        zoom: nextZoom,
        panX: mx - (mx - s.panX) * k,
        panY: my - (my - s.panY) * k,
      })
    },
    [applyView],
  )

  /** Screen (client) point → IR units. Null when the stage has no transform yet. */
  const toIR = useCallback(
    (clientX: number, clientY: number) => {
      if (!view) return null
      const rect = stageEl()?.getBoundingClientRect()
      if (!rect) return null
      return {
        x: (clientX - rect.left - view.ox) / view.scale,
        y: (clientY - rect.top - view.oy) / view.scale,
      }
    },
    [view],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const space = isSpaceHeld()
      const middle = e.button === 1
      const s = useProjectStore.getState()
      const v = useUiStore.getState().view
      if (!space && !middle) {
        // Plain left-press on the artwork selects the topmost layer under the
        // cursor and starts a move; empty stage still deselects.
        if (e.target !== canvasEl()) return
        const p = toIR(e.clientX, e.clientY)
        const rs = useRenderStore.getState().results
        const hit = p && rs ? hitTestLayers(rs, s.project, p.x, p.y) : null
        useProjectStore.getState().selectLayer(hit)
        const layer = hit ? s.project.layers.find((l) => l.id === hit) : undefined
        if (!hit || !layer || layer.locked || !p || !view) return
        const { x, y } = layerOffset(layer)
        ui().setStageDrag({
          id: e.pointerId,
          mode: 'move',
          x: e.clientX,
          y: e.clientY,
          px: v.panX,
          py: v.panY,
          ox: x,
          oy: y,
          moved: false,
        })
        try {
          ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        } catch {
          /* pointer already gone — the drag still works without capture */
        }
        return
      }
      e.preventDefault()
      ui().setStageDrag({
        id: e.pointerId,
        mode: 'pan',
        x: e.clientX,
        y: e.clientY,
        px: v.panX,
        py: v.panY,
        ox: 0,
        oy: 0,
        moved: false,
      })
      // capture keeps pointermove flowing when the cursor leaves the stage; it
      // throws if the pointer is already gone (coalesced pointercancel), which
      // must never break the interaction
      try {
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      } catch {
        /* synthetic or retired pointer — drag still works without capture */
      }
    },
    [toIR, view],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = ui().stageDrag
      if (!d || d.id !== e.pointerId) return
      if (d.mode === 'pan') {
        applyView({ panX: d.px + (e.clientX - d.x), panY: d.py + (e.clientY - d.y) })
        return
      }
      if (!view) return
      // Screen px → IR units. view.scale is the single source of truth, so the
      // layer tracks the cursor exactly at any zoom.
      const dx = (e.clientX - d.x) / view.scale
      const dy = (e.clientY - d.y) / view.scale
      if (!d.moved && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
      ui().setStageDrag({ ...d, moved: true })
      const id = selectedLayerId
      if (!id) return
      // transient during the gesture; one coalesced commit lands on release
      useProjectStore.getState().patchProject((p) => ({
        ...p,
        layers: p.layers.map((l) =>
          l.id === id ? { ...l, offset: { x: d.ox + dx, y: d.oy + dy } } : l,
        ),
      }))
    },
    [applyView, view, selectedLayerId],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = ui().stageDrag
      if (d?.id !== e.pointerId) return
      // Collapse the whole gesture into a single undo entry, before clearing the
      // drag so `d` is still the gesture that ran.
      if (d.mode === 'move' && d.moved && selectedLayerId) {
        useProjectStore
          .getState()
          .commit(useProjectStore.getState().project, {
            coalesce: `move:${selectedLayerId}`,
          })
      }
      ui().setStageDrag(null)
    },
    [selectedLayerId],
  )

  const fit = useCallback(() => {
    useUiStore.getState().patchView({ zoom: 1, panX: 0, panY: 0 })
  }, [])

  const zoomBy = useCallback(
    (k: number) => applyView({ zoom: useUiStore.getState().view.zoom * k }),
    [applyView],
  )

  /* space-to-pan: the held flag is module-level so keydown works anywhere, and
     the store copy is what drives the grab cursor. */
  const spaceHeld = useUiStore((s) => s.spaceHeld)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        if (!isSpaceHeld()) {
          setSpaceHeld(true)
          useUiStore.getState().patchSpaceHeld(true)
        }
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpaceHeld(false)
        useUiStore.getState().patchSpaceHeld(false)
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const pct = Math.round(zoom * 100)
  const showProgress = generating && progress && progress.total > 1

  /* selection box: geometry extent of the selected layer, in IR units. `results`
     is a fresh array on every completed render, so its identity is the signal. */
  const box = useMemo(
    () => (results && selectedLayerId ? layerBoundsFor(results, project, selectedLayerId) : null),
    [results, project, selectedLayerId],
  )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-stage">
      <div
        ref={attachStage}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`relative min-h-0 flex-1 overflow-hidden ${checker ? 'checkerboard' : ''} ${
          spaceHeld ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
        }`}
        style={{ touchAction: 'none' }}
      >
        <canvas ref={attachCanvas} className="absolute inset-0 h-full w-full" />

        {/* Selection box. Drawn in the same transform as the raster blit, so it
            tracks zoom and pan exactly. Geometry extent only — a glow's visible
            halo spills outside it, which is honest about what the layer *is*. */}
        {box && view && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{ zIndex: 5 }}
            aria-hidden="true"
          >
            <rect
              x={view.ox + box.x0 * view.scale}
              y={view.oy + box.y0 * view.scale}
              width={Math.max(0, (box.x1 - box.x0) * view.scale)}
              height={Math.max(0, (box.y1 - box.y0) * view.scale)}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth={1}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
            {([[0, 0], [1, 0], [1, 1], [0, 1]] as const).map(([fx, fy]) => (
              <rect
                key={`${fx}-${fy}`}
                x={view.ox + (box.x0 + (box.x1 - box.x0) * fx) * view.scale - 3}
                y={view.oy + (box.y0 + (box.y1 - box.y0) * fy) * view.scale - 3}
                width={6}
                height={6}
                fill="var(--color-primary)"
                stroke="var(--color-primary-foreground)"
                strokeWidth={1}
              />
            ))}
          </svg>
        )}

        {layerCount === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
            <div className="pointer-events-auto max-w-sm rounded-xl border border-dashed bg-background/85 p-6 backdrop-blur">
              <Layers className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <h3 className="mb-1 text-sm font-semibold">No layers yet</h3>
              <p className="mb-4 text-xs text-muted-foreground">
                Add a generator layer on the left, or press{' '}
                <kbd className="rounded border bg-muted px-1 py-0.5 text-[10px]">R</kbd> to
                randomise a whole project.
              </p>
              <div className="pointer-events-auto flex justify-center gap-2">
                <Button size="sm" onClick={() => useUiStore.getState().setSheet('left', true)}>
                  Add layer
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('fx:randomize'))
                  }}
                >
                  Randomise
                </Button>
              </div>
            </div>
          </div>
        )}

        {showProgress && (
          <div className="absolute inset-x-0 bottom-0 z-10 bg-background/80 px-4 py-2 backdrop-blur">
            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                Generating <span className="text-foreground">{progress.label}</span>…
              </span>
              <span>
                {progress.done}/{progress.total}
              </span>
            </div>
            <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
          </div>
        )}

        {error && (
          <div className="absolute inset-x-3 top-3 z-10 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive backdrop-blur">
            <strong className="font-semibold">Render error:</strong> {error}
          </div>
        )}

        {/* floating controls */}
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-lg border bg-background/90 p-1 shadow backdrop-blur">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
                <Minus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom out (−)</TooltipContent>
          </Tooltip>
          <button
            className="min-w-[3.2rem] rounded px-1 text-[11px] tabular-nums text-muted-foreground hover:text-foreground"
            onClick={fit}
            title="Fit to view (0)"
          >
            {pct}%
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom in (+)</TooltipContent>
          </Tooltip>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" onClick={fit} aria-label="Fit to view">
                <Maximize2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fit to view (0)</TooltipContent>
          </Tooltip>
        </div>

        {/* Keep clear of the floating zoom controls in the bottom-right. */}
        <div className="absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-11rem)] flex-wrap items-center gap-2">
          <Badge variant="muted" className="bg-background/85 backdrop-blur">
            {canvas.w}×{canvas.h}
          </Badge>
          <Badge variant="muted" className="bg-background/85 backdrop-blur">
            {primitiveCount.toLocaleString()} primitives
          </Badge>
          {truncated && (
            <Badge variant="warning" className="bg-background/85 backdrop-blur">
              capped at 40k
            </Badge>
          )}
          {!generating && (
            <Badge
              variant="muted"
              className="hidden bg-background/85 backdrop-blur tabular-nums sm:inline-flex"
            >
              {renderMs.toFixed(1)} ms
            </Badge>
          )}
        </div>
      </div>
    </div>
  )
}
