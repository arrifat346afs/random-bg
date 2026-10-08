/**
 * scene3d/math.ts — Minimal vec3 helpers for the 3D scene core.
 *
 * Plain `{x,y,z}` objects, no classes, no allocation games that matter at
 * these counts. Pure TypeScript, no DOM.
 */

export interface V3 {
  x: number
  y: number
  z: number
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z })

export const sub = (a: V3, b: V3): V3 => v3(a.x - b.x, a.y - b.y, a.z - b.z)

export const scale = (a: V3, k: number): V3 => v3(a.x * k, a.y * k, a.z * k)

export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z

export const cross = (a: V3, b: V3): V3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)

export const len = (a: V3): number => Math.hypot(a.x, a.y, a.z)

export const norm = (a: V3): V3 => {
  const l = len(a) || 1
  return v3(a.x / l, a.y / l, a.z / l)
}

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export const deg = (d: number): number => (d * Math.PI) / 180
