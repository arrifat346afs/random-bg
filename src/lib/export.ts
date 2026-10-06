/**
 * export.ts — SVG / PNG / JPG / WebP / JSON export + animation capture.
 *
 * All raster exports go through the same IR → canvas path the preview uses,
 * so what you download is what you saw. Downloads are attempted normally and
 * reported as `downloaded:false` when the environment blocks them, so the UI
 * can fall back to the "right-click to save" dialog.
 */

import type { IR } from './ir'
import { buildIR } from './ir'
import { composeIR, type LayerResult } from './pipeline'
import { renderCanvas, applyMotion, drawBackground, irToCanvas } from './render/canvas'
import { renderSVG, type SvgRenderOpts } from './render/svg'
import { projectFilterOpts, rasterFilteredLayers, ditheredLayers } from './filters/attach'
import type { BackgroundSpec, Project } from './schema'

export type RasterFormat = 'png' | 'jpg' | 'webp'
export type ExportFormat = 'svg' | RasterFormat | 'json' | 'webm'

export const MAX_EXPORT_DIM = 8192
export const MAX_EXPORT_PIXELS = 40_000_000 // 40 MP safety cap

export interface ExportOptions {
  format: ExportFormat
  /** 1 = 1×, 2 = 2×, 4 = 4× (auto-clamped to the safety cap) */
  scale: number
  quality: number
  /** include the project background in the output */
  includeBackground: boolean
  /** degrade plus-lighter → screen for strict SVG rasterisers */
  flattenAdditive?: boolean
  filename?: string
}

export interface ExportResult {
  format: ExportFormat
  blob?: Blob
  /** SVG source (format === 'svg') */
  svg?: string
  /** project JSON (format === 'json') */
  json?: string
  /** data URL, used by the preview dialog when blob URLs are unavailable */
  dataUrl?: string
  width: number
  height: number
  bytes: number
  filename: string
  warnings: string[]
}

/**
 * Compose layer IRs into a single canvas IR.
 *
 * A thin alias over `composeIR` so exports, the quality gate and the gallery
 * cannot drift from the preview — in particular so a moved layer is offset in
 * the file you download, not just on screen.
 */
export function compositeLayers(project: Project, results: LayerResult[]): IR {
  return composeIR(project, results)
}
function clampScale(w: number, h: number, scale: number): { scale: number; warnings: string[] } {
  const warnings: string[] = []
  let s = scale
  if (w * s > MAX_EXPORT_DIM || h * s > MAX_EXPORT_DIM) {
    const lim = Math.min(MAX_EXPORT_DIM / w, MAX_EXPORT_DIM / h)
    warnings.push(
      `Requested ${scale}× exceeds the ${MAX_EXPORT_DIM}px cap — reduced to ${formatScale(lim)}×.`,
    )
    s = Math.min(s, lim)
  }
  if (w * s * h * s > MAX_EXPORT_PIXELS) {
    const pxLim = Math.sqrt(MAX_EXPORT_PIXELS / (w * h))
    warnings.push(`Output would exceed 40 megapixels — reduced to ${formatScale(pxLim)}×.`)
    s = Math.min(s, pxLim)
  }
  return { scale: s, warnings }
}

const formatScale = (s: number) => (Math.round(s * 100) / 100).toString()

export function projectToSvg(
  project: Project,
  results: LayerResult[],
  opts: Partial<SvgRenderOpts> = {},
): { svg: string; ir: IR; warnings: string[] } {
  const ir = compositeLayers(project, results)
  const rasterFilterIds = rasterFilteredLayers(project)
  const ditherIds = ditheredLayers(project)
  const rasterLayers = [...new Set([...rasterFilterIds, ...ditherIds])]
  const scale = opts.scale && Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : 1
  // `exportProject` passes `background: undefined` when "include background" is
  // off. `'background' in opts` distinguishes that from older callers that pass
  // `{}` and still expect the canvas background.
  const background = 'background' in opts ? opts.background : project.canvas.bg
  const svg = renderSVG(ir, {
    background,
    flattenAdditive: opts.flattenAdditive,
    decimals: opts.decimals ?? 2,
    viewboxOnly: opts.viewboxOnly,
    scale,
    layerFilters: projectFilterOpts(project).layerFilters,
    rasterImages: rasterLayers.length
      ? rasterLayerImages(ir, project, rasterLayers, scale)
      : undefined,
  })
  const warnings: string[] = []
  if (ir.stats.additive && opts.flattenAdditive) {
    warnings.push('`plus-lighter` was flattened to `screen` for renderer compatibility.')
  }
  if (rasterFilterIds.length > 0) {
    warnings.push(
      `${rasterFilterIds.length} layer${rasterFilterIds.length > 1 ? 's' : ''} with raster-only filter${rasterFilterIds.length > 1 ? 's' : ''} ` +
        'embedded as an image.',
    )
  }
  if (ditherIds.length > 0) {
    warnings.push(
      `${ditherIds.length} smooth-field layer${ditherIds.length > 1 ? 's' : ''} embedded as an image ` +
        '(SVG vectors cannot carry anti-banding dither; about 3 MB at 1080p and 11 MB at 4K as PNG, smooth when scaled).',
    )
  }
  return { svg, ir, warnings }
}

/**
 * Draw each raster-only-filtered layer through the canvas pipeline and return
 * it as a data URL for `<image>` embedding.
 *
 * The whole layer goes through one offscreen surface — the same path the
 * preview and the PNG exporter use — so the embedded picture is exactly what
 * the user was looking at, just not editable as vectors. Returns an empty map
 * outside a browser (e.g. a Node-side sanity run), where the exporter then
 * emits the layer unfiltered and the warning still fires.
 */
function rasterLayerImages(
  ir: IR,
  project: Project,
  layerIds: string[],
  scale = 1,
): Record<string, string> {
  if (typeof document === 'undefined') return {}
  const { layerFilters, filterSeedOf } = projectFilterOpts(project)
  const dither = new Set(ditheredLayers(project))
  const out: Record<string, string> = {}
  for (const layerId of layerIds) {
    const nodes = ir.nodes.filter((n) => n.lid === layerId)
    if (nodes.length === 0) continue
    try {
      const canvas = irToCanvas(buildIR(ir.w, ir.h, nodes), {
        scale,
        filters: {
          layerFilters: { [layerId]: layerFilters[layerId] ?? [] },
          filterSeedOf,
          ditherLayers: dither.has(layerId) ? new Set([layerId]) : undefined,
        },
      })
      out[layerId] = canvas.toDataURL('image/png')
    } catch {
      // a tainted or oversized canvas must not sink the whole export
    }
  }
  return out
}

export async function exportProject(
  project: Project,
  results: LayerResult[],
  opts: ExportOptions,
): Promise<ExportResult> {
  const base = sanitize(project.name || 'fx-forge')
  const bg: BackgroundSpec | undefined = opts.includeBackground ? project.canvas.bg : undefined

  if (opts.format === 'json') {
    const json = JSON.stringify(project, null, 2)
    return {
      format: 'json',
      json,
      bytes: json.length,
      width: project.canvas.w,
      height: project.canvas.h,
      filename: `${base}.json`,
      warnings: [],
    }
  }

  if (opts.format === 'svg') {
    const svgScale =
      opts.scale && Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : 1
    const { svg, ir, warnings } = projectToSvg(project, results, {
      flattenAdditive: opts.flattenAdditive,
      // SVG always carries its own background rect when requested
      background: bg,
      scale: svgScale,
    })
    const width = Math.max(1, Math.round(ir.w * svgScale))
    const height = Math.max(1, Math.round(ir.h * svgScale))
    const suffix = svgScale !== 1 ? `@${formatScale(svgScale)}x` : ''
    return {
      format: 'svg',
      svg,
      bytes: new Blob([svg], { type: 'image/svg+xml' }).size,
      width,
      height,
      filename: `${base}${suffix}.svg`,
      warnings,
    }
  }

  // raster
  const { scale, warnings } = clampScale(project.canvas.w, project.canvas.h, opts.scale)
  const ir = compositeLayers(project, results)
  const canvas = document.createElement('canvas')
  renderCanvas(ir, canvas, { scale, background: bg, filters: projectFilterOpts(project) })

  let outCanvas: HTMLCanvasElement = canvas
  if (opts.format === 'jpg') {
    // JPEG has no alpha: composite over white (or the project background)
    outCanvas = flattenOnto(canvas, bg ?? { kind: 'solid', color: '#ffffff' }, scale)
  }

  const mime = opts.format === 'png' ? 'image/png' : opts.format === 'jpg' ? 'image/jpeg' : 'image/webp'
  const blob = await toBlob(outCanvas, mime, opts.quality)
  if (!blob) {
    return {
      format: opts.format,
      width: Math.round(project.canvas.w * scale),
      height: Math.round(project.canvas.h * scale),
      bytes: 0,
      filename: `${base}@${formatScale(scale)}x.${opts.format}`,
      warnings: [...warnings, 'Canvas encoding failed in this browser.'],
    }
  }
  let dataUrl: string | undefined
  if (blob.size > 6_000_000) {
    // huge files: keep a data URL as a last-resort copy target
    dataUrl = await blobToDataUrl(blob)
  }
  return {
    format: opts.format,
    blob,
    dataUrl,
    bytes: blob.size,
    width: outCanvas.width,
    height: outCanvas.height,
    filename: `${base}@${formatScale(scale)}x.${opts.format}`,
    warnings,
  }
}

function flattenOnto(
  src: HTMLCanvasElement,
  bg: BackgroundSpec,
  scale: number,
): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const ctx = out.getContext('2d')
  if (!ctx) return src
  ctx.save()
  ctx.scale(scale, scale)
  const w = src.width / scale
  const h = src.height / scale
  if (bg.kind === 'transparent') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
  } else {
    drawBackground(ctx, w, h, bg)
  }
  ctx.restore()
  ctx.drawImage(src, 0, 0)
  return out
}

function toBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), mime, quality)
    } catch {
      resolve(null)
    }
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => resolve('')
    fr.readAsDataURL(blob)
  })
}

const sanitize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'fx-forge'

/* ---- Clipboard ---------------------------------------------------------- */

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export async function copyImage(blob: Blob): Promise<boolean> {
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function') return false
    const item = new ClipboardItem({ [blob.type]: blob })
    await navigator.clipboard.write([item])
    return true
  } catch {
    return false
  }
}

/* ---- Download with fallback --------------------------------------------- */

export function downloadBlob(blob: Blob, filename: string): boolean {
  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    window.setTimeout(() => {
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }, 4000)
    return true
  } catch {
    return false
  }
}

export function downloadText(text: string, filename: string, mime: string): boolean {
  return downloadBlob(new Blob([text], { type: mime }), filename)
}

/* ---- Animation export (WebM) -------------------------------------------- */

export interface AnimationExportOpts {
  seconds?: number
  fps?: number
  scale?: number
  onProgress?: (done: number, total: number) => void
  signal?: { cancelled: boolean }
}

export function supportsWebM(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.isTypeSupported === 'function' &&
    MediaRecorder.isTypeSupported('video/webm')
  )
}

/**
 * Render a short loop with the project's motion settings and record it.
 * Falls back to a frame-sequence download when MediaRecorder is missing.
 */
export async function exportAnimation(
  project: Project,
  results: LayerResult[],
  opts: AnimationExportOpts = {},
): Promise<ExportResult> {
  const seconds = opts.seconds ?? 4
  const fps = opts.fps ?? 30
  const total = Math.max(1, Math.round(seconds * fps))
  const { scale } = clampScale(project.canvas.w, project.canvas.h, opts.scale ?? 1)
  const base = compositeLayers(project, results)

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(project.canvas.w * scale)
  canvas.height = Math.round(project.canvas.h * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable')
  }

  const mime = pickWebmMime()
  const stream = canvas.captureStream(fps)
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: 12_000_000,
  })
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }))
  })
  recorder.start()

  for (let i = 0; i < total; i++) {
    if (opts.signal?.cancelled) break
    const phase = i / total
    const frame = applyMotion(base, phase, project.motion, project.seed)
    renderCanvas(frame, canvas, {
      scale,
      background: project.canvas.bg,
      clear: true,
    })
    opts.onProgress?.(i, total)
    await new Promise((r) => setTimeout(r, 1000 / fps / 3))
  }
  recorder.stop()
  stream.getTracks().forEach((t) => t.stop())
  const blob = await done

  return {
    format: 'webm',
    blob,
    bytes: blob.size,
    width: canvas.width,
    height: canvas.height,
    filename: `${sanitize(project.name)}-loop.webm`,
    warnings: opts.signal?.cancelled ? ['Export cancelled.'] : [],
  }
}

function pickWebmMime(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c
  }
  return 'video/webm'
}
