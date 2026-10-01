/**
 * Shown when the browser blocked a download: offers the blob URL plus a copy
 * action, which is the only route left once the automatic download is refused.
 */
import { Check, Copy, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/store/uiStore'

export function FallbackBox({
  title,
  body,
  url,
  copyLabel,
  copy,
}: {
  title: string
  body: string
  url?: string
  copyLabel?: string
  copy?: () => Promise<boolean>
}) {
  const copied = useUiStore((s) => s.exportCopied)
  const setCopied = (ok: boolean) => useUiStore.getState().patchExport({ exportCopied: ok })
  return (
    <div className="rounded-lg border border-dashed p-3 text-xs">
      <p className="mb-1 flex items-center gap-1.5 font-semibold">
        <Download className="h-3.5 w-3.5" /> {title}
      </p>
      <p className="mb-2 text-muted-foreground">{body}</p>
      <div className="flex flex-wrap gap-1.5">
        {url && (
          <Button size="sm" variant="outline" asChild>
            <a href={url} download="fx-forge-export">
              Save link as…
            </a>
          </Button>
        )}
        {copy && (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const ok = await copy()
              setCopied(ok)
            }}
          >
            {copied ? <Check /> : <Copy />} {copyLabel ?? 'Copy'}
          </Button>
        )}
      </div>
    </div>
  )
}
