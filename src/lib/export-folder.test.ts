/**
 * Tests for the save-to-folder logic.
 *
 * Only the DOM-free parts are covered here: folder naming, the
 * find-or-create behaviour (against fake handles), and the graceful
 * no-browser fallback. Picker/IndexedDB paths need a real browser.
 */

import { describe, expect, test } from 'bun:test'
import {
  ensureProjectFolder,
  folderNameFor,
  saveExportToProjectFolder,
  supportsExportFolder,
  type ExportDirHandle,
} from './export-folder'

describe('folderNameFor', () => {
  test('mirrors the export basename rules', () => {
    expect(folderNameFor('Gold Dust')).toBe('gold-dust')
    expect(folderNameFor('  (1) @My Effect! ')).toBe('1-my-effect')
    expect(folderNameFor('')).toBe('fx-forge')
    expect(folderNameFor('---')).toBe('fx-forge')
  })

  test('caps length', () => {
    expect(folderNameFor('a'.repeat(100))).toHaveLength(60)
  })
})

/** Minimal fake directory handle recording how it was asked. */
function fakeRoot(existing: Set<string>): ExportDirHandle & { calls: string[] } {
  const calls: string[] = []
  const self = {
    name: 'Downloads',
    calls,
    getDirectoryHandle: async (name: string, opts?: { create?: boolean }) => {
      calls.push(`dir:${name}:create=${opts?.create ?? false}`)
      if (existing.has(name) || opts?.create) {
        existing.add(name)
        return self as unknown as ExportDirHandle
      }
      throw new DOMException('not found', 'NotFoundError')
    },
    getFileHandle: async () => {
      throw new Error('unused')
    },
  }
  return self as unknown as ExportDirHandle & { calls: string[] }
}

describe('ensureProjectFolder', () => {
  test('reuses the folder when it is already there', async () => {
    const root = fakeRoot(new Set(['gold-dust']))
    const folder = await ensureProjectFolder(root, 'gold-dust')
    expect(folder.reused).toBe(true)
    expect(folder.path).toBe('Downloads/gold-dust')
    // looked up without creating
    expect(root.calls).toEqual(['dir:gold-dust:create=false'])
  })

  test('creates the folder when missing', async () => {
    const root = fakeRoot(new Set())
    const folder = await ensureProjectFolder(root, 'new-thing')
    expect(folder.reused).toBe(false)
    expect(folder.path).toBe('Downloads/new-thing')
    expect(root.calls).toEqual(['dir:new-thing:create=false', 'dir:new-thing:create=true'])
  })

  test('non-NotFound errors propagate', async () => {
    const root = {
      name: 'Downloads',
      getDirectoryHandle: async () => {
        throw new DOMException('denied', 'NotAllowedError')
      },
      getFileHandle: async () => {
        throw new Error('unused')
      },
    } satisfies ExportDirHandle
    await expect(ensureProjectFolder(root, 'x')).rejects.toThrow()
  })
})

describe('saveExportToProjectFolder', () => {
  test('null outside a browser — the classic download path stays', async () => {
    expect(supportsExportFolder()).toBe(false)
    const blob = new Blob(['x'], { type: 'image/png' })
    await expect(saveExportToProjectFolder('Gold Dust', 'gold-dust@2x.png', blob)).resolves.toBeNull()
  })
})
