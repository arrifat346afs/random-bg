/**
 * uiStore.ts — viewport and chrome state.
 *
 * Zoom/pan, theme, the aspect lock, which inspector tab is open, which mobile
 * sheet is up, the gallery contents, and whether storage is writable. None of it
 * is part of the document, so none of it belongs in `projectStore` — and none of
 * it should wake a render subscriber.
 *
 * `view` stays a nested object rather than being flattened into top-level keys,
 * so the `ViewState` shape and its `initialView` migration keep working
 * unchanged.
 */

import { create } from 'zustand'
import { KEYS, saveJSON, saveThemeKey } from './persistence'
import type { Project } from '../schema'

export interface ViewState {
  zoom: number
  panX: number
  panY: number
  checker: boolean
  theme: 'system' | 'light' | 'dark'
  /**
   * Aspect lock: Randomise keeps the canvas at its current w×h instead of
   * rolling a new size. On by default — mutate/breed already inherit the canvas
   * and rolling a fresh size was the odd one out.
   */
  lockAspect: boolean
}

/**
 * Initial view state, merged over a previously persisted partial.
 *
 * `saved` is Partial, so a view written before a field existed simply has no key
 * for it and inherits the base default — adding a field here stays backward
 * compatible without a schema version bump.
 */
export function initialView(saved?: Partial<ViewState> | null): ViewState {
  const base: ViewState = {
    zoom: 1,
    panX: 0,
    panY: 0,
    checker: true,
    theme: initialTheme(),
    lockAspect: true,
  }
  return saved ? { ...base, ...saved, theme: base.theme } : base
}

function initialTheme(): ViewState['theme'] {
  try {
    const t = localStorage.getItem(KEYS.theme)
    if (t === 'light' || t === 'dark' || t === 'system') return t
  } catch {
    /* ignore */
  }
  return 'system'
}

export type InspectorTab = 'params' | 'distribute' | 'colour' | 'effects'

/** Which mobile sheet: the layer stack or the inspector. */
export type SheetSide = 'left' | 'right'

export interface UiStore {
  view: ViewState
  inspectorTab: InspectorTab
  leftSheet: boolean
  rightSheet: boolean
  /** Variations of the current project shown in the gallery dialog. */
  gallery: Project[] | null
  /** false when localStorage writes are being rejected (private mode, quota). */
  storageAvailable: boolean

  patchView: (patch: Partial<ViewState>, opts?: { immediate?: boolean }) => void
  setTheme: (theme: ViewState['theme']) => void
  setLockAspect: (locked: boolean) => void
  setInspectorTab: (tab: InspectorTab) => void
  toggleSheet: (side: SheetSide) => void
  setSheet: (side: SheetSide, open: boolean) => void
  closeSheet: (side: SheetSide) => void
  closeSheets: () => void
  setGallery: (gallery: Project[] | null) => void
  reportStorage: (ok: boolean) => void
}

export const useUiStore = create<UiStore>()((set, get) => ({
  view: initialView(loadView()),
  inspectorTab: 'params',
  leftSheet: false,
  rightSheet: false,
  gallery: null,
  storageAvailable: true,

  patchView: (patch, opts = {}) => {
    set((s) => ({ view: { ...s.view, ...patch } }))
    saveView(get().view, opts.immediate ?? false)
  },

  setTheme: (theme) => {
    set((s) => ({ view: { ...s.view, theme } }))
    saveThemeKey(theme)
  },

  setLockAspect: (locked) => get().patchView({ lockAspect: locked }, { immediate: true }),

  setInspectorTab: (inspectorTab) => set({ inspectorTab }),

  /** Opening one sheet closes the other — there is only room for one. */
  toggleSheet: (side) =>
    set((s) =>
      side === 'left'
        ? { leftSheet: !s.leftSheet, rightSheet: false }
        : { rightSheet: !s.rightSheet, leftSheet: false },
    ),

  /** Explicit open/close. Opening one still closes the other. */
  setSheet: (side, open) =>
    set(side === 'left' ? { leftSheet: open, ...(open ? { rightSheet: false } : {}) } : { rightSheet: open, ...(open ? { leftSheet: false } : {}) }),

  closeSheet: (side) => set(side === 'left' ? { leftSheet: false } : { rightSheet: false }),

  closeSheets: () => set({ leftSheet: false, rightSheet: false }),

  setGallery: (gallery) => set({ gallery }),

  /** Only flips on a failed write, so one blocked save doesn't hide a recovery. */
  reportStorage: (ok) => {
    if (ok === get().storageAvailable) return
    set({ storageAvailable: ok })
  },
}))

function loadView(): Partial<ViewState> | null {
  try {
    const raw = localStorage.getItem(KEYS.view)
    return raw ? (JSON.parse(raw) as Partial<ViewState>) : null
  } catch {
    return null
  }
}

let viewTimer: ReturnType<typeof setTimeout> | null = null
/**
 * Persist the viewport.
 *
 * Zoom/pan changes fire on every wheel tick and every pointermove during a
 * drag — a synchronous `localStorage` write on each one stalls the main thread,
 * so writes are coalesced unless `immediate` is set.
 */
function saveView(view: ViewState, immediate: boolean): void {
  if (viewTimer) clearTimeout(viewTimer)
  if (!immediate) {
    viewTimer = setTimeout(() => {
      viewTimer = null
      saveView(view, true)
    }, 400)
    return
  }
  saveJSON(KEYS.view, {
    zoom: view.zoom,
    panX: view.panX,
    panY: view.panY,
    checker: view.checker,
    lockAspect: view.lockAspect,
  })
}