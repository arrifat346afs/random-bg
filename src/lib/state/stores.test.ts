/**
 * Tests for the non-document stores.
 *
 * uiStore owns the viewport and chrome, renderStore the generation output,
 * libraryStore the user's saved presets. Each is tested for the behaviour that
 * used to live in the single global store, plus the split-specific invariants
 * (no cross-store leakage, sheets being mutually exclusive).
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import './testSetup'
import { clearStorage, readStorage, seedStorage } from './testSetup'
import { initialView, useUiStore } from './uiStore'
import { beginRender, failRender, finishRender, useRenderStore } from './renderStore'
import { useLibraryStore } from './libraryStore'
import { useProjectStore } from './projectStore'
import { createProject } from '../project'

const ui = () => useUiStore.getState()

beforeEach(() => {
  clearStorage()
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
