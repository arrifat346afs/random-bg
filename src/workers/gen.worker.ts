/**
 * workers/gen.worker.ts — Heavy generation off the main thread.
 *
 * The worker receives a whole Project and returns per-layer IR results
 * (plain JSON, so structured-clone is cheap). It also streams progress so the
 * UI can show a real bar on big jobs.
 */

import { activeLayers, generateLayer, type LayerResult } from '../lib/pipeline'
import type { Project } from '../lib/schema'

interface RenderMsg {
  type: 'render'
  id: number
  project: Project
}

type Incoming = RenderMsg

interface Outgoing {
  type: 'progress' | 'result' | 'error'
  id: number
  done?: number
  total?: number
  label?: string
  results?: LayerResult[]
  ms?: number
  message?: string
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Incoming>) => void) | null
  postMessage: (msg: Outgoing) => void
}

let latestId = 0

ctx.onmessage = async (e: MessageEvent<Incoming>) => {
  const msg = e.data
  if (msg?.type !== 'render') return
  latestId = msg.id
  const t0 = performance.now()
  try {
    const layers = activeLayers(msg.project)
    const results: LayerResult[] = []
    for (let i = 0; i < layers.length; i++) {
      if (latestId !== msg.id) return // superseded
      ctx.postMessage({ type: 'progress', id: msg.id, done: i, total: layers.length, label: layers[i].name })
      results.push(await generateLayer(layers[i], msg.project))
    }
    if (latestId !== msg.id) return
    ctx.postMessage({ type: 'progress', id: msg.id, done: layers.length, total: layers.length, label: 'done' })
    ctx.postMessage({
      type: 'result',
      id: msg.id,
      results,
      ms: Math.round((performance.now() - t0) * 100) / 100,
    })
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
