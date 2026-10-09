/**
 * export-service.ts — Runs still-image exports in a worker, WebM on the main
 * thread, with a synchronous fallback when workers are unavailable.
 *
 * The service owns no UI: it reports coarse progress (0–100) through a
 * callback and resolves with the `ExportResult`. Job bookkeeping and the
 * auto-download live in `export-run.ts` + the jobs store.
 *
 * WebM cannot leave the main thread — `exportAnimation` records a live
 * `canvas.captureStream()` through `MediaRecorder` — so it renders there with
 * progress forwarded the same way. Its frame loop already yields between
 * frames, so the UI stays alive while it records.
 */

import { exportAnimation, exportProject, type ExportOptions, type ExportResult } from './export'
import { useUiStore } from '../store/uiStore'
import type { LayerResult } from './pipeline'
import type { Project } from './schema'

export type ExportProgressFn = (progress: number) => void

interface JobHandlers {
  onProgress: ExportProgressFn
  resolve: (r: ExportResult) => void
  reject: (e: unknown) => void
}

let seq = 0
let worker: Worker | null = null
let workerBroken = false
const jobs = new Map<number, JobHandlers>()

function getWorker(): Worker | null {
  if (workerBroken) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../workers/export.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.addEventListener('message', onWorkerMessage as EventListener)
    worker.onerror = () => {
      failAll(new Error('Export worker failed — falling back to the main thread.'))
      workerBroken = true
      try {
        worker?.terminate()
      } catch {
        /* ignore */
      }
      worker = null
    }
    return worker
  } catch {
    workerBroken = true
    return null
  }
}

interface WorkerProgress {
  type: 'progress'
  id: number
  progress: number
}
interface WorkerResult {
  type: 'result'
  id: number
  result: ExportResult
}
interface WorkerError {
  type: 'error'
  id: number
  message: string
}
type WorkerOutgoing = WorkerProgress | WorkerResult | WorkerError

function onWorkerMessage(e: MessageEvent<WorkerOutgoing>): void {
  const msg = e.data
  if (!msg || typeof msg.id !== 'number') return
  const job = jobs.get(msg.id)
  if (!job) return
  if (msg.type === 'progress') {
    job.onProgress(msg.progress)
  } else if (msg.type === 'result') {
    jobs.delete(msg.id)
    job.onProgress(100)
    job.resolve(msg.result)
  } else if (msg.type === 'error') {
    jobs.delete(msg.id)
    job.reject(new Error(msg.message))
  }
}

function failAll(err: unknown): void {
  for (const [, job] of jobs) job.reject(err)
  jobs.clear()
}

/**
 * Render an export. Stills go to the worker (snapshot by structured clone);
 * WebM records on the main thread; anything without a worker falls back to
 * the in-thread `exportProject`.
 */
export function enqueueExport(
  project: Project,
  results: LayerResult[],
  opts: ExportOptions,
  onProgress: ExportProgressFn = () => {},
): Promise<ExportResult> {
  if (opts.format === 'webm') return runWebm(project, results, opts, onProgress)
  const w = getWorker()
  if (!w) return runOnMain(project, results, opts, onProgress)
  const id = ++seq
  return new Promise<ExportResult>((resolve, reject) => {
    jobs.set(id, {
      onProgress,
      resolve,
      // A worker failure must not lose the file: redo the work in-thread.
      reject: (err) => {
        runOnMain(project, results, opts, onProgress).then(resolve, reject).catch(() => reject(err))
      },
    })
    try {
      w.postMessage({ type: 'export', id, project, results, opts })
    } catch {
      jobs.delete(id)
      runOnMain(project, results, opts, onProgress).then(resolve, reject)
    }
  })
}

async function runOnMain(
  project: Project,
  results: LayerResult[],
  opts: ExportOptions,
  onProgress: ExportProgressFn,
): Promise<ExportResult> {
  onProgress(10)
  const res = await exportProject(project, results, opts)
  onProgress(100)
  return res
}

async function runWebm(
  project: Project,
  results: LayerResult[],
  opts: ExportOptions,
  onProgress: ExportProgressFn,
): Promise<ExportResult> {
  const seconds = useUiStore.getState().exportSeconds
  const res = await exportAnimation(project, results, {
    seconds,
    fps: 30,
    scale: opts.scale,
    onProgress: (done, total) => onProgress(Math.round((done / Math.max(1, total)) * 100)),
  })
  onProgress(100)
  return res
}

/** For tests: drop the worker so a fresh one is built on next use. */
export function __resetExportServiceForTests(): void {
  try {
    worker?.terminate()
  } catch {
    /* ignore */
  }
  worker = null
  workerBroken = false
  jobs.clear()
}
