/**
 * Behaviour tests for the split stores.
 *
 * These replace the single-store suite. The assertions are the same ones that
 * pinned `store.ts`, which is the point: the split has to be behaviour
 * preserving, so the same cases have to hold against `projectStore`.
 *
 * The other stores are covered in `stores.test.ts` (view migration, ui chrome,
 * render surface, library).
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import './testSetup'
import { clearStorage } from './testSetup'
import { canRedo, canUndo, selectedLayer, useProjectStore } from './projectStore'
import { useRenderStore } from './renderStore'
import { useUiStore } from './uiStore'
import { createProject } from '../lib/project'

/**
 * Zustand stores are singletons with no reset API, so each test resets the
 * slices it touches rather than re-importing the module.
 */
function reset() {
  const p = createProject({ seed: 1, layers: ['smoke', 'grain'] })
  useProjectStore.setState({
    project: p,
    selectedLayerId: p.layers[0]?.id ?? null,
    past: [],
    future: [],
    version: 1,
  })
  useRenderStore.setState({ error: null, generating: false, progress: null })
  useUiStore.setState({ leftSheet: false, rightSheet: false, gallery: null })
}

const p = () => useProjectStore.getState()

beforeEach(() => {
  clearStorage()
  reset()
})

/* ---- history ------------------------------------------------------------- */

describe('projectStore history', () => {
  test('commit pushes the previous project onto the undo stack', () => {
    p().commit({ ...p().project, name: 'renamed' })
    expect(p().past).toHaveLength(1)
    expect(p().project.name).toBe('renamed')
  })

  test('undo and redo round-trip', () => {
    p().commit({ ...p().project, name: 'one' })
    p().commit({ ...p().project, name: 'two' })
    p().undo()
    expect(p().project.name).toBe('one')
    p().redo()
    expect(p().project.name).toBe('two')
  })

  test('undo is exhausted at the start of history', () => {
    expect(canUndo()).toBe(false)
    p().commit({ ...p().project, name: 'x' })
    p().undo()
    expect(canUndo()).toBe(false)
    expect(canRedo()).toBe(true)
  })

  test('a new commit clears the redo stack', () => {
    p().commit({ ...p().project, name: 'a' })
    p().undo()
    expect(canRedo()).toBe(true)
    p().commit({ ...p().project, name: 'b' })
    expect(canRedo()).toBe(false)
  })

  test('a multi-step redo replays in order', () => {
    // Guards the redo stack's ordering. Needs at least three undos: with one or
    // two entries in `future`, front and back coincide or reversing a 1-element
    // remainder is a no-op, so a reordered implementation still passes.
    for (const n of ['a', 'b', 'c', 'd']) p().commit({ ...p().project, name: n })
    p().undo()
    p().undo()
    p().undo()
    expect(p().project.name).toBe('a')
    expect(p().future.map((x) => x.name)).toEqual(['b', 'c', 'd'])
    p().redo()
    expect(p().project.name).toBe('b')
    p().redo()
    expect(p().project.name).toBe('c')
    p().redo()
    expect(p().project.name).toBe('d')
    expect(canRedo()).toBe(false)
  })

  test('undo then commit then redo cannot resurrect the old future', () => {
    p().commit({ ...p().project, name: 'a' })
    p().undo()
    p().commit({ ...p().project, name: 'fresh' })
    expect(canRedo()).toBe(false)
    p().redo()
    expect(p().project.name).toBe('fresh')
  })

  test('silent commit skips history entirely', () => {
    p().commit({ ...p().project, name: 'quiet' }, { silent: true })
    expect(p().past).toHaveLength(0)
    expect(p().project.name).toBe('quiet')
  })

  test('history is capped', () => {
    for (let i = 0; i < 120; i++) p().commit({ ...p().project, name: `n${i}` })
    expect(p().past.length).toBeLessThanOrEqual(80)
  })
})

/* ---- coalescing ---------------------------------------------------------- */

describe('projectStore coalescing', () => {
  test('a burst of commits with one key collapses into a single undo entry', () => {
    for (let i = 0; i < 6; i++) p().commit({ ...p().project, name: `n${i}` }, { coalesce: 'k' })
    expect(p().past).toHaveLength(1)
  })

  test('one undo rewinds the whole burst', () => {
    p().commit({ ...p().project, name: 'a' }, { coalesce: 'k' })
    for (let i = 0; i < 5; i++) p().commit({ ...p().project, name: `b${i}` }, { coalesce: 'k' })
    expect(p().project.name).toBe('b4')
    p().undo()
    expect(p().project.name).toBe('Untitled effect')
  })

  test('a different key does not coalesce', () => {
    p().commit({ ...p().project, name: 'a' }, { coalesce: 'one' })
    p().commit({ ...p().project, name: 'b' }, { coalesce: 'two' })
    expect(p().past).toHaveLength(2)
  })

  test('commits without a key never coalesce', () => {
    p().commit({ ...p().project, name: 'a' })
    p().commit({ ...p().project, name: 'b' })
    expect(p().past).toHaveLength(2)
  })
})

/* ---- commit side effects ------------------------------------------------- */

describe('projectStore commit', () => {
  test('bumps version, the signal useRenderer watches', () => {
    const v = p().version
    p().commit({ ...p().project, name: 'v' })
    expect(p().version).toBe(v + 1)
  })

  test('clears a stale render error in the other store', () => {
    useRenderStore.setState({ error: 'boom' })
    p().commit({ ...p().project, name: 'fixed' })
    expect(useRenderStore.getState().error).toBeNull()
  })

  test('select option sets the selection', () => {
    const second = p().project.layers[1]
    p().commit(p().project, { select: second.id })
    expect(p().selectedLayerId).toBe(second.id)
  })

  test('patchProject is commit(fn)', () => {
    p().patchProject((x) => ({ ...x, name: 'patched' }))
    expect(p().project.name).toBe('patched')
    expect(p().past).toHaveLength(1)
  })
})

/* ---- selection and layers ------------------------------------------------ */

describe('projectStore selection', () => {
  test('selectedLayer resolves the id', () => {
    p().selectLayer(p().project.layers[0].id)
    expect(selectedLayer()?.id).toBe(p().project.layers[0].id)
  })

  test('null selection clears it', () => {
    p().selectLayer(null)
    expect(p().selectedLayerId).toBeNull()
    expect(selectedLayer()).toBeNull()
  })

  test('updateLayer replaces just that layer', () => {
    const second = p().project.layers[1]
    p().updateLayer(second.id, (l) => ({ ...l, name: 'renamed' }))
    expect(p().project.layers[1].name).toBe('renamed')
    expect(p().project.layers[0].name).not.toBe('renamed')
  })

  test('updateLayer on an unknown id is a no-op', () => {
    const before = p().project
    p().updateLayer('nope', (l) => ({ ...l, name: 'x' }))
    expect(p().project).toBe(before)
  })
})

/* ---- nudge --------------------------------------------------------------- */

describe('nudgeLayer', () => {
  test('accumulates', () => {
    p().nudgeLayer(10, 0)
    p().nudgeLayer(0, 5)
    expect(p().project.layers[0].offset).toEqual({ x: 10, y: 5 })
  })

  test('a run of nudges is one undo entry', () => {
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 0], [0, 1]] as const) p().nudgeLayer(dx, dy)
    expect(p().past).toHaveLength(1)
  })

  test('one undo rewinds the whole run', () => {
    p().nudgeLayer(3, 3)
    p().nudgeLayer(3, 3)
    p().undo()
    expect(p().project.layers[0].offset).toBeUndefined()
  })

  test('refuses a locked layer', () => {
    const id = p().selectedLayerId as string
    useProjectStore.setState({
      project: { ...p().project, layers: p().project.layers.map((l) => (l.id === id ? { ...l, locked: true } : l)) },
    })
    expect(p().nudgeLayer(50, 50)).toBe(false)
    expect(p().project.layers.find((x) => x.id === id)?.offset).toBeUndefined()
  })

  test('no selection is a no-op', () => {
    p().selectLayer(null)
    expect(p().nudgeLayer(5, 5)).toBe(false)
  })
})

/* ---- applyProject -------------------------------------------------------- */

describe('applyProject', () => {
  test('replaces the project and selects the first layer by default', () => {
    const next = createProject({ seed: 99, layers: ['smoke'] })
    p().applyProject(next)
    expect(p().project.name).toBe(next.name)
    expect(p().selectedLayerId).toBe(next.layers[0].id)
  })

  test('can leave the selection alone', () => {
    const before = p().selectedLayerId
    const next = createProject({ seed: 98, layers: ['grain'] })
    p().applyProject(next, { selectFirst: false })
    expect(p().selectedLayerId).toBe(before)
  })

  test('clears history and closes the gallery', () => {
    useUiStore.setState({ gallery: [] })
    p().commit({ ...p().project, name: 'x' })
    expect(p().past.length).toBeGreaterThan(0)
    p().applyProject(createProject({ seed: 97, layers: ['smoke'] }))
    expect(p().past).toHaveLength(0)
    expect(p().future).toHaveLength(0)
    expect(useUiStore.getState().gallery).toBeNull()
  })
})