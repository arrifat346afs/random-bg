/**
 * ExportJobs — the background-export popup.
 *
 * Fixed bottom-right stack: one card per job with a progress bar while it
 * renders, then the filename + size with a re-download button (the file
 * already auto-downloaded — this is the spare copy), or the error message.
 * Dismissing a finished job revokes its manual-save URL.
 */

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useExportJobsStore } from '@/store/exportJobsStore'
import { downloadBlob } from '@/lib/export'
import { fmtBytes } from './export/format'
import { Check, AlertTriangle, Download, X, Loader2 } from 'lucide-react'

export function ExportJobs() {
  const jobs = useExportJobsStore((s) => s.jobs)
  if (jobs.length === 0) return null
  const remove = (id: string) => useExportJobsStore.getState().removeJob(id)

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-50 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-2">
      {jobs.map((job) => (
        <div
          key={job.id}
          className="pointer-events-auto rounded-lg border bg-background/95 p-2.5 shadow-lg backdrop-blur"
        >
          <div className="flex items-start gap-2">
            {job.status === 'rendering' ? (
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
            ) : job.status === 'done' ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium tabular-nums">
                {job.status === 'rendering'
                  ? `Exporting ${job.format.toUpperCase()}… ${job.progress}%`
                  : job.filename}
              </div>
              {job.status === 'rendering' ? (
                <Progress value={job.progress} className="mt-1.5 h-1.5" />
              ) : (
                <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {job.status === 'done'
                    ? `${fmtBytes(job.bytes)}${job.message ? ` · ${job.message}` : ''}`
                    : job.message || 'Export failed.'}
                </div>
              )}
              {job.status === 'done' && job.blocked && job.url && (
                <a
                  href={job.url}
                  download={job.filename}
                  className="mt-1 inline-block text-[11px] underline"
                >
                  Save the file manually
                </a>
              )}
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Dismiss"
              onClick={() => remove(job.id)}
              className="shrink-0"
            >
              <X />
            </Button>
          </div>
          {job.status === 'done' && job.blob && (
            <div className="mt-1.5 flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => job.blob && downloadBlob(job.blob, job.filename)}
              >
                <Download /> Download again
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
