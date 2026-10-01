/**
 * render/service.ts — Schedules IR generation.
 *
 * • runs in a Web Worker when possible (heavy jobs stay off the UI thread)
 * • coalesces: only the newest request is kept; superseded waiters resolve
 *   with the newer result, so dragging a slider never queues up work
 * • falls back to synchronous generation when workers are unavailable or when
 *   a layer needs an image mask (masks are decoded with `document`)
 */

import { activeLayers, generateLayer, type LayerResult } from '../pipeline'
import type { Project } from '../schema'

export interface RenderOutput {
  results: LayerResult[]
  ms: number
  count: number
  truncated: boolean
}

export type ProgressFn = (p: { done: number; total: number; label: string } | null) => void

interface Waiter {
  resolve: (r: RenderOutput) => void
  reject: (e: unknown) => void
}

interface Task {
  id: number
  project: Project
  waiters: Waiter[]
  onProgress: ProgressFn
}

let seq = 0
let running: Task | null = null
let pending: Task | null = null
let worker: Worker | null = null
let workerBroken = false

const emptyResult = (): RenderOutput => ({ results: [], ms: 0, count: 0, truncated: false })

function needsMainThread(project: Project): boolean {
  try {
    return activeLayers(project).some((l) => l.dist.type === 'imageMask' && !!l.dist.mask)
  } catch {
    return true
  }
}

function getWorker(): Worker | null {
  if (workerBroken) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../../workers/gen.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onerror = () => {
      workerBroken = true
      worker?.terminate()
      worker = null
    }
    return worker
  } catch {
    workerBroken = true
    return null
  }
}

function summarise(results: LayerResult[]): RenderOutput {
  const count = results.reduce((s, r) => s + r.ir.stats.count, 0)
  const truncated = results.some((r) => r.truncated)
  const ms = results.reduce((s, r) => s + r.ms, 0)
  return { results, ms, count, truncated }
}

/**
 * Identity of a render request.
 *
 * This has to be a *content* signature, not the project object's reference.
 * Every edit produces a fresh `project` object, so comparing by reference meant
 * `pending.project === project` never matched and the coalescing branch below
 * was unreachable — a slider drag queued a new task per tick instead of
 * collapsing into the one already waiting.
 *
 * Cheap to compute and specific enough to be correct: any change to the seed,
 * the canvas, or the layer count yields a different signature, and anything
 * finer (a param value) is covered by `projectStore.version`.
 */
function renderSignature(project: Project): string {
  return `${project.seed}:${project.canvas.w}x${project.canvas.h}:${project.layers.length}`
}

export function requestRender(project: Project, onProgress: ProgressFn): Promise<RenderOutput> {
  return new Promise<RenderOutput>((resolve, reject) => {
    const waiter: Waiter = { resolve, reject }
    const sig = renderSignature(project)
    if (running) {
      // Same signature as the queued task: the work is identical, so join it
      // rather than superseding it.
      if (pending && renderSignature(pending.project) === sig) {
        pending.waiters.push(waiter)
        return
      }
      // supersede any previously queued task: its waiters join the new one
      const superseded = pending
      pending = { id: ++seq, project, waiters: superseded?.waiters ?? [], onProgress }
      pending.waiters.push(waiter)
      return
    }
    running = { id: ++seq, project, waiters: [waiter], onProgress }
    void pump()
  })
}

async function pump(): Promise<void> {
  while (running) {
    const task = running
    try {
      const out = await run(task)
      task.waiters.forEach((w) => w.resolve(out))
    } catch (err) {
      task.waiters.forEach((w) => w.reject(err))
    } finally {
      running = pending
      pending = null
      if (!running) {
        // nothing left
      }
    }
  }
}

/**
 * Watchdog: if the worker never posts back (a message can be dropped, the
 * worker can be OOM-killed, or the page can be frozen/restored), `running`
 * would stay set forever and every later render would queue behind a promise
 * that never settles. After this deadline we terminate the worker, mark it
 * unusable for this session and re-run on the main thread instead.
 */
const WORKER_TIMEOUT_MS = 12_000

async function run(task: Task): Promise<RenderOutput> {
  const w = needsMainThread(task.project) ? null : getWorker()
  if (!w) return runOnMain(task)
  return new Promise<RenderOutput>((resolve) => {
    let done = false
    const finish = (out: RenderOutput) => {
      if (done) return
      done = true
      clearTimeout(timer)
      w.removeEventListener('message', handler as EventListener)
      task.onProgress(null)
      resolve(out)
    }
    const timer = setTimeout(() => {
      if (done) return
      // worker is wedged — kill it and redo the work in-thread
      workerBroken = true
      try {
        w.removeEventListener('message', handler as EventListener)
        w.terminate()
      } catch {
        /* ignore */
      }
      worker = null
      runOnMain(task).then(finish)
    }, WORKER_TIMEOUT_MS)
    const handler = (e: MessageEvent) => {
      const msg = e.data
      if (!msg || msg.id !== task.id) return
      if (msg.type === 'progress') {
        task.onProgress({ done: msg.done ?? 0, total: msg.total ?? 1, label: msg.label ?? '' })
      } else if (msg.type === 'result') {
        finish(summarise(msg.results ?? []))
      } else if (msg.type === 'error') {
        finish(emptyResult())
      }
    }
    w.addEventListener('message', handler as EventListener)
    w.postMessage({ type: 'render', id: task.id, project: task.project })
  })
}

async function runOnMain(task: Task): Promise<RenderOutput> {
  const layers = activeLayers(task.project)
  const results: LayerResult[] = []
  for (let i = 0; i < layers.length; i++) {
    task.onProgress({ done: i, total: layers.length, label: layers[i].name })
    // yield so the browser can paint the progress bar between layers
    await new Promise((r) => setTimeout(r, 0))
    results.push(await generateLayer(layers[i], task.project))
  }
  task.onProgress(null)
  return summarise(results)
}

export function shutdownRenderer(): void {
  worker?.terminate()
  worker = null
}
