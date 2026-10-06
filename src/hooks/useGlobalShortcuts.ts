/**
 * useGlobalShortcuts — application-wide keyboard handling.
 *
 * Extracted from App.tsx so the shortcut table is readable on its own and
 * testable by inspection. App used to carry ~100 lines of switch inline in an
 * effect, mixed with layout.
 *
 * Every handler goes through the stores rather than React state, so shortcuts
 * work without re-subscribing when the document changes.
 */

import { useEffect } from 'react'
import { isTyping } from '@/lib/keyboard'
import { duplicateLayer } from '@/lib/project'
import { randomise } from '@/store/randomise'
import { useFeedbackStore } from '@/store/feedbackStore'
import { useProjectStore } from '@/store/projectStore'
import { useUiStore } from '@/store/uiStore'

/** Arrows nudge by 1px; Shift multiplies. The only precise way to place a layer. */
const NUDGE = 1
const NUDGE_FAST = 10

const ZOOM_MIN = 0.05
const ZOOM_MAX = 8
const ZOOM_STEP = 1.25

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const ui = () => useUiStore.getState()
      const project = () => useProjectStore.getState()

      /** Zoom by a factor, clamped. */
      const zoomBy = (k: number) => {
        const v = ui().view.zoom
        ui().patchView({ zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v * k)) })
      }

      /* ---- modifier combos, all of which must not fall through ---- */
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) project().redo()
        else project().undo()
        return
      }
      if (mod && key === 'y') {
        e.preventDefault()
        project().redo()
        return
      }
      if (mod && key === 'd') {
        e.preventDefault()
        const s = project()
        const idx = s.project.layers.findIndex((l) => l.id === s.selectedLayerId)
        if (idx >= 0) {
          const copy = duplicateLayer(s.project.layers[idx])
          const next = s.project.layers.slice()
          next.splice(idx + 1, 0, copy)
          s.commit({ ...s.project, layers: next }, { select: copy.id })
        }
        return
      }
      if (mod) return

      switch (key) {
        case 'r':
          e.preventDefault()
          void randomise()
          break
        case ']':
          e.preventDefault()
          useFeedbackStore.getState().rateCurrent('like')
          break
        case '[':
          e.preventDefault()
          useFeedbackStore.getState().rateCurrent('dislike')
          break
        case 'e':
          e.preventDefault()
          ui().openDialog('export')
          break
        case 'p':
          e.preventDefault()
          ui().openDialog('presets')
          break
        case 'g':
          e.preventDefault()
          ui().setGallery(null)
          ui().openDialog('gallery')
          break
        case ',':
          e.preventDefault()
          ui().openDialog('settings')
          break

        case 'arrowup':
        case 'arrowdown':
        case 'arrowleft':
        case 'arrowright': {
          // No-ops (and does not swallow the key) when nothing is selected or
          // the layer is locked, so the arrows stay available to the page.
          const step = e.shiftKey ? NUDGE_FAST : NUDGE
          const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0
          const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0
          if (project().nudgeLayer(dx, dy)) e.preventDefault()
          break
        }

        case '0':
          ui().patchView({ zoom: 1, panX: 0, panY: 0 })
          break
        case '=':
        case '+':
          zoomBy(ZOOM_STEP)
          break
        case '-':
          zoomBy(1 / ZOOM_STEP)
          break

        case 'escape':
          ui().closeSheets()
          break
        case '?':
          ui().openDialog('settings')
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* Preview's empty state dispatches this rather than reaching into the store. */
  useEffect(() => {
    const handler = () => void randomise()
    window.addEventListener('fx:randomize', handler)
    return () => window.removeEventListener('fx:randomize', handler)
  }, [])
}