/**
 * useGlobalShortcuts — application-wide keyboard handling.
 *
 * Extracted from App.tsx so the shortcut table is readable on its own and
 * testable by inspection. App used to carry ~100 lines of switch inline in an
 * effect, mixed with layout.
 *
 * Every handler goes through the store rather than React state, so shortcuts
 * work without re-subscribing when the document changes.
 */

import { useEffect } from 'react'
import { isTyping } from '@/lib/keyboard'
import { duplicateLayer } from '@/lib/project'
import { randomise } from '@/lib/state/randomise'
import { commit, getState, nudgeLayer, redo, setState, undo } from '@/lib/state/store'

/** Arrows nudge by 1px; Shift multiplies. The only precise way to place a layer. */
const NUDGE = 1
const NUDGE_FAST = 10

const ZOOM_MIN = 0.05
const ZOOM_MAX = 8
const ZOOM_STEP = 1.25

export function useGlobalShortcuts(openDialog: (id: DialogId) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      /* ---- modifier combos, all of which must not fall through ---- */
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && key === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (mod && key === 'd') {
        e.preventDefault()
        const s = getState()
        const idx = s.project.layers.findIndex((l) => l.id === s.selectedLayerId)
        if (idx >= 0) {
          const copy = duplicateLayer(s.project.layers[idx])
          const next = s.project.layers.slice()
          next.splice(idx + 1, 0, copy)
          commit({ ...s.project, layers: next }, { select: copy.id })
        }
        return
      }
      if (mod) return

      switch (key) {
        case 'r':
          e.preventDefault()
          void randomise()
          break
        case 'e':
          e.preventDefault()
          openDialog('export')
          break
        case 'p':
          e.preventDefault()
          openDialog('presets')
          break
        case 'g':
          e.preventDefault()
          setState({ gallery: null })
          openDialog('gallery')
          break
        case ',':
          e.preventDefault()
          openDialog('settings')
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
          if (nudgeLayer(dx, dy)) e.preventDefault()
          break
        }

        case '0':
          setState({ view: { ...getState().view, zoom: 1, panX: 0, panY: 0 } })
          break
        case '=':
        case '+':
          setState({
            view: { ...getState().view, zoom: Math.min(ZOOM_MAX, getState().view.zoom * ZOOM_STEP) },
          })
          break
        case '-':
          setState({
            view: {
              ...getState().view,
              zoom: Math.max(ZOOM_MIN, getState().view.zoom / ZOOM_STEP),
            },
          })
          break

        case 'escape':
          setState({ leftSheet: false, rightSheet: false })
          break
        case '?':
          openDialog('settings')
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openDialog])

  /* Preview's empty state dispatches this rather than reaching into the store. */
  useEffect(() => {
    const handler = () => void randomise()
    window.addEventListener('fx:randomize', handler)
    return () => window.removeEventListener('fx:randomize', handler)
  }, [])
}

export type DialogId = 'presets' | 'gallery' | 'export' | 'settings' | null