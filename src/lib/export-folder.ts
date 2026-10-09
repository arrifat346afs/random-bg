/**
 * export-folder.ts — Save every export into a remembered folder.
 *
 * Browsers sandbox the real Downloads directory: a page can neither list it
 * nor create subfolders in it. So this uses the File System Access API
 * (Chromium): the user picks a folder once — ideally one inside Downloads —
 * the handle is kept in IndexedDB, and every export is written straight into
 * a per-project subfolder:
 *
 *   <chosen root>/<project-name>/file@2x.png
 *
 * The subfolder is found-or-created at save time (`ensureProjectFolder`), so
 * starting a new project needs no setup: the first export reuses the folder
 * when it is already there and creates it when it is not.
 *
 * Everything browser-specific lives behind `supportsExportFolder()` — other
 * engines keep the classic anchor-download path untouched.
 */

/** Minimal structural view of the handles we use (keeps us independent of lib gaps). */
export interface ExportDirHandle {
  name: string
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<ExportDirHandle>
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<ExportFileHandle>
  queryPermission?(desc?: { mode?: string }): Promise<PermissionState>
  requestPermission?(desc?: { mode?: string }): Promise<PermissionState>
}

export interface ExportFileHandle {
  createWritable(): Promise<ExportWritable>
}

export interface ExportWritable {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}

export type ExportFolderState =
  | 'unknown'
  | 'unsupported'
  | 'disconnected'
  | 'needs-permission'
  | 'ready'

export function supportsExportFolder(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as { showDirectoryPicker?: unknown }
  return typeof w.showDirectoryPicker === 'function'
}

/**
 * Filesystem-safe folder name from a project name. Same rules as the export
 * basename (lowercase, runs of non-alphanumerics become one `-`), so the
 * folder and the files agree.
 */
export function folderNameFor(projectName: string): string {
  return (
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'fx-forge'
  )
}

/* ---- remembered root handle (IndexedDB — handles survive reloads) -------- */

const DB_NAME = 'fx-forge'
const DB_STORE = 'kv'
const ROOT_KEY = 'export-root'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(DB_STORE)) {
          req.result.createObjectStore(DB_STORE)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'))
    } catch (err) {
      reject(err)
    }
  })
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly')
    const req = tx.objectStore(DB_STORE).get(key)
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
    tx.oncomplete = () => db.close()
  })
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).put(value, key)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
  })
}

async function idbDel(key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).delete(key)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
  })
}

export async function loadExportRoot(): Promise<ExportDirHandle | null> {
  try {
    return (await idbGet<ExportDirHandle>(ROOT_KEY)) ?? null
  } catch {
    return null
  }
}

async function forgetExportRoot(): Promise<void> {
  try {
    await idbDel(ROOT_KEY)
  } catch {
    /* best effort */
  }
}

/* ---- permission + picking ------------------------------------------------ */

async function hasWriteAccess(handle: ExportDirHandle): Promise<boolean> {
  try {
    if (typeof handle.queryPermission !== 'function') return true
    return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

/**
 * Ask the browser for write access. Must run inside a user gesture (the
 * Choose/Reconnect click qualifies); mid-export calls must use
 * `hasWriteAccess` instead, since transient activation may be long gone.
 */
async function askWriteAccess(handle: ExportDirHandle): Promise<boolean> {
  try {
    if (typeof handle.requestPermission !== 'function') return true
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

function picker(): ((opts?: object) => Promise<ExportDirHandle>) | null {
  const w = window as unknown as { showDirectoryPicker?: (opts?: object) => Promise<unknown> }
  if (typeof w.showDirectoryPicker !== 'function') return null
  return (opts?: object) => w.showDirectoryPicker?.(opts) as Promise<ExportDirHandle>
}

export interface PickedRoot {
  handle: ExportDirHandle
  name: string
}

/** User-gesture entry: pick the root, confirm write access, remember it. */
export async function pickExportRoot(): Promise<PickedRoot> {
  const show = picker()
  if (!show) throw new Error('This browser cannot grant folder access.')
  // `id` re-opens the last-picked folder instead of starting at Downloads.
  const handle = await show({ id: 'fx-forge-exports', mode: 'readwrite' })
  if (!(await askWriteAccess(handle))) throw new Error('Folder access was not granted.')
  await idbSet(ROOT_KEY, handle)
  return { handle, name: handle.name }
}

export async function disconnectExportRoot(): Promise<void> {
  await forgetExportRoot()
}

/** Re-read the remembered root: which state is the save-location UI in? */
export async function refreshExportFolder(): Promise<{ state: ExportFolderState; name: string | null }> {
  if (!supportsExportFolder()) return { state: 'unsupported', name: null }
  const handle = await loadExportRoot()
  if (!handle) return { state: 'disconnected', name: null }
  if (await hasWriteAccess(handle)) return { state: 'ready', name: handle.name }
  return { state: 'needs-permission', name: handle.name }
}

/** Gesture entry: re-authorise a remembered root whose permission lapsed. */
export async function reconnectExportRoot(): Promise<PickedRoot> {
  const handle = await loadExportRoot()
  if (!handle) throw new Error('No folder remembered — choose one first.')
  if (!(await askWriteAccess(handle))) throw new Error('Folder access was not granted.')
  return { handle, name: handle.name }
}

/* ---- per-project folder: find it or create it ---------------------------- */

export interface ProjectFolder {
  handle: ExportDirHandle
  /** true when the folder already existed and was simply reused */
  reused: boolean
  /** `<root>/<folder>` display path for status messages */
  path: string
}

function isNotFound(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'NotFoundError' : false
}

/**
 * Look for the project's folder under the root; reuse it when found, create
 * it when missing. Other errors (e.g. the root was deleted) propagate so the
 * caller can fall back to a plain download.
 */
export async function ensureProjectFolder(
  root: ExportDirHandle,
  folderName: string,
): Promise<ProjectFolder> {
  try {
    const handle = await root.getDirectoryHandle(folderName)
    return { handle, reused: true, path: `${root.name}/${folderName}` }
  } catch (err) {
    if (!isNotFound(err)) throw err
    const handle = await root.getDirectoryHandle(folderName, { create: true })
    return { handle, reused: false, path: `${root.name}/${folderName}` }
  }
}

export async function saveToFolder(
  dir: ExportDirHandle,
  filename: string,
  blob: Blob,
): Promise<void> {
  const file = await dir.getFileHandle(filename, { create: true })
  const out = await file.createWritable()
  try {
    await out.write(blob)
  } finally {
    await out.close()
  }
}

/**
 * Save a finished export into `<root>/<project>/filename`. Returns the
 * display path on success, null when folder saving is unavailable (caller
 * keeps the classic download path). Never throws.
 */
export async function saveExportToProjectFolder(
  projectName: string,
  filename: string,
  blob: Blob,
): Promise<string | null> {
  try {
    if (!supportsExportFolder()) return null
    const root = await loadExportRoot()
    if (!root) return null
    // No permission request here: this runs after an async render, outside
    // any user gesture. If access lapsed, the job notes it and downloads.
    if (!(await hasWriteAccess(root))) return null
    const folder = await ensureProjectFolder(root, folderNameFor(projectName))
    await saveToFolder(folder.handle, filename, blob)
    return `${folder.path}/${filename}`
  } catch {
    return null
  }
}
