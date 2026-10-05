/**
 * projectStore.ts — the document.
 *
 * Owns the project, the selection, and the undo/redo stacks. This is the only
 * store that mutates a `Project`, which is what keeps "what you undo" and "what
 * you export" the same object.
 *
 * Split out of the former single `store.ts`. See `renderStore` for the
 * generation side and `uiStore` for viewport/chrome state.
 *
 * Zustand note: the *policy* (undo coalescing, stack targets, persistence) lives
 * in `history.ts` and `persistence.ts` as pure functions, so it stays testable
 * without React and without a store instance.
 */

import { create } from 'zustand'
import { cloneProject } from '../lib/project'
import { layerTransformOf, type Layer, type Project } from '../lib/schema'
import {
  nextCursor,
  pushPast,
  redoTarget,
  shouldCoalesce,
  undoTarget,
  HISTORY_LIMIT,
  type CommitPolicy,
  type HistoryCursor,
} from './history'
import { KEYS, backupRaw, loadRaw, saveJSON } from './persistence'
import { useRenderStore } from './renderStore'
import { useUiStore } from './uiStore'
import { getPreset } from '../lib/presets'
import { createProject, ensurePaletteLinks, ensureProjectFilters } from '../lib/project'
import { migrateLayers } from '../lib/migrate'

/** Store-facing commit options: the history policy plus a selection change. */
export interface CommitOpts extends CommitPolicy {
  /** select a layer after the commit */
  select?: string | null
}

function fallbackProject(): Project {
  const preset = getPreset('gold-dust') ?? createProject({ layers: ['particles', 'bokeh'] })
  ensureProjectFilters(preset)
  return ensurePaletteLinks(preset)
}

function loadInitialProject(): Project {
  let raw: string | null = null
  try {
    raw = loadRaw(KEYS.project)
  } catch {
    return fallbackProject()
  }
  if (!raw) return fallbackProject()
  let saved: Project | null = null
  try {
    saved = JSON.parse(raw) as Project
  } catch {
    backupRaw(KEYS.project, raw)
    return fallbackProject()
  }
  if (saved && saved.v === 1 && Array.isArray(saved.layers)) {
    // validate that referenced generators still exist at use-time
    if (!saved.palette) saved.palette = { colors: ['#ffffff', '#000000'] }
    ensureProjectFilters(saved)
    // `offset` -> `transform`: projects on disk may predate or postdate the field
    return migrateLayers(ensurePaletteLinks(saved))
  }
  backupRaw(KEYS.project, raw)
  return fallbackProject()
}

const NO_CURSOR: HistoryCursor = { key: null, at: 0 }

/** Module-level so it survives re-renders but is not part of the reactive state. */
let lastCoalesce: HistoryCursor = NO_CURSOR

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingProject: Project | null = null
let flushHooked = false
/**
 * Autosave, debounced.
 *
 * Commits fire on every keystroke of a slider drag, and `localStorage` writes
 * synchronously block the main thread, so the write is coalesced.
 *
 * The pending project is also flushed on pagehide / hidden tab, otherwise a
 * fast close inside the 700ms window silently drops the last edits.
 */
function scheduleAutosave(project: Project): void {
  pendingProject = project
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    pendingProject = null
    const ok = saveJSON(KEYS.project, project)
    useUiStore.getState().reportStorage(ok)
  }, 700)
}

/** Write any pending autosave now. Safe to call when nothing is pending. */
export function flushAutosave(): boolean {
  if (!pendingProject && !saveTimer) return true
  const next = pendingProject
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  pendingProject = null
  if (!next) return true
  const ok = saveJSON(KEYS.project, next)
  try {
    useUiStore.getState().reportStorage(ok)
  } catch {
    /* store may be torn down during unload — write still landed */
  }
  return ok
}

/** Test-only: drop pending autosave state so timers cannot leak between cases. */
export function __resetAutosaveForTests(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  pendingProject = null
}

function setupAutosaveFlush(): void {
  if (flushHooked) return
  try {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    flushHooked = true
    window.addEventListener('pagehide', flushAutosave)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushAutosave()
    })
  } catch {
    /* non-DOM runner — autosave simply stays debounced */
  }
}

setupAutosaveFlush()

export interface ProjectStore {
  project: Project
  selectedLayerId: string | null
  /**
   * Bumped by every structural change. `useRenderer` watches this and nothing
   * else — it is the one signal that the cached IR is stale.
   */
  version: number
  past: Project[]
  future: Project[]

  commit: (next: Project, opts?: CommitOpts) => void
  patchProject: (fn: (p: Project) => Project, opts?: CommitOpts) => void
  undo: () => void
  redo: () => void
  selectLayer: (id: string | null) => void
  updateLayer: (id: string, fn: (l: Layer) => Layer, opts?: CommitOpts) => void
  applyProject: (project: Project, opts?: { selectFirst?: boolean }) => void
  nudgeLayer: (dx: number, dy: number) => boolean
}

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  project: loadInitialProject(),
  // the first layer is the sensible default selection
  selectedLayerId: null,
  version: 1,
  past: [],
  future: [],

  commit: (next, opts = {}) => {
    const { project, past: prevPast } = get()
    const now = Date.now()
    let past = prevPast
    // every recorded commit clears the redo stack
    const future: Project[] = []

    if (!opts.silent) {
      const merged = shouldCoalesce(lastCoalesce, opts.coalesce, now, prevPast.length === 0)
      if (!merged) past = pushPast(past, project)
      lastCoalesce = nextCursor(lastCoalesce, opts, merged, now)
    }

    set({
      project: next,
      past,
      future,
      version: get().version + 1,
      ...(opts.select !== undefined ? { selectedLayerId: opts.select } : {}),
    })

    // The one cross-store write in this module: a fresh edit invalidates any
    // render error, which lives with the render results. React batches the two
    // updates, so subscribers never observe the project without the cleared
    // error.
    if (useRenderStore.getState().error !== null) {
      useRenderStore.setState({ error: null })
    }
    scheduleAutosave(next)
  },

  patchProject: (fn, opts = {}) => get().commit(fn(get().project), opts),

  undo: () => {
    const { project, past, selectedLayerId } = get()
    const target = undoTarget(past)
    if (!target?.project) return
    const restored = target.project
    set({
      project: restored,
      past: target.past,
      future: [cloneProject(project), ...get().future].slice(0, HISTORY_LIMIT),
      version: get().version + 1,
      // keep the selection if that layer survived the undo, else fall back to
      // the top of the restored stack rather than pointing at nothing
      selectedLayerId: restored.layers.some((l) => l.id === selectedLayerId)
        ? selectedLayerId
        : (restored.layers[0]?.id ?? null),
    })
    lastCoalesce = NO_CURSOR
    scheduleAutosave(restored)
  },

  redo: () => {
    const { project, past, future } = get()
    const target = redoTarget(future)
    if (!target?.project) return
    set({
      project: target.project,
      past: [...past, cloneProject(project)].slice(-HISTORY_LIMIT),
      future: target.future,
      version: get().version + 1,
    })
    lastCoalesce = NO_CURSOR
    scheduleAutosave(target.project)
  },

  selectLayer: (id) => {
    if (get().selectedLayerId === id) return
    set({ selectedLayerId: id })
  },

  /**
   * Update one layer immutably.
   *
   * Two things matter for drag responsiveness:
   *
   *  - If `fn` returns the same layer it was given (an edit that resolved to no
   *    change), the whole commit is skipped. Dragging a slider across its
   *    current value should not wake a single subscriber.
   *  - Only the edited layer gets a new identity. The other layers keep theirs,
   *    so a subscriber selecting one of them does not re-render — but the
   *    `layers` *array* is necessarily new, since it holds the new layer.
   */
  updateLayer: (id, fn, opts = {}) => {
    const project = get().project
    const idx = project.layers.findIndex((l) => l.id === id)
    if (idx < 0) return
    const before = project.layers[idx]
    const after = fn(before)
    if (Object.is(after, before)) return
    const next = project.layers.slice()
    next[idx] = after
    get().commit({ ...project, layers: next }, opts)
  },

  /**
   * Load a project wholesale: no history (there is nothing to undo *to*), and a
   * closed gallery, since it shows variations of the project being replaced.
   */
  applyProject: (project, opts = {}) => {
    const next = migrateLayers(ensurePaletteLinks(ensureProjectFilters(project)))
    get().commit(next, { silent: true })
    set({
      past: [],
      future: [],
      selectedLayerId:
        opts.selectFirst === false ? get().selectedLayerId : (next.layers[0]?.id ?? null),
    })
    if (useUiStore.getState().gallery !== null) useUiStore.setState({ gallery: null })
  },

  /**
   * Move the selected layer by a whole canvas unit.
   *
   * A commit like any other — `generationSignature` is unchanged by a placement,
   * so no generation starts and the raster is rebuilt once at the end of a run of
   * presses rather than per keystroke.
   */
  nudgeLayer: (dx, dy) => {
    const s = get()
    const layer = s.project.layers.find((l) => l.id === s.selectedLayerId)
    if (!layer || layer.locked) return false
    const cur = layerTransformOf(layer)
    s.commit(
      {
        ...s.project,
        layers: s.project.layers.map((l) =>
          l.id === layer.id ? { ...l, transform: { ...cur, x: cur.x + dx, y: cur.y + dy } } : l,
        ),
      },
      { coalesce: `nudge:${layer.id}` },
    )
    return true
  },
}))

/* ---- derived helpers ----------------------------------------------------- */

/** The selected layer, or null. */
export function selectedLayer(): Layer | null {
  const s = useProjectStore.getState()
  return s.project.layers.find((l) => l.id === s.selectedLayerId) ?? null
}

export function canUndo(): boolean {
  return useProjectStore.getState().past.length > 0
}

export function canRedo(): boolean {
  return useProjectStore.getState().future.length > 0
}

/** The project as a plain read, for non-React callers. */
export function getProject(): Project {
  return useProjectStore.getState().project
}