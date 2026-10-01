/**
 * mask.ts — Image-mask sampling (the "image-mask" distribution).
 *
 * The user paints a soft gradient on a small canvas; we decode it once into a
 * greyscale buffer and sample it as a rejection mask for *any* generator.
 * Decoding is async, so failures degrade gracefully to `identityMask`.
 */

import type { MaskSampler } from './dist'

export const identityMask: MaskSampler = () => 1

const cache = new Map<string, MaskSampler>()
const pending = new Map<string, Promise<MaskSampler>>()

export const MASK_SIZE = 192

export function getMaskSampler(src: string): Promise<MaskSampler> {
  const cached = cache.get(src)
  if (cached) return Promise.resolve(cached)
  const inflight = pending.get(src)
  if (inflight) return inflight

  const p = decode(src)
    .then((sampler) => {
      if (cache.size > 12) cache.clear()
      cache.set(src, sampler)
      pending.delete(src)
      return sampler
    })
    .catch(() => {
      pending.delete(src)
      return identityMask
    })
  pending.set(src, p)
  return p
}

async function decode(src: string): Promise<MaskSampler> {
  if (typeof document === 'undefined') return identityMask
  const img = new Image()
  img.crossOrigin = 'anonymous'
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('mask image failed to load'))
  })
  img.src = src
  await loaded

  const w = MASK_SIZE
  const h = MASK_SIZE
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) return identityMask
  g.drawImage(img, 0, 0, w, h)
  const data = g.getImageData(0, 0, w, h).data

  // brightness + alpha → 0..1 (transparent = outside the mask)
  const buf = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4]
    const gg = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const a = data[i * 4 + 3] / 255
    const lum = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255
    buf[i] = lum * a
  }

  return (nx, ny) => {
    const x = Math.max(0, Math.min(w - 1, nx * (w - 1)))
    const y = Math.max(0, Math.min(h - 1, ny * (h - 1)))
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.min(w - 1, x0 + 1)
    const y1 = Math.min(h - 1, y0 + 1)
    const fx = x - x0
    const fy = y - y0
    const a = buf[y0 * w + x0]
    const b = buf[y0 * w + x1]
    const c = buf[y1 * w + x0]
    const d = buf[y1 * w + x1]
    const top = a + (b - a) * fx
    const bot = c + (d - c) * fx
    return top + (bot - top) * fy
  }
}

/**
 * Draw a soft radial/linear gradient mask and return a data URL.
 * `kind` is what the mask painter UI requests.
 */
export function renderMaskDataURL(
  kind: 'radial' | 'linear' | 'custom',
  angleDeg = 90,
  custom?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): string {
  const size = MASK_SIZE
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')
  if (!g) return ''
  g.fillStyle = '#000000'
  g.fillRect(0, 0, size, size)
  if (custom) {
    custom(g, size, size)
  } else if (kind === 'radial') {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(0.55, '#9a9a9a')
    grad.addColorStop(1, '#000000')
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)
  } else {
    const a = ((angleDeg - 90) * Math.PI) / 180
    const dx = Math.cos(a) * size
    const dy = Math.sin(a) * size
    const grad = g.createLinearGradient(
      size / 2 - dx / 2,
      size / 2 - dy / 2,
      size / 2 + dx / 2,
      size / 2 + dy / 2,
    )
    grad.addColorStop(0, '#000000')
    grad.addColorStop(0.5, '#8a8a8a')
    grad.addColorStop(1, '#ffffff')
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)
  }
  return c.toDataURL('image/png')
}
