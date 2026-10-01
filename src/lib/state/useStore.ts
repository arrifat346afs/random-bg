import { useSyncExternalStore } from 'react'
import { getState, subscribe, type AppState } from './store'

/**
 * Selector hook over the app store.
 * Selectors must return stable references (primitives or existing objects) —
 * the store swaps the whole state object on every change.
 */
export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(getState()),
    () => selector(getState()),
  )
}

export { getState }
