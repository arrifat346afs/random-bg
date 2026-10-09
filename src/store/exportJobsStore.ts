/**
 * exportJobsStore.ts — Background export jobs.
 *
 * One entry per one-click export: `rendering` while the worker (or the WebM
 * recorder) is busy, `done` with the file ready for (re-)download, `error`
 * with the failure message. The queue popup reads this; `export-run.ts`
 * writes it.
 *
 * Blobs live here in memory only — never persisted — and object URLs are
 * revoked when their job is dismissed.
 */

import { create } from 'zustand'

export type ExportJobStatus = 'rendering' | 'done' | 'error'

export interface ExportJob {
  id: string
  format: string
  /** best-known filename; finalised when the render lands */
  filename: string
  /** 0–100 */
  progress: number
  status: ExportJobStatus
  /** warnings on success, the failure reason on error */
  message: string
  bytes: number
  blob: Blob | null
  /** manual-save link when the automatic download was blocked */
  url: string | null
  blocked: boolean
}

interface ExportJobsStore {
  jobs: ExportJob[]
  addJob: (job: ExportJob) => void
  updateJob: (id: string, patch: Partial<ExportJob>) => void
  removeJob: (id: string) => void
}

export const useExportJobsStore = create<ExportJobsStore>()((set, get) => ({
  jobs: [],

  addJob: (job) => set((s) => ({ jobs: [...s.jobs.slice(-4), job] })),

  updateJob: (id, patch) =>
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) })),

  removeJob: (id) => {
    const job = get().jobs.find((j) => j.id === id)
    if (job?.url) {
      try {
        URL.revokeObjectURL(job.url)
      } catch {
        /* ignore */
      }
    }
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }))
  },
}))
