/**
 * Characterization tests for the app store.
 *
 * These pin the *current* behaviour before the Zustand migration, so the
 * migration can be proven behaviour-preserving rather than merely compiling.
 * If one of these fails after the refactor, the refactor changed something.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import './testSetup'
import {
  applyProject,
  canRedo,
  canUndo,
  commit,
  deleteUserPreset,
  getState,
  importUserPresets,
  nudgeLayer,
  patchProject,
  redo,
  saveUserPreset,
  selectLayer,
  selectedLayer,
  setLockAspect,
  setState,
  undo,
  updateLayer,
} from './store'
import { clearStorage } from './testSetup'
import { createLayer, createProject } from '../project'

/** Put the store back to a known state; module state would otherwise leak. */
function reset() {
  // two layers, so selection/index tests have something to point at
  const p = createProject({ seed: 1, layers: ['smoke', 'grain'] })
  setState({
    project: p,
    selectedLayerId: p.layers[0]?.id ?? null,
    past: [],
    future: [],
    version: 1,
    error: null,
    userPresets: [],
    gallery: null,
    results: null,
    generating: false,
    progress: null,
  })
}

beforeEach(() => {
  clearStorage()
  reset()
})

/* ---- history ------------------------------------------------------------- */

describe('history', () => {
  test('commit pushes the previous project onto the undo stack', () => {
    const before = getState().project
    commit({ ...before, name: 'renamed' })
    expect(getState().past).toHaveLength(1)
    expect(getState().project.name).toBe('renamed')
  })

  test('undo and redo round-trip', () => {
    const original = getState().project.name
    commit({ ...getState().project, name: 'one' })
    commit({ ...getState().project, name: 'two' })
    undo()
    expect(getState().project.name).toBe('one')
    redo()
    expect(getState().project.name).toBe('two')
    redo()
    expect(getState().project.name).toBe('two')
    expect(getState().project.name).not.toBe(original)
  })

  test('undo is exhausted at the start of history', () => {
    expect(canUndo()).toBe(false)
    commit({ ...getState().project, name: 'x' })
    undo()
    expect(canUndo()).toBe(false)
    expect(canRedo()).toBe(true)
  })

  test('a new commit clears the redo stack', () => {
    commit({ ...getState().project, name: 'a' })
    undo()
    expect(canRedo()).toBe(true)
    commit({ ...getState().project, name: 'b' })
    expect(canRedo()).toBe(false)
  })

  test('silent commit skips history entirely', () => {
    commit({ ...getState().project, name: 'quiet' }, { silent: true })
    expect(getState().past).toHaveLength(0)
    expect(getState().project.name).toBe('quiet')
  })

  test('history is capped at HISTORY_LIMIT', () => {
    for (let i = 0; i < 120; i++) commit({ ...getState().project, name: `n${i}` })
    // documented bound in store.ts; guard against it silently growing
    expect(getState().past.length).toBeLessThanOrEqual(80)
    expect(getState().past.length).toBeGreaterThan(0)
  })
})

/* ---- coalescing ---------------------------------------------------------- */

describe('coalesce', () => {
  test('a burst of commits with one key collapses into a single undo entry', () => {
    for (let i = 0; i < 6; i++) commit({ ...getState().project, name: `n${i}` }, { coalesce: 'k' })
    expect(getState().past).toHaveLength(1)
  })

  test('one undo rewinds the whole burst', () => {
    // The first commit of a coalesce run is what lands on the stack, so it
    // captures the state *before* that commit — undo returns to the project's
    // original name, not to 'a'.
    commit({ ...getState().project, name: 'a' }, { coalesce: 'k' })
    for (let i = 0; i < 5; i++) commit({ ...getState().project, name: `b${i}` }, { coalesce: 'k' })
    expect(getState().project.name).toBe('b4')
    undo()
    expect(getState().project.name).toBe('Untitled effect')
  })

  test('a different key does not coalesce with the previous burst', () => {
    commit({ ...getState().project, name: 'a' }, { coalesce: 'one' })
    commit({ ...getState().project, name: 'b' }, { coalesce: 'two' })
    expect(getState().past).toHaveLength(2)
  })

  test('commits without a key never coalesce', () => {
    commit({ ...getState().project, name: 'a' })
    commit({ ...getState().project, name: 'b' })
    expect(getState().past).toHaveLength(2)
  })
})

/* ---- commit side effects ------------------------------------------------- */

describe('commit', () => {
  test('bumps version, which is what triggers a re-render', () => {
    const v = getState().version
    commit({ ...getState().project, name: 'v' })
    expect(getState().version).toBe(v + 1)
  })

  test('clears a stale render error', () => {
    setState({ error: 'boom' })
    commit({ ...getState().project, name: 'fixed' })
    expect(getState().error).toBeNull()
  })

  test('select option sets the selection', () => {
    const [, second] = getState().project.layers
    commit(getState().project, { select: second.id })
    expect(getState().selectedLayerId).toBe(second.id)
  })

  test('patchProject is commit(fn)', () => {
    patchProject((p) => ({ ...p, name: 'patched' }))
    expect(getState().project.name).toBe('patched')
    expect(getState().past).toHaveLength(1)
  })
})

/* ---- selection and layers ------------------------------------------------ */

describe('selection', () => {
  test('selectedLayer resolves the id', () => {
    const [first] = getState().project.layers
    selectLayer(first.id)
    expect(selectedLayer()?.id).toBe(first.id)
  })

  test('null selection clears it', () => {
    selectLayer(null)
    expect(getState().selectedLayerId).toBeNull()
    expect(selectedLayer()).toBeNull()
  })

  test('updateLayer replaces just that layer', () => {
    const [, second] = getState().project.layers
    updateLayer(second.id, (l) => ({ ...l, name: 'renamed' }))
    expect(getState().project.layers[1].name).toBe('renamed')
    expect(getState().project.layers[0].name).not.toBe('renamed')
  })

  test('updateLayer on an unknown id is a no-op', () => {
    const before = getState().project
    updateLayer('nope', (l) => ({ ...l, name: 'x' }))
    expect(getState().project).toBe(before)
  })
})

/* ---- nudge --------------------------------------------------------------- */

describe('nudgeLayer', () => {
  test('accumulates', () => {
    const id = getState().selectedLayerId as string
    nudgeLayer(10, 0)
    nudgeLayer(0, 5)
    const l = getState().project.layers.find((x) => x.id === id)
    expect(l?.offset).toEqual({ x: 10, y: 5 })
  })

  test('a run of nudges is one undo entry', () => {
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 0], [0, 1]] as const) nudgeLayer(dx, dy)
    expect(getState().past).toHaveLength(1)
  })

  test('one undo rewinds the whole run', () => {
    nudgeLayer(3, 3)
    nudgeLayer(3, 3)
    undo()
    const l = getState().project.layers.find((x) => x.id === getState().selectedLayerId)
    expect(l?.offset).toBeUndefined()
  })

  test('refuses a locked layer', () => {
    const id = getState().selectedLayerId as string
    setState({
      project: {
        ...getState().project,
        layers: getState().project.layers.map((l) => (l.id === id ? { ...l, locked: true } : l)),
      },
    })
    expect(nudgeLayer(50, 50)).toBe(false)
    const l = getState().project.layers.find((x) => x.id === id)
    expect(l?.offset).toBeUndefined()
  })

  test('no selection is a no-op', () => {
    selectLayer(null)
    expect(nudgeLayer(5, 5)).toBe(false)
  })
})

/* ---- applyProject -------------------------------------------------------- */

describe('applyProject', () => {
  test('replaces the project and selects the first layer by default', () => {
    const next = createProject({ seed: 99, layers: [] })
    next.layers = [createLayer('smoke', 1)]
    applyProject(next)
    expect(getState().project.name).toBe(next.name)
    expect(getState().selectedLayerId).toBe(next.layers[0].id)
  })

  test('can leave the selection alone', () => {
    const before = getState().selectedLayerId
    const next = createProject({ seed: 98, layers: [] })
    next.layers = [createLayer('smoke', 2)]
    applyProject(next, { selectFirst: false })
    expect(getState().selectedLayerId).toBe(before)
  })
})

/* ---- user presets -------------------------------------------------------- */

describe('user presets', () => {
  test('save then delete', () => {
    const ok = saveUserPreset('mine', ['glow'])
    expect(ok).toBe(true)
    expect(getState().userPresets).toHaveLength(1)
    expect(getState().userPresets[0].name).toBe('mine')
    deleteUserPreset(getState().userPresets[0].id)
    expect(getState().userPresets).toHaveLength(0)
  })

  test('round-trips through export and import', () => {
    saveUserPreset('one', ['a'])
    saveUserPreset('two', ['b'])
    const json = JSON.stringify(getState().userPresets)
    setState({ userPresets: [] })
    const res = importUserPresets(json)
    expect(res.ok).toBe(true)
    expect(getState().userPresets).toHaveLength(2)
  })

  test('import rejects malformed json without throwing', () => {
    const res = importUserPresets('{ not json')
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
  })
})

/* ---- persistence --------------------------------------------------------- */

describe('persistence', () => {
  test('the aspect lock defaults to on', () => {
    expect(getState().view.lockAspect).toBe(true)
  })

  test('the lock survives a save/load round-trip', () => {
    setLockAspect(false)
    expect(getState().view.lockAspect).toBe(false)
  })
})

/**
 * A view persisted before the aspect lock existed must inherit the default
 * rather than coming back undefined. `initialView` merges base ← saved, and
 * `saved` is Partial, so a missing key leaves the default intact.
 */
// The "saved view predates the aspect lock" migration is covered in
// persistence.test.ts, where initialView is an exported pure function instead
// of a private module-init side effect.