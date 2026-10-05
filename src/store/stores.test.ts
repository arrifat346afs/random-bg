/**
 * Tests for the non-document stores.
 *
 * uiStore owns the viewport and chrome, renderStore the generation output,
 * libraryStore the user's saved presets. Each is tested for the behaviour that
 * used to live in the single global store, plus the split-specific invariants
 * (no cross-store leakage, sheets being mutually exclusive).
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import './testSetup'
import { clearStorage, readStorage, seedStorage } from './testSetup'
import { initialView, useUiStore } from './uiStore'
import { beginRender, failRender, finishRender, useRenderStore } from './renderStore'
import { useLibraryStore } from './libraryStore'
import { useProjectStore, __resetAutosaveForTests } from './projectStore'
import { createProject } from '../lib/project'

const ui = () => useUiStore.getState()

beforeEach(() => {
  clearStorage()
  __resetAutosaveForTests()
  useUiStore.setState({
    view: initialView(),
    inspectorTab: 'params',
    leftSheet: false,
    rightSheet: false,
    gallery: null,
    storageAvailable: true,
  })
  useRenderStore.setState({
    results: null,
    resultsVersion: 0,
    primitiveCount: 0,
    truncated: false,
    renderMs: 0,
    generating: true,
    progress: null,
    error: null,
  })
  useLibraryStore.setState({ userPresets: [] })
})

/* ---- view migration ------------------------------------------------------ */

describe('initialView', () => {
  test('a fresh user gets documented defaults', () => {
    const v = initialView()
    expect(v.zoom).toBe(1)
    expect(v.checker).toBe(true)
    expect(v.lockAspect).toBe(true)
  })

  test('null saved state falls back to defaults', () => {
    expect(initialView(null)).toEqual(initialView())
  })

  /**
   * A view persisted before the aspect lock existed has no `lockAspect` key.
   * Undefined would read as "unlocked" and silently randomise every canvas.
   */
  test('a saved view predating the lock inherits true', () => {
    const v = initialView({ zoom: 2, panX: 10, panY: 20, checker: false })
    expect(v.zoom).toBe(2)
    expect(v.checker).toBe(false)
    expect(v.lockAspect).toBe(true)
  })

  test('an explicit saved lock value is respected', () => {
    expect(initialView({ lockAspect: false }).lockAspect).toBe(false)
  })

  /** Theme owns its own storage key, so the view blob must not override it. */
  test('theme comes from the theme key, not the view blob', () => {
    expect(initialView({ theme: 'dark' }).theme).not.toBe('dark')
  })
})

/* ---- ui chrome ----------------------------------------------------------- */

describe('uiStore chrome', () => {
  /**
   * Both directions, not just one. Closing the other sheet is a separate line in
   * each branch, so a test that only walks left-then-right leaves the left
   * branch's counterpart uncovered.
   */
  test('opening one sheet closes the other, both directions', () => {
    ui().toggleSheet('left')
    expect(ui().leftSheet).toBe(true)
    ui().toggleSheet('right')
    expect(ui().rightSheet).toBe(true)
    expect(ui().leftSheet).toBe(false)

    ui().toggleSheet('left')
    expect(ui().leftSheet).toBe(true)
    expect(ui().rightSheet).toBe(false)
  })

  test('setSheet also closes the other sheet', () => {
    ui().setSheet('right', true)
    ui().setSheet('left', true)
    expect(ui().leftSheet).toBe(true)
    expect(ui().rightSheet).toBe(false)
  })

  test('toggle closes an open sheet', () => {
    ui().toggleSheet('left')
    ui().toggleSheet('left')
    expect(ui().leftSheet).toBe(false)
  })

  test('setSheet is explicit', () => {
    ui().setSheet('right', true)
    expect(ui().rightSheet).toBe(true)
    ui().setSheet('right', false)
    expect(ui().rightSheet).toBe(false)
  })

  test('closeSheets clears both', () => {
    ui().setSheet('left', true)
    ui().setSheet('right', true)
    ui().closeSheets()
    expect(ui().leftSheet).toBe(false)
    expect(ui().rightSheet).toBe(false)
  })

  test('reportStorage only flips on a change', () => {
    ui().reportStorage(true)
    expect(ui().storageAvailable).toBe(true)
    ui().reportStorage(false)
    expect(ui().storageAvailable).toBe(false)
    // a later successful write restores the badge
    ui().reportStorage(true)
    expect(ui().storageAvailable).toBe(true)
  })

  test('the aspect lock is a view preference', () => {
    ui().setLockAspect(false)
    expect(ui().view.lockAspect).toBe(false)
  })
})

/* ---- render surface ------------------------------------------------------ */

describe('renderStore', () => {
  test('beginRender clears any stale error', () => {
    useRenderStore.setState({ error: 'old' })
    beginRender()
    expect(useRenderStore.getState().generating).toBe(true)
    expect(useRenderStore.getState().error).toBeNull()
  })

  test('finishRender lands results and bumps resultsVersion', () => {
    const before = useRenderStore.getState().resultsVersion
    finishRender({ results: [], count: 42, truncated: false, ms: 3 })
    const s = useRenderStore.getState()
    expect(s.resultsVersion).toBe(before + 1)
    expect(s.primitiveCount).toBe(42)
    expect(s.generating).toBe(false)
    expect(s.progress).toBeNull()
  })

  test('failRender records the message and stops the spinner', () => {
    failRender('boom')
    const s = useRenderStore.getState()
    expect(s.error).toBe('boom')
    expect(s.generating).toBe(false)
    expect(s.progress).toBeNull()
  })

  /** A render result belongs to the render store alone. */
  test('render state does not leak into the document', () => {
    const projectBefore = useProjectStore.getState().project
    finishRender({ results: [], count: 7, truncated: true, ms: 1 })
    expect(useProjectStore.getState().project).toBe(projectBefore)
  })
})

/* ---- library ------------------------------------------------------------- */

describe('libraryStore', () => {
  test('save then delete', () => {
    expect(useLibraryStore.getState().saveUserPreset('mine', ['glow'])).toBe(true)
    const list = useLibraryStore.getState().userPresets
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('mine')
    useLibraryStore.getState().deleteUserPreset(list[0].id)
    expect(useLibraryStore.getState().userPresets).toHaveLength(0)
  })

  test('saving snapshots the project rather than referencing it', () => {
    useProjectStore.setState({ project: createProject({ seed: 5, layers: ['smoke'] }) })
    useLibraryStore.getState().saveUserPreset('snap', [])
    const saved = useLibraryStore.getState().userPresets[0].project
    // mutating the open project must not reach into the saved copy
    useProjectStore.getState().commit({ ...useProjectStore.getState().project, name: 'changed' })
    expect(saved.name).not.toBe('changed')
  })

  test('round-trips through export and import', () => {
    const lib = useLibraryStore.getState()
    lib.saveUserPreset('one', ['a'])
    lib.saveUserPreset('two', ['b'])
    const json = JSON.stringify(useLibraryStore.getState().userPresets)
    useLibraryStore.setState({ userPresets: [] })
    const res = useLibraryStore.getState().importUserPresets(json)
    expect(res.ok).toBe(true)
    expect(useLibraryStore.getState().userPresets).toHaveLength(2)
  })

  test('import rejects malformed json without throwing', () => {
    const res = useLibraryStore.getState().importUserPresets('{ not json')
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
  })

  test('import drops entries that are not v1 projects', () => {
    const res = useLibraryStore.getState().importUserPresets(
      JSON.stringify([{ id: 'x', name: 'bad', project: { v: 99 } }]),
    )
    expect(res.ok).toBe(false)
    expect(useLibraryStore.getState().userPresets).toHaveLength(0)
  })
})

/* ---- persistence --------------------------------------------------------- */

describe('persistence', () => {
  test('a seeded view blob is what initialView consumes', () => {
    seedStorage('fx-forge:view', { zoom: 3, lockAspect: false })
    const v = initialView(JSON.parse(readStorage('fx-forge:view') as string))
    expect(v.zoom).toBe(3)
    // an explicit false is honoured rather than defaulted
    expect(v.lockAspect).toBe(false)
  })
})

/* ---- dialogs and per-dialog UI ------------------------------------------- */

describe('uiStore dialogs', () => {
  test('open and close', () => {
    ui().openDialog('export')
    expect(ui().dialog).toBe('export')
    ui().closeDialog()
    expect(ui().dialog).toBeNull()
  })

  test('only one dialog at a time', () => {
    ui().openDialog('settings')
    ui().openDialog('gallery')
    expect(ui().dialog).toBe('gallery')
  })
})

describe('uiStore export fields', () => {
  test('patchExport writes only what it is given', () => {
    const before = ui().exportQuality
    ui().patchExport({ exportScale: 4 })
    expect(ui().exportScale).toBe(4)
    expect(ui().exportQuality).toBe(before)
  })

  test('resetExportTransient clears the result but keeps the settings', () => {
    ui().patchExport({ exportStatus: { kind: 'ok', msg: 'done' }, exportProgress: 60 })
    ui().patchExport({ exportScale: 3 })
    ui().resetExportTransient('true:png')
    expect(ui().exportStatus).toBeNull()
    expect(ui().exportProgress).toBe(0)
    expect(ui().exportScale).toBe(3)
    expect(ui().exportEpoch).toBe('true:png')
  })

  test('the epoch guard only fires once per change', () => {
    // the dialog's render-phase check compares against this, so it must not
    // re-clear on every render
    ui().patchExport({ exportProgress: 50 })
    ui().resetExportTransient('true:png')
    ui().patchExport({ exportProgress: 80 })
    expect(ui().exportProgress).toBe(80)
  })
})

describe('uiStore gallery', () => {
  test('re-rolling replaces the items and bumps the round', () => {
    const before = ui().galleryRound
    ui().rerollGallery()
    expect(ui().galleryRound).toBe(before + 1)
    expect(ui().gallery).not.toBeNull()
  })

  test('per-card status is independent per card', () => {
    ui().setGalleryCardStatus(0, 'done')
    ui().setGalleryCardStatus(1, 'error')
    expect(ui().galleryCardStatus[0]).toBe('done')
    expect(ui().galleryCardStatus[1]).toBe('error')
    // an unrendered card is still "loading" rather than inheriting a neighbour's
    expect(ui().galleryCardStatus[2]).toBeUndefined()
  })

  test('re-rolling clears stale per-card status', () => {
    ui().setGalleryCardStatus(0, 'done')
    ui().rerollGallery()
    expect(Object.keys(ui().galleryCardStatus)).toHaveLength(0)
  })

  test('the open edge fires once per transition', () => {
    ui().syncGalleryOpen(true)
    const round = ui().galleryRound
    ui().syncGalleryOpen(true) // already open — must not re-roll
    expect(ui().galleryRound).toBe(round)
    ui().syncGalleryOpen(false)
    expect(ui().galleryWasOpen).toBe(false)
    expect(ui().gallery).toBeNull()
  })
})

describe('uiStore param drafts', () => {
  /**
   * Params renders one NumInput per generator parameter, so a single shared
   * draft string would make every field show and overwrite the same text.
   */
  test('drafts are keyed, not shared', () => {
    ui().setParamDraft('L1:density', '12')
    ui().setParamDraft('L1:radius', '44')
    expect(ui().paramDrafts['L1:density']).toBe('12')
    expect(ui().paramDrafts['L1:radius']).toBe('44')
  })

  test('clearing one draft leaves the others', () => {
    ui().setParamDraft('a', '1')
    ui().setParamDraft('b', '2')
    ui().clearParamDraft('a')
    expect(ui().paramDrafts['a']).toBeUndefined()
    expect(ui().paramDrafts['b']).toBe('2')
  })

  test('an upstream change is remembered so the draft can be dropped', () => {
    ui().markParamDrift('L1:density', 5)
    expect(ui().paramDrifts['L1:density']).toBe(5)
  })
})

describe('uiStore refs', () => {
  /**
   * DOM handles are held here so nothing needs a `useRef`, but the point is
   * that *components* never select them — a ref write still notifies subscribers
   * (Zustand has no field-level notifier), it just has no selected subscriber,
   * so no component re-renders. This asserts the first half: the write happens
   * and is readable, so the preview's `getState()` reads are correct.
   */
  test('a ref write is readable through getState', () => {
    const el = {} as HTMLCanvasElement
    useUiStore.getState().setRefs({ canvasRef: el })
    expect(useUiStore.getState().canvasRef).toBe(el)
    useUiStore.getState().setRasterMeta({ key: 'k', unit: 2, ir: null })
    expect(useUiStore.getState().rasterMeta?.key).toBe('k')
  })

  /** The re-render guarantee comes from selectors, not from the store. */
  test('no component selects a DOM handle', () => {
    // Guards the invariant that keeps this cheap: if someone later writes
    // useUiStore((s) => s.canvasRef), every cache write re-renders the stage.
    const src = readFileSync(
      new URL('../components/Preview.tsx', import.meta.url),
      'utf8',
    )
    const selectors = src.match(/useUiStore\(\(s\) => ([^)]*)\)/g) ?? []
    for (const sel of selectors) {
      expect(sel).not.toContain('canvasRef')
      expect(sel).not.toContain('stageRef')
      expect(sel).not.toContain('rasterCanvas')
      expect(sel).not.toContain('rasterMeta')
      expect(sel).not.toContain('refineTimer')
    }
    expect(selectors.length).toBeGreaterThan(0)
  })
})

/* ---- DOM handle attachment ------------------------------------------------ */

/**
 * Regression: an inline `ref={(el) => store.setRefs({ stageRef: el })}` made the
 * app render forever. React re-invokes a ref callback whenever its identity
 * changes (old one with `null`, new one with the element), so each render wrote
 * twice; because the write always produced a new state object, every write
 * notified, which sent React back for another render. React surfaced it as
 * "Maximum update depth exceeded".
 *
 * Two things prevent a recurrence: callers memoise their callbacks, and the
 * setters ignore a value that is already current.
 */
describe('DOM handle attachment', () => {
  test('re-attaching the same element notifies nobody', () => {
    const el = {} as HTMLCanvasElement
    useUiStore.getState().setRefs({ canvasRef: el })

    let hits = 0
    const un = useUiStore.subscribe(() => hits++)
    // exactly what React does to a changed ref callback, twice per render
    useUiStore.getState().setRefs({ canvasRef: el })
    useUiStore.getState().setRefs({ canvasRef: el })
    un()
    expect(hits).toBe(0)
  })

  test('detaching and re-attaching notifies exactly twice, not forever', () => {
    const el = {} as HTMLDivElement
    useUiStore.getState().setRefs({ stageRef: el })
    let hits = 0
    const un = useUiStore.subscribe(() => hits++)
    useUiStore.getState().setRefs({ stageRef: null })
    useUiStore.getState().setRefs({ stageRef: el })
    un()
    expect(hits).toBe(2)
  })

  test('a partial update leaves the other handle alone', () => {
    const a = {} as HTMLDivElement
    const b = {} as HTMLCanvasElement
    const u = useUiStore.getState()
    u.setRefs({ stageRef: a, canvasRef: b })
    const after = useUiStore.getState()
    u.setRefs({ stageRef: a })
    expect(after.stageRef).toBe(a)
    expect(after.canvasRef).toBe(b)
  })

  test('the raster cache metadata and timer ignore no-op writes', () => {
    useUiStore.getState().setRasterMeta({ key: 'k', unit: 1, ir: null })
    let hits = 0
    const un = useUiStore.subscribe(() => hits++)
    useUiStore.getState().setRasterMeta({ key: 'k', unit: 1, ir: null })
    useUiStore.getState().setRefineTimer(null)
    un()
    expect(hits).toBe(0)
  })

  test('gallery card refs ignore a no-op write', () => {
    const el = {} as HTMLCanvasElement
    useUiStore.getState().setGalleryCardRef(0, el)
    let hits = 0
    const un = useUiStore.subscribe(() => hits++)
    useUiStore.getState().setGalleryCardRef(0, el)
    un()
    expect(hits).toBe(0)
  })
})

/**
 * The other half of the fix is at the call site, so assert that too: no inline
 * ref callback may write to the store. If someone reintroduces one, React loops
 * and the app becomes unusable — worth failing a test over.
 */
describe('ref callbacks are memoised', () => {
  const files = ['../components/Preview.tsx', '../components/GalleryDialog.tsx']

  test('no store-writing ref callback is declared inline', () => {
    for (const rel of files) {
      const src = readFileSync(new URL(rel, import.meta.url), 'utf8')
      // `ref={(...)}` — an arrow or any inline expression — rather than `ref={name}`
      const inlineRefs = src.match(/ref=\{\([^)]*\)\s*=>/g) ?? []
      for (const r of inlineRefs) {
        // inline refs are fine so long as they do not touch the store
        expect(r).not.toMatch(/ui\(\)|useUiStore|getState\(\)/)
      }
      expect(src).toMatch(/ref=\{attach/)
    }
  })
})

/**
 * The three stores setters that are called *during render* must be idempotent,
 * or a render-phase write turns into a re-render that triggers another write.
 */
describe('render-phase setters are idempotent', () => {
  test('resetExportTransient ignores a repeat epoch', () => {
    useUiStore.getState().resetExportTransient('true:png')
    let hits = 0
    const un = useUiStore.subscribe(() => hits++)
    useUiStore.getState().resetExportTransient('true:png')
    un()
    expect(hits).toBe(0)
  })

  test('resetExportTransient still clears a stale result on a new epoch', () => {
    useUiStore.getState().resetExportTransient('true:png')
    useUiStore.getState().patchExport({ exportStatus: { kind: 'ok', msg: 'x' }, exportProgress: 40 })
    useUiStore.getState().resetExportTransient('true:svg')
    expect(useUiStore.getState().exportStatus).toBeNull()
    expect(useUiStore.getState().exportProgress).toBe(0)
    expect(useUiStore.getState().exportEpoch).toBe('true:svg')
  })

  test('markParamDrift ignores an unchanged value', () => {
    useUiStore.getState().markParamDrift('L1:density', 5)
    let hits = 0
    const un = useUiStore.subscribe(() => hits++)
    useUiStore.getState().markParamDrift('L1:density', 5)
    un()
    expect(hits).toBe(0)
  })

  test('clearParamDraft ignores a missing key', () => {
    useUiStore.getState().setParamDraft('L1:density', '3')
    let hits = 0
    const un = useUiStore.subscribe(() => hits++)
    useUiStore.getState().clearParamDraft('not-there')
    un()
    expect(hits).toBe(0)
  })

  test('setStageDrag ignores an identical drag', () => {
    const drag = {
      id: 1,
      mode: 'pan' as const,
      x: 1,
      y: 2,
      px: 3,
      py: 4,
      ox: 0,
      oy: 0,
      moved: false,
    }
    useUiStore.getState().setStageDrag(drag)
    let hits = 0
    const un = useUiStore.subscribe(() => hits++)
    useUiStore.getState().setStageDrag(drag)
    un()
    expect(hits).toBe(0)
  })
})
