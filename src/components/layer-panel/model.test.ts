/**
 * The projection in `model.ts` exists to keep the panel from re-rendering on a
 * param edit. That only works if it covers exactly the displayed fields and
 * nothing more, so these tests pin both halves.
 */
import { describe, expect, test } from 'bun:test'
import { createProject } from '../../lib/project'
import { summarise, summariseAll, toBlocks } from './model'

describe('summarise', () => {
  test('carries every field a row draws', () => {
    const l = createProject({ seed: 1, layers: ['smoke'] }).layers[0]
    const s = summarise(l)
    expect(s.id).toBe(l.id)
    expect(s.name).toBe(l.name)
    expect(s.gen).toBe(l.gen)
    expect(s.blend).toBe(l.blend)
    expect(s.opacity).toBe(l.opacity)
    expect(s.swatches).toBe(l.color.palette.colors)
    expect(s.groupId).toBeNull()
    expect(s.offset).toBeNull()
  })

  test('normalises a missing group and offset', () => {
    const l = createProject({ seed: 1, layers: ['smoke'] }).layers[0]
    const s = summarise({ ...l, groupId: undefined, offset: undefined })
    expect(s.groupId).toBeNull()
    expect(s.offset).toBeNull()
  })

  test('surfaces a layer that has been moved', () => {
    const l = createProject({ seed: 1, layers: ['smoke'] }).layers[0]
    expect(summarise({ ...l, offset: { x: 12, y: -4 } }).offset).toEqual({ x: 12, y: -4 })
  })

  /**
   * The whole point: a param edit must leave the summary field-for-field equal,
   * so a shallow comparison of the summaries array resolves to "unchanged".
   */
  test('a param edit does not change the summary', () => {
    const l = createProject({ seed: 1, layers: ['smoke'] }).layers[0]
    const before = summarise(l)
    const after = summarise({ ...l, params: { ...l.params, sizeMin: 0.75 } })
    expect(after).toEqual(before)
  })

  test('a name edit does change it', () => {
    const l = createProject({ seed: 1, layers: ['smoke'] }).layers[0]
    expect(summarise({ ...l, name: 'renamed' }).name).toBe('renamed')
  })
})

describe('summariseAll', () => {
  test('preserves order and length', () => {
    const layers = createProject({ seed: 2, layers: ['smoke', 'grain', 'particles'] }).layers
    expect(summariseAll(layers).map((s) => s.id)).toEqual(layers.map((l) => l.id))
  })
})

describe('toBlocks', () => {
  /**
   * A block is a *contiguous run* sharing a group id, and `null` is itself a
   * group id — so consecutive ungrouped layers collapse into one block. That is
   * the pre-existing behaviour (the drop handler reorders blocks, so this is what
   * guarantees members stay contiguous) and is pinned here so the extraction
   * cannot quietly change it.
   */
  test('consecutive ungrouped layers form a single block', () => {
    const ls = summariseAll(createProject({ seed: 3, layers: ['smoke', 'grain'] }).layers)
    expect(toBlocks(ls, [])).toHaveLength(1)
    expect(toBlocks(ls, [])[0].layers).toHaveLength(2)
  })

  test('a group boundary splits blocks', () => {
    const base = createProject({ seed: 3, layers: ['smoke', 'grain', 'particles'] })
    const ls = summariseAll([
      { ...base.layers[0], groupId: 'g1' },
      { ...base.layers[1], groupId: null },
      { ...base.layers[2], groupId: 'g1' },
    ])
    expect(toBlocks(ls, []).map((b) => b.layers.length)).toEqual([1, 1, 1])
  })

  test('contiguous group members collapse into one block', () => {
    const base = createProject({ seed: 4, layers: ['smoke', 'grain'] })
    const ls = summariseAll(base.layers.map((l) => ({ ...l, groupId: 'g1' })))
    expect(toBlocks(ls, [])).toHaveLength(1)
  })

  test('a group break splits the blocks', () => {
    const base = createProject({ seed: 5, layers: ['smoke', 'grain'] })
    const ls = summariseAll([
      { ...base.layers[0], groupId: 'g1' },
      { ...base.layers[1], groupId: null },
    ])
    expect(toBlocks(ls, [])).toHaveLength(2)
  })
})

/* ---- structural sharing --------------------------------------------------- */

/**
 * These tests cover the "Maximum update depth exceeded" bug.
 *
 * `useShallow` compares array elements with `Object.is`, so a projection that
 * allocated a fresh object per layer produced a new array on every call. React's
 * `useSyncExternalStore` saw an unstable `getSnapshot` and re-rendered forever.
 * The fix is that `summarise` hands back the *previous* object whenever nothing
 * it displays has moved.
 */
describe('summarise identity', () => {
  test('the same layer yields the same object', () => {
    const l = createProject({ seed: 7, layers: ['smoke'] }).layers[0]
    expect(summarise(l)).toBe(summarise(l))
  })

  test('a param edit yields the same object', () => {
    const l = createProject({ seed: 8, layers: ['smoke'] }).layers[0]
    const before = summarise(l)
    // params are not displayed, so the row must not be handed a new object
    expect(summarise({ ...l, params: { ...l.params, sizeMin: 0.42 } })).toBe(before)
  })

  test('an unrendered edit (dist/mods) also yields the same object', () => {
    const l = createProject({ seed: 9, layers: ['smoke'] }).layers[0]
    const before = summarise(l)
    expect(summarise({ ...l, dist: { ...l.dist, type: 'clustered' } as never })).toBe(before)
  })

  test('a displayed change yields a new object', () => {
    const l = createProject({ seed: 10, layers: ['smoke'] }).layers[0]
    const before = summarise(l)
    expect(summarise({ ...l, name: 'renamed' })).not.toBe(before)
    expect(summarise({ ...l, visible: !l.visible })).not.toBe(before)
    expect(summarise({ ...l, locked: !l.locked })).not.toBe(before)
    expect(summarise({ ...l, opacity: 0.25 })).not.toBe(before)
    expect(summarise({ ...l, offset: { x: 5, y: 5 } })).not.toBe(before)
  })

  test('a palette change to different colours yields a new object', () => {
    const l = createProject({ seed: 11, layers: ['smoke'] }).layers[0]
    const before = summarise(l)
    const next = summarise({
      ...l,
      color: { ...l.color, palette: { ...l.color.palette, colors: ['#123456', '#abcdef'] } },
    })
    expect(next).not.toBe(before)
    expect(next.swatches).toEqual(['#123456', '#abcdef'])
  })

  test('a re-created but identical palette keeps the object', () => {
    // the palette array is replaced on every palette edit, so reference
    // equality would report a change even when the colours are identical
    const l = createProject({ seed: 12, layers: ['smoke'] }).layers[0]
    const before = summarise(l)
    const next = summarise({
      ...l,
      color: { ...l.color, palette: { ...l.color.palette, colors: [...l.color.palette.colors] } },
    })
    expect(next).toBe(before)
  })
})
