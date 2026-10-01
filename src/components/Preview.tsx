import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { buildIR, type IR } from '@/lib/ir'
import { drawBackground, drawIR } from '@/lib/render/canvas'
import { getState, saveView, selectLayer, setState } from '@/lib/state/store'
import { isTyping, isSpaceHeld, setSpaceHeld } from '@/lib/keyboard'
import { useStore } from '@/lib/state/useStore'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Maximize2, Minus, Plus, Layers } from 'lucide-react'

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
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  const zoom = useStore((s) => s.view.zoom)
  const panX = useStore((s) => s.view.panX)
  const panY = useStore((s) => s.view.panY)
  const checker = useStore((s) => s.view.checker)
  const resultsVersion = useStore((s) => s.resultsVersion)
  const results = useStore((s) => s.results)
  const generating = useStore((s) => s.generating)
  const progress = useStore((s) => s.progress)
  const primitiveCount = useStore((s) => s.primitiveCount)
  const truncated = useStore((s) => s.truncated)
  const renderMs = useStore((s) => s.renderMs)
  const error = useStore((s) => s.error)
  const canvas = useStore((s) => s.project.canvas)
  const layerCount = useStore((s) => s.project.layers.length)

  const ir: IR | null = useMemo(() => {
    if (!results) return null
    const nodes = results.flatMap((r) => r.ir.nodes)
    return buildIR(canvas.w, canvas.h, nodes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, resultsVersion, canvas.w, canvas.h])

  /* observe container size */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  /* ---- raster cache + draw ---------------------------------------------- */

  const rasterRef = useRef<HTMLCanvasElement | null>(null)
  const rasterMeta = useRef<{ key: string; unit: number; ir: IR } | null>(null)
  const refineTimer = useRef<number | null>(null)
  const [refine, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    const cvs = canvasRef.current
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
    if (!ir) return

    const fit = Math.min(size.w / ir.w, size.h / ir.h) * 0.93
    const scale = fit * zoom
    const ox = (size.w - ir.w * scale) / 2 + panX
    const oy = (size.h - ir.h * scale) / 2 + panY
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
    const meta = rasterMeta.current
    const contentStale =
      !meta || !rasterRef.current || meta.key !== contentKey || meta.ir !== ir

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
      let r = rasterRef.current
      if (!r) {
        r = document.createElement('canvas')
        rasterRef.current = r
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
        drawIR(rc, ir, 1)
        rasterMeta.current = { key: contentKey, unit, ir }
      }
    } else if (unitStale) {
      // zoom moved on: show the existing raster stretched (free) and sharpen
      // it once the user stops
      if (refineTimer.current) clearTimeout(refineTimer.current)
      refineTimer.current = window.setTimeout(() => {
        refineTimer.current = null
        bump()
      }, RASTER_REFINE_MS)
    }

    const r = rasterRef.current
    if (r && r.width) ctx.drawImage(r, dx, dy, dw, dh)
  }, [ir, resultsVersion, zoom, panX, panY, size.w, size.h, canvas.bg, canvas.w, canvas.h, refine])

  // clear the pending sharpen on unmount only — each draw re-arms its own
  useEffect(
    () => () => {
      if (refineTimer.current) clearTimeout(refineTimer.current)
    },
    [],
  )

  /* ---- interaction ------------------------------------------------------ */

  const applyView = useCallback((patch: Partial<{ zoom: number; panX: number; panY: number }>) => {
    const s = getState()
    const zoom2 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, patch.zoom ?? s.view.zoom))
    setState({ view: { ...s.view, ...patch, zoom: zoom2 } })
    saveView()
  }, [])

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const s = getState()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const mx = e.clientX - rect.left - rect.width / 2
      const my = e.clientY - rect.top - rect.height / 2
      const factor = Math.exp(-e.deltaY * 0.0016)
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s.view.zoom * factor))
      const k = nextZoom / s.view.zoom
      applyView({
        zoom: nextZoom,
        panX: mx - (mx - s.view.panX) * k,
        panY: my - (my - s.view.panY) * k,
      })
    },
    [applyView],
  )

  const dragRef = useRef<{ id: number; x: number; y: number; px: number; py: number } | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const space = isSpaceHeld()
    const middle = e.button === 1
    if (!space && !middle) {
      // clicking empty stage deselects
      if (e.target === canvasRef.current) selectLayer(null)
      return
    }
    e.preventDefault()
    const s = getState()
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, px: s.view.panX, py: s.view.panY }
    // capture keeps pointermove flowing when the cursor leaves the stage; it
    // throws if the pointer is already gone (coalesced pointercancel), which
    // must never break the interaction
    try {
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    } catch {
      /* synthetic or retired pointer — drag still works without capture */
    }
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current
      if (!d || d.id !== e.pointerId) return
      applyView({ panX: d.px + (e.clientX - d.x), panY: d.py + (e.clientY - d.y) })
    },
    [applyView],
  )

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null
  }, [])

  const fit = useCallback(() => {
    setState({ view: { ...getState().view, zoom: 1, panX: 0, panY: 0 } })
    saveView()
  }, [])

  const zoomBy = useCallback(
    (k: number) => applyView({ zoom: getState().view.zoom * k }),
    [applyView],
  )

  /* space-to-pan state (module-level so keydown anywhere works) */
  const [, force] = useState(0)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        if (!isSpaceHeld()) {
          setSpaceHeld(true)
          force((n) => n + 1)
        }
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpaceHeld(false)
        force((n) => n + 1)
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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-stage">
      <div
        ref={containerRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`relative min-h-0 flex-1 overflow-hidden ${checker ? 'checkerboard' : ''} ${
          isSpaceHeld() ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
        }`}
        style={{ touchAction: 'none' }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

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
                <Button size="sm" onClick={() => setState({ leftSheet: true })}>
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
