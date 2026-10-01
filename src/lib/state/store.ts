/**
 * state/store.ts — tiny observable store (`useSyncExternalStore`-friendly).
 *
 * Holds the project, selection, view state and undo/redo history. All
 * mutations go through `commit` (records undo) or `patch` (transient, no undo).
 * Storage access is fully wrapped so a locked-down browser still works.
 */

import { createProject, cloneProject, ensurePaletteLinks } from '../project'
import { layerOffset, type Layer, type Project } from '../schema'
import { getPreset } from '../presets'
import type { LayerResult } from '../pipeline'

export interface ViewState {
  zoom: number
  panX: number
  panY: number
  checker: boolean
  theme: 'system' | 'light' | 'dark'
  /**
   * Aspect lock: Randomise keeps the canvas at its current w×h instead of
   * rolling a new size. On by default — `mutateProject`/`breed` already inherit
   * the canvas, and rolling a fresh size on every press was the odd one out.
   */
  lockAspect: boolean
}

export interface Progress {
  done: number
  total: number
  label: string
}

export interface UserPreset {
  id: string
  name: string
  tags: string[]
  createdAt: number
  project: Project
}

export interface AppState {
  project: Project
  selectedLayerId: string | null
  view: ViewState
  past: Project[]
  future: Project[]
  /** bumped on every structural/param change — drives regeneration */
  version: number
  generating: boolean
  progress: Progress | null
  /** latest generated layer IRs (null until the first render) */
  results: LayerResult[] | null
  /** bumped whenever `results` changes — Preview draws on this */
  resultsVersion: number
  primitiveCount: number
  truncated: boolean
  renderMs: number
  error: string | null
  storageAvailable: boolean
  userPresets: UserPreset[]
  gallery: Project[] | null
  inspectorTab: 'params' | 'distribute' | 'colour' | 'effects'
  leftSheet: boolean
  rightSheet: boolean
}

const HISTORY_LIMIT = 80

function loadJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function saveJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

const KEYS = {
  project: 'fx-forge:project:v1',
  presets: 'fx-forge:presets:v1',
  theme: 'fx-forge:theme',
  view: 'fx-forge:view',
}

function initialProject(): Project {
  const saved = loadJSON<Project>(KEYS.project)
  if (saved && saved.v === 1 && Array.isArray(saved.layers)) {
    // validate that referenced generators still exist at use-time
    if (!saved.palette) saved.palette = { colors: ['#ffffff', '#000000'] }
    return ensurePaletteLinks(saved)
  }
  const preset = getPreset('gold-dust') ?? createProject({ layers: ['particles', 'bokeh'] })
  return ensurePaletteLinks(preset)
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

function initialView(): ViewState {
  const base: ViewState = {
    zoom: 1,
    panX: 0,
    panY: 0,
    checker: true,
    theme: initialTheme(),
    lockAspect: true,
  }
  const saved = loadJSON<Partial<ViewState>>(KEYS.view)
  // `saved` is Partial, so a view persisted before the lock existed simply has
  // no `lockAspect` key and inherits the `true` default from `base`.
  if (saved) return { ...base, ...saved, theme: base.theme }
  return base
}

let state: AppState = {
  project: initialProject(),
  selectedLayerId: null,
  view: initialView(),
  past: [],
  future: [],
  version: 1,
  generating: true,
  progress: null,
  results: null,
  resultsVersion: 0,
  primitiveCount: 0,
  truncated: false,
  renderMs: 0,
  error: null,
  storageAvailable: true,
  userPresets: loadJSON<UserPreset[]>(KEYS.presets) ?? [],
  gallery: null,
  inspectorTab: 'params',
  leftSheet: false,
  rightSheet: false,
}

// default selection: first layer
if (state.project.layers.length) state.selectedLayerId = state.project.layers[0].id

const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getState(): AppState {
  return state
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const delta = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...delta }
  emit()
}

/* ---- History ------------------------------------------------------------- */

interface CommitOpts {
  /** coalescing key: repeated commits with the same key collapse into one */
  coalesce?: string
  /** skip history entirely (e.g. loading a project) */
  silent?: boolean
  /** select a layer after the commit */
  select?: string | null
}

let lastCoalesce: { key: string; at: number } | null = null

export function commit(next: Project, opts: CommitOpts = {}): void {
  const now = Date.now()
  let past = state.past
  let future = state.future

  if (!opts.silent) {
    const merge =
      opts.coalesce &&
      lastCoalesce &&
      lastCoalesce.key === opts.coalesce &&
      now - lastCoalesce.at < 900 &&
      past.length > 0
    if (!merge) {
      past = [...past, cloneProject(state.project)]
      if (past.length > HISTORY_LIMIT) past = past.slice(past.length - HISTORY_LIMIT)
    }
    future = []
    lastCoalesce = opts.coalesce ? { key: opts.coalesce, at: now } : null
  }

  state = {
    ...state,
    project: next,
    past,
    future,
    version: state.version + 1,
    error: null,
    ...(opts.select !== undefined ? { selectedLayerId: opts.select } : {}),
  }
  emit()
  scheduleAutosave()
}

export function patchProject(
  fn: (p: Project) => Project,
  opts: CommitOpts = {},
): void {
  commit(fn(state.project), opts)
}

export function canUndo(): boolean {
  return state.past.length > 0
}
export function canRedo(): boolean {
  return state.future.length > 0
}

export function undo(): void {
  if (!state.past.length) return
  const prev = state.past[state.past.length - 1]
  const past = state.past.slice(0, -1)
  const future = [cloneProject(state.project), ...state.future].slice(0, HISTORY_LIMIT)
  state = {
    ...state,
    project: prev,
    past,
    future,
    version: state.version + 1,
    selectedLayerId: prev.layers.some((l) => l.id === state.selectedLayerId)
      ? state.selectedLayerId
      : (prev.layers[0]?.id ?? null),
  }
  lastCoalesce = null
  emit()
  scheduleAutosave()
}

export function redo(): void {
  if (!state.future.length) return
  const next = state.future[0]
  const future = state.future.slice(1)
  const past = [...state.past, cloneProject(state.project)].slice(-HISTORY_LIMIT)
  state = { ...state, project: next, past, future, version: state.version + 1 }
  lastCoalesce = null
  emit()
  scheduleAutosave()
}

/* ---- Layer helpers -------------------------------------------------------- */

export function selectedLayer(): Layer | null {
  return state.project.layers.find((l) => l.id === state.selectedLayerId) ?? null
}

export function selectLayer(id: string | null): void {
  if (state.selectedLayerId === id) return
  setState({ selectedLayerId: id })
}

/** Update one layer immutably. */
export function updateLayer(
  id: string,
  fn: (l: Layer) => Layer,
  opts: CommitOpts = {},
): void {
  const project = state.project
  const idx = project.layers.findIndex((l) => l.id === id)
  if (idx < 0) return
  const next = project.layers.slice()
  next[idx] = fn(next[idx])
  commit({ ...project, layers: next }, opts)
}

/* ---- Autosave ------------------------------------------------------------- */

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleAutosave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const ok = saveJSON(KEYS.project, state.project)
    if (ok !== state.storageAvailable) setState({ storageAvailable: ok })
  }, 700)
}

export function saveTheme(): void {
  try {
    localStorage.setItem(KEYS.theme, state.view.theme)
  } catch {
    /* ignore */
  }
}

let viewTimer: ReturnType<typeof setTimeout> | null = null
/**
 * View (zoom/pan) changes fire on every wheel tick and pointermove during a
 * drag — writing to localStorage synchronously on each one stalls the main
 * thread. Coalesce the writes instead.
 */
export function saveView(immediate = false): void {
  if (viewTimer) clearTimeout(viewTimer)
  if (!immediate) {
    viewTimer = setTimeout(() => {
      viewTimer = null
      saveView(true)
    }, 400)
    return
  }
  saveJSON(KEYS.view, {
    zoom: state.view.zoom,
    panX: state.view.panX,
    panY: state.view.panY,
    checker: state.view.checker,
    lockAspect: state.view.lockAspect,
  })
}

/** Toggle the Randomise aspect lock. Mirrors `saveTheme` — no undo entry. */
export function setLockAspect(locked: boolean): void {
  setState((s) => ({ view: { ...s.view, lockAspect: locked } }))
  saveView(true)
}

/**
 * Nudge the selected layer's manual placement by (dx, dy) canvas units.
 *
 * Coalesced per layer, so a run of arrow presses becomes one undo entry rather
 * than one per keystroke (see `commit`'s 900 ms window). Returns false when
 * there is nothing to nudge — no selection, or the layer is locked.
 */
export function nudgeLayer(dx: number, dy: number): boolean {
  const s = getState()
  const layer = s.project.layers.find((l) => l.id === s.selectedLayerId)
  if (!layer || layer.locked) return false
  const cur = layerOffset(layer)
  commit(
    {
      ...s.project,
      layers: s.project.layers.map((l) =>
        l.id === layer.id ? { ...l, offset: { x: cur.x + dx, y: cur.y + dy } } : l,
      ),
    },
    { coalesce: `nudge:${layer.id}` },
  )
  return true
}

/* ---- User presets --------------------------------------------------------- */

export function saveUserPreset(name: string, tags: string[]): boolean {
  const preset: UserPreset = {
    id: `u${Date.now().toString(36)}`,
    name,
    tags,
    createdAt: Date.now(),
    project: cloneProject(state.project),
  }
  const list = [preset, ...state.userPresets].slice(0, 200)
  const ok = saveJSON(KEYS.presets, list)
  setState({ userPresets: list, storageAvailable: ok || state.storageAvailable })
  return ok
}

export function deleteUserPreset(id: string): void {
  const list = state.userPresets.filter((p) => p.id !== id)
  setState({ userPresets: list })
  saveJSON(KEYS.presets, list)
}

export function importUserPresets(json: string): { ok: boolean; count: number; error?: string } {
  try {
    const parsed = JSON.parse(json)
    const items: UserPreset[] = Array.isArray(parsed)
      ? parsed
      : [parsed]
    const clean = items.filter((p) => p && p.project && p.project.v === 1)
    if (!clean.length) return { ok: false, count: 0, error: 'No valid presets found in that file.' }
    const list = [...clean.map((p, i) => ({ ...p, id: p.id || `i${Date.now().toString(36)}${i}` })), ...state.userPresets]
    setState({ userPresets: list })
    saveJSON(KEYS.presets, list)
    return { ok: true, count: clean.length }
  } catch (err) {
    return { ok: false, count: 0, error: err instanceof Error ? err.message : 'Invalid JSON' }
  }
}

/* ---- Misc ----------------------------------------------------------------- */

export function applyProject(project: Project, opts: { selectFirst?: boolean } = {}): void {
  commit(ensurePaletteLinks(project), { silent: true })
  setState({
    past: [],
    future: [],
    gallery: null,
    selectedLayerId: opts.selectFirst === false ? state.selectedLayerId : (project.layers[0]?.id ?? null),
  })
}
