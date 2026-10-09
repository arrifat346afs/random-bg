/**
 * canvas-factory.ts — DOM-free canvas creation for the main thread + workers.
 *
 * `export.ts` and `render/canvas.ts` used to call `document.createElement`
 * directly, which ties them to the main thread. The background export worker
 * needs the same code path (same IR → same pixels), so every canvas
 * allocation goes through here: `document` on the main thread,
 * `OffscreenCanvas` inside a worker.
 */

/** Either flavour of 2D canvas the renderers deal with. */
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas

/** The 2D context of either canvas flavour. */
export type Any2D =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D

export function createCanvas(w: number, h: number): AnyCanvas {
  const ww = Math.max(1, Math.round(w))
  const hh = Math.max(1, Math.round(h))
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = ww
    c.height = hh
    return c
  }
  return new OffscreenCanvas(ww, hh)
}

export function get2d(canvas: AnyCanvas, opts?: CanvasRenderingContext2DSettings): Any2D | null {
  try {
    return canvas.getContext('2d', opts) as Any2D | null
  } catch {
    return null
  }
}

/**
 * Encode a canvas to a Blob on either thread.
 *
 * `HTMLCanvasElement.toBlob` is callback-based, `OffscreenCanvas` only has
 * the promise-based `convertToBlob` — this hides the difference. Returns null
 * when the environment cannot encode (mirrors the old `toBlob` behaviour).
 */
export function canvasToBlob(
  canvas: AnyCanvas,
  mime: string,
  quality: number,
): Promise<Blob | null> {
  if (typeof (canvas as OffscreenCanvas).convertToBlob === 'function') {
    try {
      const p = (canvas as OffscreenCanvas).convertToBlob({ type: mime, quality })
      return p.catch(() => null)
    } catch {
      return Promise.resolve(null)
    }
  }
  return new Promise((resolve) => {
    try {
      ;(canvas as HTMLCanvasElement).toBlob((b) => resolve(b), mime, quality)
    } catch {
      resolve(null)
    }
  })
}

/**
 * Data URL for `<image>` embedding / last-resort copy targets.
 *
 * `OffscreenCanvas` has no `toDataURL`, so the worker path goes through an
 * encode + `FileReader` instead. `FileReader` is available in workers.
 */
export async function canvasToDataURL(canvas: AnyCanvas, mime = 'image/png'): Promise<string> {
  if (typeof (canvas as HTMLCanvasElement).toDataURL === 'function') {
    try {
      return (canvas as HTMLCanvasElement).toDataURL(mime)
    } catch {
      return ''
    }
  }
  const blob = await canvasToBlob(canvas, mime, 0.92)
  if (!blob) return ''
  return blobToDataURL(blob)
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    try {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = () => resolve('')
      fr.readAsDataURL(blob)
    } catch {
      resolve('')
    }
  })
}
