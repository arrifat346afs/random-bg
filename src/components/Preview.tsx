/**
 * Preview.tsx — the artwork stage.
 *
 * Composition only. The three pieces of real work live beside this file:
 *
 *   view.ts            the screen transform shared by the blit and the overlay
 *   useStageDrag.ts    pointer gestures — which never commit
 *   useStageRaster.ts  what actually gets painted, in two modes
 *
 * Invariants: a drag never regenerates (gestures write `liveTransform`, the one
 * commit happens on pointer-up), and the overlay shares the raster's `view`.
 */

import { useCallback, useEffect, useMemo } from 'react'
import { type IR } from '@/lib/ir'
import { composeStageIR } from '@/lib/stageIR'
import type { HandleId } from '@/lib/handles'
import { projectFilterOpts } from '@/lib/filters/attach'
import { isSpaceHeld, setSpaceHeld } from '@/lib/keyboard'
import { useProjectStore } from '@/store/projectStore'
import { useRenderStore } from '@/store/renderStore'
import { useUiStore } from '@/store/uiStore'
import { useStageView, MAX_ZOOM, MIN_ZOOM } from './preview/view'
import { useStageDrag } from './preview/useStageDrag'
import { useStageRaster } from './preview/useStageRaster'
import { TransformOverlay } from './preview/TransformOverlay'
import { TransformReadout } from './preview/TransformReadout'
import { useGestureKeys } from './preview/useGestureKeys'
import { StageChrome } from './preview/StageChrome'

export function Preview() {
  const size = useUiStore((s) => s.stageSize)
  const checker = useUiStore((s) => s.view.checker)
  const spaceHeld = useUiStore((s) => s.spaceHeld)
  const refineTick = useUiStore((s) => s.refineTick)
  const results = useRenderStore((s) => s.results)
  const generating = useRenderStore((s) => s.generating)
  const progress = useRenderStore((s) => s.progress)
  const primitiveCount = useRenderStore((s) => s.primitiveCount)
  const truncated = useRenderStore((s) => s.truncated)
  const renderMs = useRenderStore((s) => s.renderMs)
  const error = useRenderStore((s) => s.error)
  const canvasSpec = useProjectStore((s) => s.project.canvas)
  const layerCount = useProjectStore((s) => s.project.layers.length)
  const selectedLayerId = useProjectStore((s) => s.selectedLayerId)

  /**
   * The layer list, and nothing else, from the project.
   *
   * `composeStageIR` and the filter map both depend on layer content, and any
   * edit replaces the edited layer's object (and the array), so this is the
   * right granularity: a committed placement recomposes the IR (cheap stamping,
   * no regeneration), while a running gesture writes only `liveTransform` and
   * never touches `project.layers`, so nothing recomposes per frame.
   */
  const layers = useProjectStore((s) => s.project.layers)

  const ir: IR | null = useMemo(() => {
    if (!results) return null
    // `layers` (+ canvas dims) is the invalidation signal: a committed
    // transform/visibility/filter/canvas edit replaces the array (or dims)
    // without regenerating `results`, and the memo must still recompose.
    void layers
    void canvasSpec.w
    void canvasSpec.h
    return composeStageIR(useProjectStore.getState().project, results)
  }, [results, layers, canvasSpec.w, canvasSpec.h])

  /**
   * Per-layer filter stacks, rebuilt from the project. Derived (not stored) so
   * editing a filter never touches the render store — only the raster refresh
   * below, while generation stays cached and instant.
   */
  const filterOpts = useMemo(() => {
    // `layers` is the invalidation signal, not an input: every edit replaces the
    // array, and `projectFilterOpts` reads the rest of the project imperatively so
    // this component never subscribes to the whole document.
    void layers
    return projectFilterOpts(useProjectStore.getState().project)
  }, [layers])

  const view = useStageView(ir?.w ?? 0, ir?.h ?? 0)
  const drag = useStageDrag(view, () => useUiStore.getState().stageRef)

  /**
   * The whole project, for the overlay only.
   *
   * Read during render rather than selected: `layers` above already re-renders
   * this component whenever the document changes, and selecting the project
   * itself would wake the whole stage on every keystroke in the inspector.
   */
  const project = useProjectStore.getState().project
  const selectedLayer = selectedLayerId
    ? project.layers.find((l) => l.id === selectedLayerId)
    : undefined

  useStageRaster({
    ir,
    view,
    filterOpts,
    getCanvas: () => useUiStore.getState().canvasRef,
    size,
    refineTick,
  })

  /* ---- stage element + pointer capture ---------------------------------- */

  const stageEl = () => useUiStore.getState().stageRef

  const attachStage = useCallback((el: HTMLDivElement | null) => {
    useUiStore.getState().setRefs({ stageRef: el })
  }, [])
  const attachCanvas = useCallback((el: HTMLCanvasElement | null) => {
    useUiStore.getState().setRefs({ canvasRef: el })
  }, [])

  useEffect(() => {
    const el = stageEl()
    if (!el) return
    const ro = new ResizeObserver(() => {
      useUiStore.getState().setStageSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    useUiStore.getState().setStageSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  /* ---- zoom / pan -------------------------------------------------------- */

  const applyView = useCallback((patch: Partial<{ zoom: number; panX: number; panY: number }>) => {
    const cur = useUiStore.getState().view.zoom
    useUiStore
      .getState()
      .patchView({ ...patch, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, patch.zoom ?? cur)) })
  }, [])

  // Native non-passive wheel listener. React's `onWheel` is passive at the root,
  // so `preventDefault()` in it only logs a warning and the page scrolls anyway.
  useEffect(() => {
    const el = stageEl()
    if (!el) return
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      const s = useUiStore.getState().view
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left - rect.width / 2
      const my = e.clientY - rect.top - rect.height / 2
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s.zoom * Math.exp(-e.deltaY * 0.0016)))
      const k = nextZoom / s.zoom
      applyView({ zoom: nextZoom, panX: mx - (mx - s.panX) * k, panY: my - (my - s.panY) * k })
    }
    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => el.removeEventListener('wheel', onWheelNative)
  }, [applyView])

  const zoomBy = useCallback((k: number) => applyView({ zoom: useUiStore.getState().view.zoom * k }), [applyView])
  const fit = useCallback(() => useUiStore.getState().patchView({ zoom: 1, panX: 0, panY: 0 }), [])

  /* ---- space to pan ------------------------------------------------------ */

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTypingEvent(e)) return
      if (!isSpaceHeld()) {
        setSpaceHeld(true)
        useUiStore.getState().patchSpaceHeld(true)
      }
      e.preventDefault()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      setSpaceHeld(false)
      useUiStore.getState().patchSpaceHeld(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // Enter commits a running gesture, Esc puts it back. Registered through a hook
  // rather than the global shortcut layer because both only mean something while
  // a gesture exists.
  useGestureKeys({
    commit: drag.commitGesture,
    cancel: drag.cancelGesture,
    isTransforming: () => useUiStore.getState().liveTransform !== null,
  })

  const showProgress = generating && progress !== null && progress.total > 1

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-stage">
      <div
        ref={attachStage}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerUp}
        className={`relative min-h-0 flex-1 overflow-hidden ${checker ? 'checkerboard' : ''} ${
          spaceHeld ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
        }`}
        style={{ touchAction: 'none' }}
      >
        <canvas ref={attachCanvas} className="absolute inset-0 h-full w-full" />

        <TransformOverlay
          results={results}
          project={project}
          view={view}
          selectedLayerId={selectedLayerId}
          interactive={!!selectedLayer && !selectedLayer.locked && selectedLayer.visible}
          onHandleDown={(e, handle) => {
            if (selectedLayerId) drag.beginHandle(e, selectedLayerId, handle as HandleId | 'rotate')
          }}
        />

        <TransformReadout />

        <StageChrome
          zoom={useUiStore.getState().view.zoom}
          onZoomBy={zoomBy}
          onFit={fit}
          showProgress={showProgress}
          progress={progress}
          generating={generating}
          error={error}
          canvasLabel={`${canvasSpec.w}×${canvasSpec.h}`}
          primitiveCount={primitiveCount}
          truncated={truncated}
          renderMs={renderMs}
          layerCount={layerCount}
          onAddLayer={() => useUiStore.getState().setSheet('left', true)}
          onRandomise={() => window.dispatchEvent(new CustomEvent('fx:randomize'))}
        />
      </div>
    </div>
  )
}

/** Local copy of `isTyping` so the space handler needs no extra import. */
function isTypingEvent(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  return (
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT' ||
    t.isContentEditable === true
  )
}