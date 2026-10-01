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
