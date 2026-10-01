/**
 * Direct tests for the extracted history policy.
 *
 * These same behaviours are also covered end-to-end through the store, but
 * asserting them here means a failure points at the policy rather than at store
 * plumbing — and the edge cases below are impractical to reach from outside.
 */

import { describe, expect, test } from 'bun:test'
import {
  COALESCE_MS,
  HISTORY_LIMIT,
  nextCursor,
  pushPast,
  redoTarget,
  shouldCoalesce,
  undoTarget,
} from './history'
import { createProject, cloneProject } from '../project'

const proj = (name: string) => ({ ...createProject({ seed: 1, layers: ['smoke'] }), name })
const cursor = (key: string | null, at: number) => ({ key, at })

describe('shouldCoalesce', () => {
  test('merges a same-key commit inside the window', () => {
    expect(shouldCoalesce(cursor('k', 1000), 'k', 1000 + COALESCE_MS - 1, false)).toBe(true)
  })

  test('does not merge once the window has elapsed', () => {
    expect(shouldCoalesce(cursor('k', 1000), 'k', 1000 + COALESCE_MS, false)).toBe(false)
  })

  test('does not merge on a different key', () => {
    expect(shouldCoalesce(cursor('a', 1000), 'b', 1100, false)).toBe(false)
  })

  test('does not merge with no key', () => {
    expect(shouldCoalesce(cursor('k', 1000), undefined, 1100, false)).toBe(false)
  })

  test('does not merge into an empty stack', () => {
    // Guards the case where a gesture starts with no history: there is nothing
    // to merge with, so the first commit must record a snapshot.
    expect(shouldCoalesce(cursor('k', 1000), 'k', 1100, true)).toBe(false)
  })

  test('does not merge against an unset cursor', () => {
    expect(shouldCoalesce(cursor(null, 0), 'k', 1000, false)).toBe(false)
  })
})

describe('pushPast', () => {
  test('appends a clone, so later mutation cannot reach the history', () => {
    const live = proj('live')
    const past = pushPast([], live)
    live.name = 'mutated after commit'
    expect(past[0].name).toBe('live')
    expect(past[0]).not.toBe(live)
  })

  test('trims the oldest entries past the limit', () => {
    let past: ReturnType<typeof proj>[] = []
    for (let i = 0; i < HISTORY_LIMIT + 25; i++) past = pushPast(past, proj(`n${i}`))
    expect(past).toHaveLength(HISTORY_LIMIT)
    // the survivors are the newest ones
    expect(past[past.length - 1].name).toBe(`n${HISTORY_LIMIT + 24}`)
  })

  test('does not mutate the input array', () => {
    const original = [proj('a')]
    const next = pushPast(original, proj('b'))
    expect(original).toHaveLength(1)
    expect(next).toHaveLength(2)
  })
})

describe('nextCursor', () => {
  test('a merged commit keeps the original timestamp', () => {
    // A long drag must stay one entry for its whole run rather than opening a
    // fresh window on every frame.
    const prev = cursor('k', 1000)
    expect(nextCursor(prev, { coalesce: 'k' }, true, 5000)).toEqual(prev)
  })

  test('a fresh commit stamps a new cursor', () => {
    expect(nextCursor(cursor(null, 0), { coalesce: 'k' }, false, 2000)).toEqual(cursor('k', 2000))
  })

  test('a commit without a key clears the cursor', () => {
    expect(nextCursor(cursor('k', 1000), {}, false, 2000)).toEqual(cursor(null, 0))
  })
})

describe('undo/redo targets', () => {
  test('undo pops the newest entry', () => {
    const t = undoTarget([proj('a'), proj('b')])
    expect(t?.project?.name).toBe('b')
    expect(t?.past.map((p) => p.name)).toEqual(['a'])
  })

  test('redo takes the front of future', () => {
    const t = redoTarget([proj('a'), proj('b')])
    expect(t?.project?.name).toBe('a')
    expect(t?.future.map((p) => p.name)).toEqual(['b'])
  })

  test('a multi-step redo replays in order', () => {
    // Regression guard: taking the last element instead of the front reverses
    // the sequence, and a single-entry future cannot detect that.
    let future = [proj('a'), proj('b'), proj('c')]
    const seen: string[] = []
    for (;;) {
      const t = redoTarget(future)
      if (!t?.project) break
      seen.push(t.project.name as string)
      future = t.future
    }
    expect(seen).toEqual(['a', 'b', 'c'])
  })

  test('empty stacks yield null', () => {
    expect(undoTarget([])).toBeNull()
    expect(redoTarget([])).toBeNull()
  })

  test('targets are the stored objects, not copies', () => {
    // undo assigns the snapshot directly, so identity is meaningful here
    const p = cloneProject(proj('x'))
    expect(undoTarget([p])?.project).toBe(p)
  })
})