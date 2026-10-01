/**
 * Migration tests for persisted view state.
 *
 * The interesting case is a `view` written by an older build that predates a
 * field. Those tests are why `initialView` is exported and pure rather than a
 * private module-init side effect — re-importing the store to re-run it is
 * brittle.
 */

import { describe, expect, test } from 'bun:test'
import './testSetup'
import { initialView } from './store'

describe('initialView', () => {
  test('a fresh user gets documented defaults', () => {
    const v = initialView()
    expect(v.zoom).toBe(1)
    expect(v.panX).toBe(0)
    expect(v.checker).toBe(true)
    expect(v.lockAspect).toBe(true)
  })

  test('null saved state falls back to defaults', () => {
    expect(initialView(null)).toEqual(initialView())
  })

  /**
   * A view persisted before the aspect lock existed has no `lockAspect` key.
   * It must inherit the default rather than coming back undefined, which would
   * make `!lockAspect` true and silently randomise every canvas.
   */
  test('a saved view predating the lock inherits true', () => {
    const saved = { zoom: 2, panX: 10, panY: 20, checker: false }
    const v = initialView(saved)
    expect(v.zoom).toBe(2)
    expect(v.panX).toBe(10)
    expect(v.checker).toBe(false)
    expect(v.lockAspect).toBe(true)
  })

  test('an explicit saved lock value is respected', () => {
    expect(initialView({ lockAspect: false }).lockAspect).toBe(false)
  })

  /**
   * Theme is owned by its own storage key, so a `view` blob must never be able
   * to override it — that is what the explicit `theme: base.theme` is for.
   */
  test('theme always comes from the theme key, not the view blob', () => {
    const v = initialView({ theme: 'dark' })
    expect(v.theme).not.toBe('dark')
  })
})