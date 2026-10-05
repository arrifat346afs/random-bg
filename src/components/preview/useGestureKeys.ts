/**
 * preview/useGestureKeys.ts — Enter and Esc during a transform gesture.
 *
 * A gesture is transient, so the two keys that end one belong with the gesture
 * rather than with the global shortcut layer: Enter commits what is on screen,
 * Esc puts it back. Both are no-ops when no gesture is running, so they stay out
 * of the way of everything else.
 */

import { useEffect } from 'react'

export interface GestureKeys {
  /** commit the running gesture (Enter) */
  commit: () => void
  /** discard the running gesture (Esc) */
  cancel: () => void
  /** true while a layer gesture is running */
  isTransforming: () => boolean
}

export function useGestureKeys(api: GestureKeys): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!api.isTransforming()) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'Enter') {
        e.preventDefault()
        api.commit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        api.cancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api])
}