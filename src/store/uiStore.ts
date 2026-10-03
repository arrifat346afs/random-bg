/**
 * uiStore.ts — every piece of interface state.
 *
 * Viewport, chrome, and all transient UI: which dialog is open, dialog-local
 * form values, text drafts, popover flags, and the canvas-element handles the
 * preview draws through.
 *
 * Split from `projectStore` because none of this is part of the document, and
 * merged into one store because none of it is worth waking the render loop for.
 *
 * `view` stays a nested object so the `ViewState` shape and its `initialView`
 * migration keep working unchanged.
 *
 * A note on what belongs here. Some of this is what you would normally keep in
 * component `useState`, and there is a real cost: a draft in a global store
 * re-renders every subscriber. That is accepted deliberately so the whole app
 * reads and writes state one way, and it is mitigated by three rules:
 *
 *  - Selectors stay narrow. Components subscribe to the one field they use, so
 *    editing a draft does not re-render the preview.
 *  - DOM handles are read through `.getState()`, never subscribed to. Nothing
 *    renders a canvas element, so changing one notifies nobody.
 *  - Transient flags are not persisted, unlike `view`.
 */

import { create } from 'zustand'
import { KEYS, saveJSON, saveThemeKey } from './persistence'
import { variations } from '../lib/randomize'
import type { Harmony } from '../lib/palette'
import { useProjectStore } from './projectStore'
import type { Project } from '../lib/schema'

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

export type InspectorTab = 'params' | 'distribute' | 'colour' | 'effects' | 'filters'

/** Which mobile sheet: the layer stack or the inspector. */
export type SheetSide = 'left' | 'right'

/** Which dialog is open. Only one at a time. */
export type DialogId = 'presets' | 'gallery' | 'export' | 'settings' | null

/** How many variations the gallery offers. */
export const GALLERY_COUNT = 9

/* ---- export dialog ------------------------------------------------------ */

export type ExportFormat = 'png' | 'jpg' | 'webp' | 'svg' | 'json' | 'webm'

export interface ExportStatus {
  kind: 'ok' | 'warn'
  msg: string
}

/** Shown when a download was blocked and the UI falls back to a manual save. */
export interface ExportFallback {
  title: string
  body: string
  url?: string
  copyLabel?: string
  copy?: () => Promise<boolean>
}

/* ---- preview internals -------------------------------------------------- */

/** Stage size in CSS pixels, from the ResizeObserver. */
export interface StageSize {
  w: number
  h: number
}

/**
 * What the preview's cached raster holds. `ir` is typed loosely so the store
 * need not import the IR module; the preview is the only writer.
 */
export interface RasterMeta {
  key: string
  unit: number
  ir: unknown
}

/** A live drag on the stage: panning the view, or moving a layer. */
export interface StageDrag {
  /** pointerId, so a stale gesture from another finger is ignored */
  id: number
  mode: 'pan' | 'move'
  /** where the pointer went down, in client coords */
  x: number
  y: number
  /** the pan / offset at drag start, so deltas are absolute not accumulated */
  px: number
  py: number
  ox: number
  oy: number
  /** true once the pointer has travelled far enough to count as a drag */
  moved: boolean
}

export interface UiStore {
  /* viewport + chrome */
  view: ViewState
  inspectorTab: InspectorTab
  leftSheet: boolean
  rightSheet: boolean
  /** false when localStorage writes are being rejected (private mode, quota). */
  storageAvailable: boolean
  /** which dialog is open */
  dialog: DialogId

  /* preset browser */
  presetQuery: string
  presetTag: string | null

  /* top bar */
  /** live seed field; committed on blur/enter */
  seedDraft: string
  showSeed: boolean
  /** a randomise is in flight — stops a second press queueing a second gate */
  rolling: boolean

  /* export dialog */
  exportFormat: ExportFormat
  exportScale: number
  exportQuality: number
  exportIncludeBg: boolean
  exportFlatten: boolean
  exportSeconds: number
  exportBusy: boolean
  exportProgress: number
  exportStatus: ExportStatus | null
  exportFallback: ExportFallback | null
  /** format+open signature the transient fields above were last reset against */
  exportEpoch: string
  exportCopied: boolean

  /* gallery dialog */
  gallery: Project[] | null
  galleryRound: number
  /**
   * Per-card render status, keyed by the card's index.
   *
   * A map rather than one field because the gallery renders nine cards at once,
   * each generating its own preview asynchronously — a single shared status
   * would make all nine flip to "done" together, which is both wrong and a
   * re-render storm.
   */
  galleryCardStatus: Record<number, 'loading' | 'done' | 'error'>
  /** The canvas each card draws into, keyed by index. Read via getState(). */
  galleryCardRefs: Record<number, HTMLCanvasElement | null>
  /** Whether the gallery was open on the last render; drives the re-roll check. */
  galleryWasOpen: boolean
  /** Which round each card last started rendering, keyed by index. */
  galleryCardRound: Record<number, number>

  /* palette editor */
  /** the palette editor's harmony selector; the full Harmony union */
  paletteHarmony: Harmony
  /** index of the swatch just copied, or null */
  paletteCopied: number | null

  /* layer panel multi-select */
  multiSelect: string[]

  /* inspector transients */
  /** layer rename is in progress */
  renamingLayer: boolean
  /** the rename field's draft */
  renameDraft: string
  /** "add modifier" popover open in the Effects tab */
  modifierPickerOpen: boolean
  /** "add filter" menu open in the Filters tab */
  filterPickerOpen: boolean
  /** live query in the filter picker search box */
  filterQuery: string

  /**
   * Per-field drafts for numeric inputs, keyed by `${layerId}:${paramKey}`.
   *
   * A map rather than one string: Params renders one ParamField per generator
   * parameter, so a shared draft would make every field show — and overwrite —
   * the same text. Keying by layer + param is what keeps them independent while
   * still surviving a re-render, which is the point of holding it here.
   */
  paramDrafts: Record<string, string>
  /**
   * The upstream value each draft was last seeded from, keyed like
   * `paramDrafts`. When it stops matching, the field has been changed from
   * outside (undo, randomise) and any uncommitted draft is dropped.
   */
  paramDrifts: Record<string, number>

  /* image-mask picker */
  maskKind: 'radial' | 'linear'
  maskAngle: number
  maskBusy: boolean

  /* preview internals — read via getState(), never subscribed */
  stageSize: StageSize
  stageRef: HTMLElement | null
  canvasRef: HTMLCanvasElement | null
  rasterCanvas: HTMLCanvasElement | null
  /**
   * What the cached raster currently holds, so a redraw can tell a stale cache
   * from a fresh one. Written only by the draw effect via getState(); nothing
   * selects it, so a cache write never re-renders the stage.
   */
  rasterMeta: RasterMeta | null
  /** Debounce handle for the post-zoom re-raster. Never selected. */
  refineTimer: number | null
  stageDrag: StageDrag | null
  /** bump counter to force a redraw after a debounced re-raster */
  refineTick: number
  /** Drives the grab cursor; kept in step with the module-level space flag. */
  spaceHeld: boolean

  /* actions */
  patchView: (patch: Partial<ViewState>, opts?: { immediate?: boolean }) => void
  setTheme: (theme: ViewState['theme']) => void
  setLockAspect: (locked: boolean) => void
  setInspectorTab: (tab: InspectorTab) => void
  toggleSheet: (side: SheetSide) => void
  setSheet: (side: SheetSide, open: boolean) => void
  closeSheet: (side: SheetSide) => void
  closeSheets: () => void
  reportStorage: (ok: boolean) => void
  openDialog: (id: Exclude<DialogId, null>) => void
  closeDialog: () => void
  setPresetQuery: (q: string) => void
  setPresetTag: (tag: string | null) => void
  setSeedDraft: (seed: string) => void
  setShowSeed: (show: boolean) => void
  setRolling: (rolling: boolean) => void
  patchExport: (patch: Partial<Pick<UiStore, ExportKeys>>) => void
  /** Clear the transient export fields; called when the format or open state changes. */
  resetExportTransient: (epoch: string) => void
  setGallery: (gallery: Project[] | null) => void
  /** Roll fresh variations and bump the round, clearing per-card status. */
  rerollGallery: () => void
  setGalleryCardStatus: (index: number, status: 'loading' | 'done' | 'error') => void
  resetGalleryCardStatus: (index: number) => void
  setGalleryCardRef: (index: number, el: HTMLCanvasElement | null) => void
  markGalleryCardRound: (index: number, round: number) => void
  /** Render-phase memory for the open/close edge; see GalleryDialog. */
  syncGalleryOpen: (open: boolean) => void
  setPaletteHarmony: (h: UiStore['paletteHarmony']) => void
  setPaletteCopied: (i: number | null) => void
  setMultiSelect: (ids: string[]) => void
  setRenamingLayer: (renaming: boolean, draft?: string) => void
  setRenameDraft: (draft: string) => void
  setModifierPickerOpen: (open: boolean) => void
  /** open/close the Filters tab's "add filter" menu (closing clears the query) */
  setFilterPickerOpen: (open: boolean) => void
  /** live query driving the filter picker's search box */
  setFilterQuery: (query: string) => void
  setParamDraft: (key: string, draft: string) => void
  markParamDrift: (key: string, value: number) => void
  clearParamDraft: (key: string) => void
  patchMask: (patch: { kind?: UiStore['maskKind']; angle?: number; busy?: boolean }) => void
  setStageSize: (size: StageSize) => void
  setRefs: (refs: Partial<Pick<UiStore, 'stageRef' | 'canvasRef' | 'rasterCanvas'>>) => void
  setRasterMeta: (meta: UiStore['rasterMeta']) => void
  setRefineTimer: (t: number | null) => void
  setStageDrag: (drag: StageDrag | null) => void
  /** Keeps the grab cursor in sync with the module-level space-held flag. */
  patchSpaceHeld: (held: boolean) => void
  bumpRefine: () => void
}

type ExportKeys =
  | 'exportFormat'
  | 'exportScale'
  | 'exportQuality'
  | 'exportIncludeBg'
  | 'exportFlatten'
  | 'exportSeconds'
  | 'exportBusy'
  | 'exportProgress'
  | 'exportStatus'
  | 'exportFallback'
  | 'exportCopied'

export const useUiStore = create<UiStore>()((set, get) => ({
  view: initialView(loadView()),
  inspectorTab: 'params',
  leftSheet: false,
  rightSheet: false,
  storageAvailable: true,
  dialog: null,

  presetQuery: '',
  presetTag: null,

  seedDraft: '',
  showSeed: false,
  rolling: false,

  exportFormat: 'png',
  exportScale: 2,
  exportQuality: 0.92,
  exportIncludeBg: false,
  exportFlatten: false,
  exportSeconds: 4,
  exportBusy: false,
  exportProgress: 0,
  exportStatus: null,
  exportFallback: null,
  exportEpoch: '',
  exportCopied: false,

  gallery: null,
  galleryRound: 0,
  galleryCardStatus: {},
  galleryCardRefs: {},
  galleryWasOpen: false,
  galleryCardRound: {},

  paletteHarmony: 'analogous',
  paletteCopied: null,

  multiSelect: [],

  renamingLayer: false,
  renameDraft: '',
  modifierPickerOpen: false,
  filterPickerOpen: false,
  filterQuery: '',

  paramDrafts: {},
  paramDrifts: {},

  maskKind: 'radial',
  maskAngle: 90,
  maskBusy: false,

  stageSize: { w: 0, h: 0 },
  stageRef: null,
  canvasRef: null,
  rasterCanvas: null,
  stageDrag: null,
  refineTick: 0,
  spaceHeld: false,
  rasterMeta: null,
  refineTimer: null,

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
    set(
      side === 'left'
        ? { leftSheet: open, ...(open ? { rightSheet: false } : {}) }
        : { rightSheet: open, ...(open ? { leftSheet: false } : {}) },
    ),

  closeSheet: (side) => set(side === 'left' ? { leftSheet: false } : { rightSheet: false }),

  closeSheets: () => set({ leftSheet: false, rightSheet: false }),

  /** Only flips on a failed write, so one blocked save doesn't hide a recovery. */
  reportStorage: (ok) => {
    if (ok === get().storageAvailable) return
    set({ storageAvailable: ok })
  },

  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),

  setPresetQuery: (presetQuery) => set({ presetQuery }),
  setPresetTag: (presetTag) => set({ presetTag }),

  setSeedDraft: (seedDraft) => set({ seedDraft }),
  setShowSeed: (showSeed) => set({ showSeed }),
  setRolling: (rolling) => set({ rolling }),

  patchExport: (patch) => set(patch),
  /**
   * Called during the dialog's render to clear a stale result when it re-opens
   * or the format changes. Guarded on the epoch so a repeat call is a no-op —
   * an unguarded write here would notify from inside render.
   */
  resetExportTransient: (exportEpoch) =>
    set((s) =>
      Object.is(s.exportEpoch, exportEpoch)
        ? s
        : { exportEpoch, exportStatus: null, exportFallback: null, exportProgress: 0 },
    ),

  setGallery: (gallery) => set({ gallery }),

  rerollGallery: () =>
    set((s) => ({
      gallery: variations(useProjectStore.getState().project, GALLERY_COUNT),
      galleryRound: s.galleryRound + 1,
      galleryCardStatus: {},
      galleryCardRound: {},
    })),

  setGalleryCardStatus: (index, status) =>
    set((s) => ({ galleryCardStatus: { ...s.galleryCardStatus, [index]: status } })),

  resetGalleryCardStatus: (index) =>
    set((s) => ({ galleryCardStatus: { ...s.galleryCardStatus, [index]: 'loading' } })),

  /** Equality-checked for the same reason as `setRefs` — see there. */
  setGalleryCardRef: (index, el) =>
    set((s) => {
      if (Object.is(s.galleryCardRefs[index], el)) return s
      return { galleryCardRefs: { ...s.galleryCardRefs, [index]: el } }
    }),

  markGalleryCardRound: (index, round) =>
    set((s) => ({ galleryCardRound: { ...s.galleryCardRound, [index]: round } })),

  /**
   * Re-roll on the open edge. Kept as store state rather than component
   * `useState` so the dialog's render-phase adjust has a home that survives the
   * component being unmounted between opens (the dialogs are lazily mounted).
   */
  syncGalleryOpen: (open) => {
    const s = get()
    if (s.galleryWasOpen === open) return
    if (open) {
      set({ galleryWasOpen: open })
      s.rerollGallery()
    } else {
      set({ galleryWasOpen: false, gallery: null })
    }
  },

  setPaletteHarmony: (paletteHarmony) => set({ paletteHarmony }),
  setPaletteCopied: (paletteCopied) => set({ paletteCopied }),

  setMultiSelect: (multiSelect) => set({ multiSelect }),

  /** Entering rename mode seeds the draft with the current name. */
  setRenamingLayer: (renamingLayer, renameDraft) =>
    set(renameDraft === undefined ? { renamingLayer } : { renamingLayer, renameDraft }),

  setRenameDraft: (renameDraft) => set({ renameDraft }),
  setModifierPickerOpen: (modifierPickerOpen) => set({ modifierPickerOpen }),
  setFilterPickerOpen: (filterPickerOpen) => set({ filterPickerOpen, filterQuery: '' }),
  setFilterQuery: (filterQuery) => set({ filterQuery }),
  /** Unchanged value is a no-op: this is called during render. */
  markParamDrift: (key, value) =>
    set((s) => (Object.is(s.paramDrifts[key], value) ? s : { paramDrifts: { ...s.paramDrifts, [key]: value } })),

  setParamDraft: (key, draft) => set((s) => ({ paramDrafts: { ...s.paramDrafts, [key]: draft } })),
  clearParamDraft: (key) =>
    set((s) => {
      if (!(key in s.paramDrafts)) return s
      const next = { ...s.paramDrafts }
      delete next[key]
      return { paramDrafts: next }
    }),

  patchMask: ({ kind, angle, busy }) =>
    set((s) => ({
      maskKind: kind ?? s.maskKind,
      maskAngle: angle ?? s.maskAngle,
      maskBusy: busy ?? s.maskBusy,
    })),
  setStageSize: (stageSize) => set({ stageSize }),

  /**
   * Canvas and stage handles. Nothing renders these, so they never appear in a
   * selector — a component reads them with `getState()` inside a handler or an
   * effect, which is why storing them costs no re-renders.
   */
  /**
   * Attach or clear DOM handles.
   *
   * The equality check is load-bearing. React re-invokes a ref callback whenever
   * its identity changes — calling the old one with `null` and the new one with
   * the element — so an inline callback that writes unconditionally notifies on
   * every render and loops until React bails with "Maximum update depth
   * exceeded". Callers also memoise their callbacks; this is the backstop that
   * makes such a mistake harmless.
   */
  setRefs: (refs) => {
    const s = get()
    let changed = false
    const next: Partial<Pick<UiStore, 'stageRef' | 'canvasRef' | 'rasterCanvas'>> = {}
    for (const k of ['stageRef', 'canvasRef', 'rasterCanvas'] as const) {
      if (!(k in refs)) continue
      const v = refs[k] as never
      if (!Object.is(s[k], v)) {
        next[k] = v
        changed = true
      }
    }
    if (changed) set(next)
  },

  /**
   * Field-wise equality: the draw effect builds a fresh object each time, so
   * comparing by reference would report every call as a change and notify on
   * every frame of a pan.
   */
  setRasterMeta: (rasterMeta) => {
    const cur = get().rasterMeta
    if (cur === rasterMeta) return
    if (
      cur !== null &&
      rasterMeta !== null &&
      cur.key === rasterMeta.key &&
      cur.unit === rasterMeta.unit &&
      Object.is(cur.ir, rasterMeta.ir)
    ) {
      return
    }
    set({ rasterMeta })
  },

  setRefineTimer: (refineTimer) => {
    if (Object.is(get().refineTimer, refineTimer)) return
    set({ refineTimer })
  },
  /** Runs on every pointermove, so an unchanged drag must not notify. */
  setStageDrag: (stageDrag) => set((s) => (Object.is(s.stageDrag, stageDrag) ? s : { stageDrag })),
  patchSpaceHeld: (spaceHeld) => set({ spaceHeld }),
  bumpRefine: () => set((s) => ({ refineTick: s.refineTick + 1 })),
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