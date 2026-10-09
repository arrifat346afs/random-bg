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
import { KEYS, loadJSON, saveJSON, saveThemeKey } from './persistence'
import { variations } from '../lib/randomize'
import type { Harmony } from '../lib/palette'
import { useProjectStore } from './projectStore'
import type { Project } from '../lib/schema'
import type { LayerTransform } from '../lib/transform'
import { loadRandomPool, saveRandomPool, type RandomPoolPrefs } from '../lib/random-pool'
import type { ExportFolderState } from '../lib/export-folder'

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
  /**
   * Pull a dragged layer's edges and centre onto the canvas edges and centre
   * line, drawing a guide when one fires. Off by default: snapping moves artwork
   * by a few units, which is a surprise if you did not ask for it.
   */
  snapToCanvas: boolean
  /**
   * SVG export fidelity. Persisted with the same view key so the choice is
   * remembered per user, never silently flipped per project.
   */
  svgExportMode: 'vector' | 'hybrid' | 'image'
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
    snapToCanvas: false,
    svgExportMode: 'vector',
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

/** A live drag on the stage: panning the view, or transforming a layer. */
export interface StageDrag {
  /** pointerId, so a stale gesture from another finger is ignored */
  id: number
  mode: 'pan' | 'move' | 'scale' | 'rotate'
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

/**
 * The placement of a layer **during** a gesture, before it is committed.
 *
 * Transient on purpose. A drag must not touch `project`: committing on every
 * pointermove bumped `projectStore.version`, which started a generation, which
 * posted the project to the worker, cloned every result back, produced a new IR
 * from `composeIR`, and so invalidated the raster cache — re-rasterising 40k
 * blurred primitives (~208 ms measured) once per pointermove. Holding the
 * placement here instead keeps the drag at one `drawImage` per frame.
 *
 * Written at most once per animation frame by `useStageDrag`.
 */
export interface LiveTransform {
  layerId: string
  transform: LayerTransform
  /** true once the pointer has moved far enough to count as a drag */
  moved: boolean
}

/** A snap guide drawn on the stage while a gesture is running. */
export interface SnapGuide {
  /** 'x' is a vertical rule at `at`; 'y' is a horizontal one */
  axis: 'x' | 'y'
  at: number
  /** the span the rule covers, so it reads as a guide and not a stray line */
  from: number
  to: number
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
  /** controllable Randomise pool (generators, backgrounds, filters, blends) */
  randomPool: RandomPoolPrefs
  randomPoolOpen: boolean

  /* export dialog */
  exportFormat: ExportFormat
  exportScale: number
  exportQuality: number
  exportIncludeBg: boolean
  exportFlatten: boolean
  exportAdobeCompat: boolean
  /** SVG/raster export toggle: false renders every node sharp. Defaults to true. */
  exportIncludeBlur: boolean
  exportSvgMode: 'vector' | 'hybrid' | 'image'
  exportSeconds: number
  exportBusy: boolean
  exportProgress: number
  exportStatus: ExportStatus | null
  exportFallback: ExportFallback | null
  /** format+open signature the transient fields above were last reset against */
  exportEpoch: string
  exportCopied: boolean
  /** save-to-folder state: the remembered root's display name, if any */
  exportFolderName: string | null
  /** save-to-folder state: refreshed when the settings dialog opens */
  exportFolderState: ExportFolderState

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
  /**
   * Placement of the layer being dragged, mid-gesture. Never committed until
   * pointer-up. Subscribed only by the stage draw path and the overlay.
   */
  liveTransform: LiveTransform | null
  /** snap rules to draw while a gesture runs */
  guides: SnapGuide[]
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
  patchRandomPool: (patch: Partial<RandomPoolPrefs>) => void
  setRandomPoolOpen: (open: boolean) => void
  toggleRandomGen: (genId: string) => void
  patchExport: (patch: Partial<Pick<UiStore, ExportKeys>>) => void
  /** Point the save-location UI at a root folder state (never persisted). */
  setExportFolder: (name: string | null, state: ExportFolderState) => void
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
  /** Update the mid-gesture placement; at most one call per animation frame. */
  setLiveTransform: (live: LiveTransform | null) => void
  setGuides: (guides: SnapGuide[]) => void
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
  | 'exportAdobeCompat'
  | 'exportIncludeBlur'
  | 'exportSeconds'
  | 'exportBusy'
  | 'exportProgress'
  | 'exportStatus'
  | 'exportFallback'
  | 'exportCopied'

/** The settings half of `ExportKeys` — what gets remembered across sessions. */
const EXPORT_PREF_KEYS = [
  'exportFormat',
  'exportScale',
  'exportQuality',
  'exportIncludeBg',
  'exportFlatten',
  'exportAdobeCompat',
  'exportIncludeBlur',
  'exportSeconds',
] as const

type ExportPrefKey = (typeof EXPORT_PREF_KEYS)[number]

const EXPORT_FORMATS: UiStore['exportFormat'][] = ['png', 'jpg', 'webp', 'svg', 'json', 'webm']

/**
 * Previously remembered export settings, validated field by field so one
 * corrupt value cannot take down the rest (or the defaults).
 */
export function loadExportPrefs(): Partial<Pick<UiStore, ExportPrefKey>> {
  const raw = loadJSON<Record<string, unknown>>(KEYS.export)
  if (!raw) return {}
  const out: Partial<Pick<UiStore, ExportPrefKey>> = {}
  if (typeof raw.exportFormat === 'string' && (EXPORT_FORMATS as string[]).includes(raw.exportFormat)) {
    out.exportFormat = raw.exportFormat as UiStore['exportFormat']
  }
  if (typeof raw.exportScale === 'number' && Number.isFinite(raw.exportScale)) {
    out.exportScale = Math.max(0.25, Math.min(8, raw.exportScale))
  }
  if (typeof raw.exportQuality === 'number' && Number.isFinite(raw.exportQuality)) {
    out.exportQuality = Math.max(0.3, Math.min(1, raw.exportQuality))
  }
  for (const k of ['exportIncludeBg', 'exportFlatten', 'exportAdobeCompat', 'exportIncludeBlur'] as const) {
    if (typeof raw[k] === 'boolean') out[k] = raw[k] as boolean
  }
  if (typeof raw.exportSeconds === 'number' && Number.isFinite(raw.exportSeconds)) {
    out.exportSeconds = Math.max(1, Math.min(12, Math.round(raw.exportSeconds)))
  }
  return out
}

/** Synchronous: `patchExport` fires on clicks, not per tick, so no debounce needed. */
function saveExportPrefs(s: UiStore): void {
  saveJSON(KEYS.export, {
    exportFormat: s.exportFormat,
    exportScale: s.exportScale,
    exportQuality: s.exportQuality,
    exportIncludeBg: s.exportIncludeBg,
    exportFlatten: s.exportFlatten,
    exportAdobeCompat: s.exportAdobeCompat,
    exportIncludeBlur: s.exportIncludeBlur,
    exportSeconds: s.exportSeconds,
  })
}

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
  randomPool: loadRandomPool(),
  randomPoolOpen: false,

  exportFormat: 'png',
  exportScale: 2,
  exportQuality: 0.92,
  exportIncludeBg: false,
  exportFlatten: false,
  exportAdobeCompat: true,
  exportIncludeBlur: true,
  exportSvgMode: 'vector',
  exportSeconds: 4,
  exportBusy: false,
  exportProgress: 0,
  exportStatus: null,
  exportFallback: null,
  exportEpoch: '',
  exportCopied: false,
  exportFolderName: null,
  exportFolderState: 'unknown',
  /* remembered export prefs overlay the defaults; see loadExportPrefs */
  ...loadExportPrefs(),

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
  liveTransform: null,
  guides: [],
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

  patchRandomPool: (patch) =>
    set((s) => {
      const randomPool = { ...s.randomPool, ...patch }
      saveRandomPool(randomPool)
      return { randomPool }
    }),
  setRandomPoolOpen: (randomPoolOpen) => set({ randomPoolOpen }),
  toggleRandomGen: (genId) =>
    set((s) => {
      const on = s.randomPool.gens[genId] ?? true
      const randomPool = { ...s.randomPool, gens: { ...s.randomPool.gens, [genId]: !on } }
      saveRandomPool(randomPool)
      return { randomPool }
    }),

  patchExport: (patch) => {
    set(patch)
    // Remember the settings half; transient job fields (busy/progress/status)
    // are deliberately never written.
    if (EXPORT_PREF_KEYS.some((k) => k in patch)) saveExportPrefs(get())
  },
  setExportFolder: (exportFolderName, exportFolderState) =>
    set({ exportFolderName, exportFolderState }),
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
  setLiveTransform: (liveTransform) =>
    set((s) => (Object.is(s.liveTransform, liveTransform) ? s : { liveTransform })),
  setGuides: (guides) => set((s) => (s.guides === guides ? s : { guides })),
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
    svgExportMode: view.svgExportMode,
  })
}