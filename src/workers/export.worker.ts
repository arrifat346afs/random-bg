/**
 * workers/export.worker.ts — Still-image export off the main thread.
 *
 * The worker receives a snapshot of the project + the already-generated layer
 * results and runs the exact same `export.ts` path the foreground exporter
 * used to run (same IR → same pixels), but inside the worker: large PNG/JPG
 * renders no longer freeze the preview, and Randomise stays usable while an
 * export is in flight.
 *
 * Snapshot isolation comes free with `postMessage`: the project and results
 * are structured-cloned on send, so later edits cannot corrupt a running job.
 *
 * WebM stays on the main thread (`exportAnimation` needs `captureStream` +
 * `MediaRecorder`) — the service routes it there and this worker rejects it.
 */

import type { LayerResult } from '../lib/pipeline'
import type { Project } from '../lib/schema'
import {
  exportBasename,
  makeSvgExportResult,
  projectToSvgAsync,
  renderRasterExport,
  svgScaleFor,
  type ExportOptions,
  type ExportResult,
} from '../lib/export'

interface ExportMsg {
  type: 'export'
  id: number
  project: Project
  results: LayerResult[]
  opts: ExportOptions
}

type Incoming = ExportMsg

type Outgoing =
  | { type: 'progress'; id: number; progress: number }
  | { type: 'result'; id: number; result: ExportResult }
  | { type: 'error'; id: number; message: string }

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Incoming>) => void) | null
  postMessage: (msg: Outgoing) => void
}

ctx.onmessage = (e: MessageEvent<Incoming>) => {
  const msg = e.data
  if (msg?.type !== 'export') return
  void runExport(msg)
}

async function runExport(msg: ExportMsg): Promise<void> {
  const { id, project, results, opts } = msg
  const progress = (p: number) => ctx.postMessage({ type: 'progress', id, progress: p })
  try {
    if (opts.format === 'webm') {
      throw new Error('WebM records on the main thread — route it through the export service.')
    }
    progress(5)
    let result: ExportResult
    if (opts.format === 'json') {
      const json = JSON.stringify(project, null, 2)
      const base = exportBasename(project)
      result = {
        format: 'json',
        json,
        bytes: json.length,
        width: project.canvas.w,
        height: project.canvas.h,
        filename: `${base}.json`,
        warnings: [],
      }
    } else if (opts.format === 'svg') {
      const base = exportBasename(project)
      const bg = opts.includeBackground ? project.canvas.bg : undefined
      const { svgScale, stockWarnings } = svgScaleFor(project, opts)
      progress(20)
      const { svg, ir, warnings } = await projectToSvgAsync(project, results, {
        flattenAdditive: opts.flattenAdditive,
        background: bg,
        scale: svgScale,
        adobeCompat: opts.adobeCompat,
        includeBlur: opts.includeBlur ?? true,
      })
      progress(90)
      result = makeSvgExportResult(base, svg, ir, warnings, svgScale, stockWarnings, opts)
    } else {
      progress(15)
      result = await renderRasterExport(project, results, opts)
    }
    progress(100)
    ctx.postMessage({ type: 'result', id, result })
  } catch (err) {
    ctx.postMessage({ type: 'error', id, message: err instanceof Error ? err.message : String(err) })
  }
}
