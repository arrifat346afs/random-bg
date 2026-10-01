/**
 * useThemeEffect — reflect the theme preference onto <html>.
 *
 * Separate from App because it is a self-contained side effect with its own
 * `matchMedia` subscription and cleanup, and because "where does dark mode get
 * applied?" should have a one-line answer.
 */

import { useEffect } from 'react'
import { useUiStore } from '@/lib/state/uiStore'

export function useThemeEffect(): void {
  const theme = useUiStore((s) => s.view.theme)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      // `system` defers to the OS; an explicit choice overrides it.
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
      // keeps form controls and scrollbars in the matching scheme
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    }
    apply()
    // only meaningful while following the OS, but subscribing unconditionally
    // is cheaper than branching on every preference change
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}