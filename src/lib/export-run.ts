/**
 * export-run.ts — One-click export shared by the TopBar button (and anything
 * else that wants it).
 *
 * Reads the remembered settings from `uiStore`, snapshots the current
 * project + render results, and hands them to the export service. The render
 * runs off the main thread, so Randomise and the preview stay usable; this
 * module files the result as a job, auto-downloads it, and leaves a
 * re-download behind in the popup when the browser blocks the download.
 */

import { downloadBlob, type ExportOptions, type ExportResult } from './export'
import { saveExportToProjectFolder } from './export-folder'
import { enqueueExport } from './export-service'
import { useExportJobsStore } from '../store/exportJobsStore'
import { useProjectStore } from '../store/projectStore'
import { useRenderStore } from '../store/renderStore'
import { useUiStore } from '../store/uiStore'

/** The remembered settings, as export options. */
export function currentExportOptions(): ExportOptions {
  const ui = useUiStore.getState()
  return {
    format: ui.exportFormat,
    scale: ui.exportScale,
    quality: ui.exportQuality,
    includeBackground: ui.exportIncludeBg,
    includeBlur: ui.exportIncludeBlur,
    flattenAdditive: ui.exportFlatten,
    adobeCompat: ui.exportAdobeCompat,
  }
}

function newJobId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `exp-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
  }
}

/**
 * Start a background export with the remembered settings. Returns the job id,
 * or null when there is nothing rendered yet. Never throws — failures land on
 * the job.
 */
export function quickExport(): string | null {
  const project = useProjectStore.getState().project
  const results = useRenderStore.getState().results
  if (!results) return null
  const opts = currentExportOptions()
  const jobs = useExportJobsStore.getState()
  const id = newJobId()
  jobs.addJob({
    id,
    format: opts.format,
    filename: `export.${opts.format === 'jpg' ? 'jpg' : opts.format}`,
    progress: 0,
    status: 'rendering',
    message: '',
    bytes: 0,
    blob: null,
    url: null,
    blocked: false,
  })
  void enqueueExport(project, results, opts, (progress) => {
    useExportJobsStore.getState().updateJob(id, { progress })
  }).then(
    (res) => finishJob(id, project.name, res),
    (err) =>
      useExportJobsStore.getState().updateJob(id, {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      }),
  )
  return id
}

async function finishJob(id: string, projectName: string, res: ExportResult): Promise<void> {
  const jobs = useExportJobsStore.getState()
  const blob = res.blob ?? (res.svg ? new Blob([res.svg], { type: 'image/svg+xml' }) : null) ??
    (res.json ? new Blob([res.json], { type: 'application/json' }) : null)
  const warnings = res.warnings.join(' ')
  if (!blob) {
    jobs.updateJob(id, {
      status: 'error',
      progress: 100,
      filename: res.filename,
      message: warnings || 'Export produced no file.',
    })
    return
  }
  // A connected folder takes the file straight into `<root>/<project>/` and
  // replaces the browser download; otherwise download as before.
  const folderPath = await saveExportToProjectFolder(projectName, res.filename, blob)
  if (folderPath) {
    jobs.updateJob(id, {
      status: 'done',
      progress: 100,
      filename: res.filename,
      bytes: res.bytes,
      blob,
      url: null,
      blocked: false,
      message: [`Saved to ${folderPath}`, warnings].filter(Boolean).join(' · '),
    })
    return
  }
  const ok = downloadBlob(blob, res.filename)
  jobs.updateJob(id, {
    status: 'done',
    progress: 100,
    filename: res.filename,
    bytes: res.bytes,
    blob,
    // Keep a manual-save link only when the automatic download was blocked —
    // otherwise there is nothing to click and the URL would leak.
    url: ok ? null : URL.createObjectURL(blob),
    blocked: !ok,
    message: ok ? warnings : `Download was blocked — use the manual link. ${warnings}`.trim(),
  })
}

/**
 * Render without downloading, for the dialog's "copy image" path: the heavy
 * raster still runs in the worker, only the clipboard write stays on the
 * main thread.
 */
export function renderExportBlob(opts: ExportOptions): Promise<ExportResult> {
  const project = useProjectStore.getState().project
  const results = useRenderStore.getState().results
  if (!results) return Promise.reject(new Error('Nothing rendered yet.'))
  return enqueueExport(project, results, opts, () => {})
}
