import { useState } from 'react'
import {
  MAX_EXPORT_DIM,
  MAX_EXPORT_PIXELS,
  copyImage,
  copyText,
  downloadBlob,
  exportAnimation,
  exportProject,
  projectToSvg,
  supportsWebM,
  type ExportFormat,
} from '@/lib/export'
import { useStore } from '@/lib/state/useStore'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import {
  Download,
  Copy,
  ImageIcon,
  FileCode2,
  Film,
  FileJson,
  Check,
  AlertTriangle,
} from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
}

const FORMATS: { value: ExportFormat; label: string; icon: React.ReactNode; hint: string }[] = [
  { value: 'png', label: 'PNG', icon: <ImageIcon className="h-3.5 w-3.5" />, hint: 'lossless, keeps alpha' },
  { value: 'jpg', label: 'JPG', icon: <ImageIcon className="h-3.5 w-3.5" />, hint: 'smaller, no alpha' },
  { value: 'webp', label: 'WebP', icon: <ImageIcon className="h-3.5 w-3.5" />, hint: 'modern, alpha' },
  { value: 'svg', label: 'SVG', icon: <FileCode2 className="h-3.5 w-3.5" />, hint: 'true vector' },
  { value: 'json', label: 'JSON', icon: <FileJson className="h-3.5 w-3.5" />, hint: 'project file' },
  { value: 'webm', label: 'WebM', icon: <Film className="h-3.5 w-3.5" />, hint: '4s looping motion' },
]

export function ExportDialog({ open, onOpenChange }: Props) {
  const project = useStore((s) => s.project)
  const results = useStore((s) => s.results)
  const [format, setFormat] = useState<ExportFormat>('png')
  const [scale, setScale] = useState(2)
  const [quality, setQuality] = useState(0.92)
  const [includeBg, setIncludeBg] = useState(false)
  const [flatten, setFlatten] = useState(false)
  const [seconds, setSeconds] = useState(4)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<{ kind: 'ok' | 'warn'; msg: string } | null>(null)
  const [fallback, setFallback] = useState<{
    title: string
    body: string
    url?: string
    copyLabel?: string
    copy?: () => Promise<boolean>
  } | null>(null)

  // Clear the previous result as soon as the dialog re-opens or the format
  // changes — done while rendering so no stale toast leaks between opens.
  const [prevKey, setPrevKey] = useState(`${open}:${format}`)
  const resetKey = `${open}:${format}`
  if (prevKey !== resetKey) {
    setPrevKey(resetKey)
    if (status) setStatus(null)
    if (fallback) setFallback(null)
    if (progress) setProgress(0)
  }

  // --- dimension guard ---------------------------------------------------
  const px = project.canvas.w * project.canvas.h * scale * scale
  const pxCapped = px > MAX_EXPORT_PIXELS
  const dimCapped = project.canvas.w * scale > MAX_EXPORT_DIM || project.canvas.h * scale > MAX_EXPORT_DIM
  const effScale = pxCapped || dimCapped ? 1 : scale
  const outputW = Math.round(project.canvas.w * effScale)
  const outputH = Math.round(project.canvas.h * effScale)

  const run = async () => {
    if (!results) return
    setBusy(true)
    setStatus(null)
    setFallback(null)
    setProgress(0)
    try {
      if (format === 'webm') {
        const res = await exportAnimation(project, results, {
          seconds,
          fps: 30,
          scale: effScale,
          onProgress: (d, t) => setProgress(Math.round((d / t) * 100)),
        })
        finishDownload(res.blob, res.filename, {
          title: 'Save the animation',
          body: 'Automatic downloads are blocked here. Right-click the link and choose “Save link as…”.',
          url: URL.createObjectURL(res.blob ?? new Blob()),
        })
        setStatus({
          kind: 'ok',
          msg: `WebM ${outputW}×${outputH} · ${res.warnings.join(' ') || 'ready'}`.trim(),
        })
        return
      }

      const res = await exportProject(project, results, {
        format,
        scale: effScale,
        quality,
        includeBackground: includeBg,
        flattenAdditive: flatten,
      })

      if (res.blob) {
        const ok = downloadBlob(res.blob, res.filename)
        if (!ok) {
          setFallback({
            title: 'Save the file manually',
            body: 'This page blocked the download. Right-click the link below and choose “Save link as…”.',
            url: URL.createObjectURL(res.blob),
            copyLabel: 'Copy filename',
            copy: () => copyText(res.filename),
          })
        }
        setStatus({
          kind: res.warnings.length ? 'warn' : 'ok',
          msg:
            `${res.filename} · ${fmtBytes(res.bytes)}` +
            (res.warnings.length ? ` · ${res.warnings.join(' ')}` : ''),
        })
      } else if (res.svg) {
        // SVG: give both a download attempt and a copy button
        const blob = new Blob([res.svg], { type: 'image/svg+xml' })
        const ok = downloadBlob(blob, res.filename)
        if (!ok) {
          setFallback({
            title: 'SVG source',
            body: 'Download was blocked — copy the markup below, or right-click the link and save it.',
            url: URL.createObjectURL(blob),
            copyLabel: 'Copy SVG code',
            copy: () => copyText(res.svg ?? ''),
          })
        }
        setStatus({ kind: 'ok', msg: `${res.filename} · ${fmtBytes(res.bytes)} · vector` })
      } else if (res.json) {
        const blob = new Blob([res.json], { type: 'application/json' })
        const ok = downloadBlob(blob, res.filename)
        if (!ok) {
          setFallback({
            title: 'Project JSON',
            body: 'Download was blocked — copy it below or save the link.',
            url: URL.createObjectURL(blob),
            copyLabel: 'Copy JSON',
            copy: () => copyText(res.json ?? ''),
          })
        }
        setStatus({ kind: 'ok', msg: `${res.filename} · ${fmtBytes(res.bytes)}` })
      }
    } catch (err) {
      setStatus({ kind: 'warn', msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const finishDownload = (
    blob: Blob | undefined,
    filename: string,
    fb: { title: string; body: string; url?: string; copyLabel?: string; copy?: () => Promise<boolean> },
  ) => {
    if (!blob) return
    if (!downloadBlob(blob, filename)) setFallback(fb)
  }

  const copySource = async () => {
    if (!results) return
    if (format === 'svg') {
      const { svg } = projectToSvg(project, results, { flattenAdditive: flatten })
      const ok = await copyText(svg)
      setStatus({ kind: ok ? 'ok' : 'warn', msg: ok ? 'SVG copied to clipboard' : 'Copy blocked' })
      return
    }
    if (format === 'json') {
      const ok = await copyText(JSON.stringify(project, null, 2))
      setStatus({ kind: ok ? 'ok' : 'warn', msg: ok ? 'JSON copied to clipboard' : 'Copy blocked' })
      return
    }
    // raster → copy the image bitmap
    setBusy(true)
    try {
      const res = await exportProject(project, results, {
        format,
        scale: effScale,
        quality,
        includeBackground: includeBg,
        flattenAdditive: flatten,
      })
      if (res.blob) {
        const ok = await copyImage(res.blob)
        setStatus({
          kind: ok ? 'ok' : 'warn',
          msg: ok ? `${format.toUpperCase()} copied as an image` : 'Clipboard image copy blocked',
        })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>
            The preview and the file come from the same IR, so what you see is what you export.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* format */}
          <div>
            <Label className="mb-1.5 block">Format</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {FORMATS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFormat(f.value)}
                  disabled={f.value === 'webm' && !supportsWebM()}
                  className={`flex flex-col items-start gap-0.5 rounded-md border p-2 text-left transition-colors disabled:opacity-40 ${
                    format === f.value
                      ? 'border-primary bg-primary/10'
                      : 'hover:bg-accent'
                  }`}
                >
                  <span className="flex items-center gap-1 text-xs font-semibold">
                    {f.icon} {f.label}
                  </span>
                  <span className="text-[9px] leading-tight text-muted-foreground">{f.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* scale */}
          {format !== 'json' && (
            <div className="grid grid-cols-2 items-end gap-3">
              <div>
                <Label className="mb-1.5 block">Scale</Label>
                <div className="flex gap-1">
                  {[1, 2, 4].map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={scale === s ? 'default' : 'outline'}
                      className="flex-1"
                      onClick={() => setScale(s)}
                    >
                      {s}×
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <Label htmlFor="fname" className="mb-1.5 block">
                  Output size
                </Label>
                <div className="flex h-8 items-center rounded-md border bg-muted/50 px-2 text-xs tabular-nums">
                  {outputW} × {outputH}
                  {(pxCapped || dimCapped) && (
                    <Badge variant="warning" className="ml-auto">
                      clamped
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          )}

          {(pxCapped || dimCapped) && (
            <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] leading-snug">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              Above the safety cap ({MAX_EXPORT_DIM}px per edge, {MAX_EXPORT_PIXELS / 1e6} MP).
              Falling back to 1× so the browser doesn’t silently drop the file.
            </p>
          )}

          {/* toggles */}
          <div className="space-y-2 rounded-lg border p-2.5">
            {format !== 'json' && (
              <Row
                id="inc-bg"
                label="Include background"
                hint="Off = transparent PNG/JPG/WebP."
                checked={includeBg}
                onChange={setIncludeBg}
              />
            )}
            {format === 'svg' && (
              <Row
                id="flatten"
                label="Flatten additive glow"
                hint="Emits `screen` instead of `plus-lighter` for strict SVG rasterisers."
                checked={flatten}
                onChange={setFlatten}
              />
            )}
            {format === 'webm' && (
              <div className="grid grid-cols-[1fr_72px] items-center gap-2">
                <div>
                  <Label htmlFor="secs" className="text-xs">
                    Loop length
                  </Label>
                  <p className="text-[10px] text-muted-foreground">Seconds, at 30 fps.</p>
                </div>
                <Input
                  id="secs"
                  type="number"
                  min={1}
                  max={12}
                  value={seconds}
                  onChange={(e) => setSeconds(Math.max(1, Math.min(12, Number(e.target.value))))}
                  className="h-7 text-right text-xs"
                />
              </div>
            )}
            {format !== 'json' && (
              <div className="grid grid-cols-[1fr_72px] items-center gap-2">
                <div>
                  <Label htmlFor="q" className="text-xs">
                    Quality
                  </Label>
                  <p className="text-[10px] text-muted-foreground">
                    JPG / WebP only.
                  </p>
                </div>
                <Input
                  id="q"
                  type="number"
                  min={0.3}
                  max={1}
                  step={0.02}
                  value={quality}
                  onChange={(e) => setQuality(Math.max(0.3, Math.min(1, Number(e.target.value))))}
                  className="h-7 text-right text-xs"
                />
              </div>
            )}
          </div>

          {progress > 0 && busy && <Progress value={progress} className="h-1.5" />}

          {status && (
            <p
              className={`flex items-start gap-1.5 rounded-md border p-2 text-[11px] ${
                status.kind === 'ok'
                  ? 'border-success/40 bg-success/10 text-success'
                  : 'border-warning/40 bg-warning/10'
              }`}
            >
              {status.kind === 'ok' ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              )}
              {status.msg}
            </p>
          )}

          {fallback && <FallbackBox key={fallback.body} {...fallback} />}
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={copySource} disabled={busy}>
            <Copy /> Copy {format === 'png' || format === 'jpg' || format === 'webp' ? 'image' : 'code'}
          </Button>
          <Button onClick={run} disabled={busy || !results} className="min-w-32">
            <Download /> {busy ? 'Working…' : 'Export'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Row({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="cursor-pointer text-xs">
          {label}
        </Label>
        <p className="text-[10px] leading-tight text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function FallbackBox({
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
  const [copied, setCopied] = useState(false)
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

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1048576).toFixed(2)} MB`
}
