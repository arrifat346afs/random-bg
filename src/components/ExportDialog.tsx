import {
  MAX_EXPORT_DIM,
  MAX_EXPORT_PIXELS,
  copyImage,
  copyText,
  projectToSvg,
  type ExportFormat,
} from '@/lib/export'
import { renderExportBlob } from '@/lib/export-run'
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
import { Separator } from '@/components/ui/separator'
import { Copy, Check, AlertTriangle, FolderOpen } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useRenderStore } from '@/store/renderStore'
import { useUiStore } from '@/store/uiStore'
import {
  disconnectExportRoot,
  folderNameFor,
  pickExportRoot,
  reconnectExportRoot,
  refreshExportFolder,
} from '@/lib/export-folder'
import { rasterFilteredLayers } from '@/lib/filters/attach'
import { checkStockSvg, stockPasses } from '@/lib/render/stock-check'
import { toStockIR } from '@/lib/render/stock'
import { FormatPicker } from './export/FormatPicker'
import { Row } from './export/Row'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function ExportDialog({ open, onOpenChange }: Props) {
  // Only the canvas dimensions are *rendered*. Everything else needs the whole
  // project, but only inside event handlers, so those read it through
  // getState() rather than subscribing — otherwise a param edit elsewhere
  // re-renders this dialog on every tick.
  const canvas = useProjectStore((s) => s.project.canvas)
  const project = () => useProjectStore.getState().project
  const results = useRenderStore((s) => s.results)
  const format = useUiStore((s) => s.exportFormat)
  const scale = useUiStore((s) => s.exportScale)
  const quality = useUiStore((s) => s.exportQuality)
  const includeBg = useUiStore((s) => s.exportIncludeBg)
  const flatten = useUiStore((s) => s.exportFlatten)
  const adobeCompat = useUiStore((s) => s.exportAdobeCompat)
  const includeBlur = useUiStore((s) => s.exportIncludeBlur)
  const blurBanned = useProjectStore((s) => s.project.noBlur ?? false)
  const seconds = useUiStore((s) => s.exportSeconds)
  const busy = useUiStore((s) => s.exportBusy)
  const status = useUiStore((s) => s.exportStatus)
  const epoch = useUiStore((s) => s.exportEpoch)
  const projectName = useProjectStore((s) => s.project.name)
  const folderName = useUiStore((s) => s.exportFolderName)
  const folderState = useUiStore((s) => s.exportFolderState)
  const [folderBusy, setFolderBusy] = useState(false)
  const setFormat = (f: ExportFormat) => useUiStore.getState().patchExport({ exportFormat: f })
  const setScale = (n: number) => useUiStore.getState().patchExport({ exportScale: n })
  const setQuality = (n: number) => useUiStore.getState().patchExport({ exportQuality: n })
  const setIncludeBg = (n: boolean) =>
    useUiStore.getState().patchExport({ exportIncludeBg: n })
  const setFlatten = (n: boolean) => useUiStore.getState().patchExport({ exportFlatten: n })
  const setAdobeCompat = (n: boolean) => useUiStore.getState().patchExport({ exportAdobeCompat: n })
  const setIncludeBlur = (n: boolean) =>
    useUiStore.getState().patchExport({ exportIncludeBlur: n })
  const setSeconds = (n: number) => useUiStore.getState().patchExport({ exportSeconds: n })
  const setBusy = (n: boolean) => useUiStore.getState().patchExport({ exportBusy: n })
  const setStatus = (v: { kind: 'ok' | 'warn'; msg: string } | null) =>
    useUiStore.getState().patchExport({ exportStatus: v })

  // Re-read the remembered folder whenever the dialog opens — permission may
  // have lapsed since the last visit, and only a gesture may ask again.
  useEffect(() => {
    if (!open) return
    void refreshExportFolder().then(({ state, name }) => {
      useUiStore.getState().setExportFolder(name, state)
    })
  }, [open ])

  const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'

  const chooseFolder = async (reconnect: boolean) => {
    setFolderBusy(true)
    try {
      const picked = reconnect ? await reconnectExportRoot() : await pickExportRoot()
      useUiStore.getState().setExportFolder(picked.name, 'ready')
      setStatus({ kind: 'ok', msg: `Exports will save into ${picked.name}/ — one folder per project.` })
    } catch (err) {
      // Cancelling the picker is not an error worth reporting.
      if (!isAbort(err)) setStatus({ kind: 'warn', msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setFolderBusy(false)
    }
  }

  const dropFolder = async () => {
    setFolderBusy(true)
    try {
      await disconnectExportRoot()
      useUiStore.getState().setExportFolder(null, 'disconnected')
    } finally {
      setFolderBusy(false)
    }
  }

  // Clear the previous result as soon as the dialog re-opens or the format
  // changes — done while rendering so no stale toast leaks between opens. The
  // store holds the last epoch, which is this render-phase check's memory.
  const resetKey = `${open}:${format}`
  if (epoch !== resetKey) useUiStore.getState().resetExportTransient(resetKey)

  // --- dimension guard ---------------------------------------------------
  const px = canvas.w * canvas.h * scale * scale
  const pxCapped = px > MAX_EXPORT_PIXELS
  const dimCapped = canvas.w * scale > MAX_EXPORT_DIM || canvas.h * scale > MAX_EXPORT_DIM
  const effScale = pxCapped || dimCapped ? 1 : scale

  // How many layers will have to be embedded as an image because their stack
  // uses a raster-only filter. Read through getState() and recomputed only when
  // the dialog opens: it is modal, so the stack cannot change while it is up, and
  // subscribing to the layer list would re-render it on every param tick.
  const rasterLayers = useMemo(
    () => (open ? rasterFilteredLayers(project()).length : 0),
    [open],
  )
  const outputW = Math.round(canvas.w * effScale)
  const outputH = Math.round(canvas.h * effScale)
  // Stock check: render the Stock SVG once while the dialog is open (cheap —
  // the Stock path skips all raster embedding) and validate every rule.
  const stockCheck = useMemo(() => {
    if (!open || format !== 'svg' || !results) return null
    try {
      const { svg, ir } = projectToSvg(project(), results, {
        flattenAdditive: true,
        background: includeBg ? project().canvas.bg : undefined,
        scale: effScale,
        adobeCompat: true,
        includeBlur,
      })
      const conv = toStockIR(ir)
      const rules = checkStockSvg(svg, outputW, outputH, 'stock-check.svg')
      return { rules, pass: stockPasses(rules), notes: conv.notes, unfaithful: conv.unfaithful }
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, format, effScale, includeBg, includeBlur, results ? results.length : 0])

  const copySource = async () => {
    if (!results) return
    if (format === 'svg') {
      const { svg } = projectToSvg(project(), results, {
        flattenAdditive: flatten,
        adobeCompat,
        includeBlur,
        background: includeBg ? project().canvas.bg : undefined,
        scale: effScale,
      })
      const ok = await copyText(svg)
      setStatus({ kind: ok ? 'ok' : 'warn', msg: ok ? 'SVG copied to clipboard' : 'Copy blocked' })
      return
    }
    if (format === 'json') {
      const ok = await copyText(JSON.stringify(project(), null, 2))
      setStatus({ kind: ok ? 'ok' : 'warn', msg: ok ? 'JSON copied to clipboard' : 'Copy blocked' })
      return
    }
    if (format === 'webm') {
      setStatus({ kind: 'warn', msg: 'Copy is not supported for animations — download them instead.' })
      return
    }
    // raster → copy the image bitmap. The heavy render runs in the export
    // worker; only the clipboard write stays on the main thread.
    setBusy(true)
    setStatus(null)
    try {
      const res = await renderExportBlob({
        format,
        scale: effScale,
        quality,
        includeBackground: includeBg,
        includeBlur,
        flattenAdditive: flatten,
        adobeCompat,
      })
      if (res.blob) {
        const ok = await copyImage(res.blob)
        setStatus({
          kind: ok ? 'ok' : 'warn',
          msg: ok ? `${format.toUpperCase()} copied as an image` : 'Clipboard image copy blocked',
        })
      } else {
        setStatus({ kind: 'warn', msg: 'Export produced no image to copy.' })
      }
    } catch (err) {
      setStatus({ kind: 'warn', msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Export settings</DialogTitle>
          <DialogDescription>
            Remembered automatically. The Export button in the top bar downloads with
            these settings in one click, in the background.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <FormatPicker value={format} onChange={setFormat} />

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

          {format === 'svg' && rasterLayers > 0 && (
            <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] leading-snug">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              {rasterLayers} layer{rasterLayers > 1 ? 's use' : ' uses'} a raster-only filter and
              will be embedded as an image. Everything else stays vector.
            </p>
          )}

          {/* toggles */}
          <div className="space-y-2 rounded-lg border p-2.5">
            {format !== 'json' && format !== 'webm' && (
              <Row
                id="inc-blur"
                label="Include blur"
                hint={
                  blurBanned
                    ? 'Project has blur off (Randomise pool) — exports stay sharp.'
                    : format === 'svg' && adobeCompat
                      ? 'On keeps the Stock vector glow expansion. Off renders sharp.'
                      : 'On matches the canvas blur. Off renders every node sharp.'
                }
                checked={blurBanned ? false : includeBlur}
                onChange={setIncludeBlur}
                disabled={blurBanned}
              />
            )}
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
                hint="On pins `screen` in every renderer. Off still falls back to `screen` outside browsers, so this only costs you true additive glow."
                checked={flatten}
                onChange={setFlatten}
              />
            )}
            {format === 'svg' && (
              <Row
                id="adobe"
                label="Adobe Stock ready (ON by default)"
                hint="Filter-free, blend-free pure vector: blurs become erfc-profile gradients/stacked strokes, blends flatten to normal, grain is dropped, artboard ≥15.5 MP, ASCII filename."
                checked={adobeCompat}
                onChange={setAdobeCompat}
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

          {/* save location */}
          <div className="rounded-lg border p-2.5">
            <div className="mb-1 text-xs font-medium">Save location</div>
            {folderState === 'unsupported' ? (
              <p className="text-[11px] leading-snug text-muted-foreground">
                Folder saving needs Chrome or Edge — other browsers keep downloading
                each file to Downloads as before.
              </p>
            ) : folderState === 'ready' && folderName ? (
              <div>
                <p className="text-[11px] leading-snug">
                  Every export saves into{' '}
                  <span className="font-mono">
                    {folderName}/{folderNameFor(projectName)}/
                  </span>{' '}
                  — the project folder is reused when it exists, created when it doesn’t.
                </p>
                <div className="mt-1.5 flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => void chooseFolder(false)} disabled={folderBusy}>
                    <FolderOpen /> Change…
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void dropFolder()} disabled={folderBusy}>
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : folderState === 'needs-permission' ? (
              <div>
                <p className="text-[11px] leading-snug">
                  Folder <span className="font-mono">{folderName ?? '…'}</span> needs access
                  again before exports can save there.
                </p>
                <div className="mt-1.5">
                  <Button size="sm" variant="outline" onClick={() => void chooseFolder(true)} disabled={folderBusy}>
                    <FolderOpen /> Reconnect
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Pick a folder once (e.g. one inside Downloads) and every export will
                  land in its own project folder there instead of loose in Downloads.
                </p>
                <div className="mt-1.5">
                  <Button size="sm" variant="outline" onClick={() => void chooseFolder(false)} disabled={folderBusy}>
                    <FolderOpen /> Choose folder…
                  </Button>
                </div>
              </div>
            )}
          </div>

          {format === 'svg' && stockCheck && (
            <div className="rounded-lg border p-2.5">
              <div className="mb-1.5 text-xs font-medium">
                Stock check — {stockCheck.pass ? 'pass' : 'fail'}
              </div>
              <ul className="space-y-1">
                {stockCheck.rules.map((r) => (
                  <li key={r.id} className="flex items-start gap-1.5 text-[11px] leading-snug">
                    {r.pass ? (
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    )}
                    <span>
                      <span className="font-medium">{r.label}:</span> {r.detail}
                    </span>
                  </li>
                ))}
              </ul>
              {stockCheck.notes.length > 0 && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">{stockCheck.notes.join(' ')}</p>
              )}
              {stockCheck.unfaithful && (
                <p className="mt-1.5 text-[11px]">
                  This design cannot be converted faithfully (blends/grain flattened) — JPEG keeps the preview
                  look.{' '}
                  <button
                    className="underline"
                    onClick={() => useUiStore.getState().patchExport({ exportFormat: 'jpg' })}
                  >
                    Switch to JPEG
                  </button>
                </p>
              )}
            </div>
          )}

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
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={copySource} disabled={busy || !results}>
            <Copy /> Copy {format === 'png' || format === 'jpg' || format === 'webp' ? 'image' : 'code'}
          </Button>
          <Button onClick={() => onOpenChange(false)} className="min-w-32">
            {busy ? 'Working…' : 'Done'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

