/**
 * scene3d/camera.ts — Orbit-style perspective camera + projection.
 *
 * World units are canvas pixels. Origin at canvas centre, x right, y DOWN
 * (screen-like), z toward the viewer; the ground plane is z = 0 and heights
 * are positive z. Camera orbits the look-at point: yaw is the azimuth in
 * degrees (0 = camera due "south", looking north/up-screen), pitch is the
 * elevation above the ground in degrees (90 = top-down, ~12 = low oblique),
 * `project` takes WORLD coords (origin at canvas centre, as the generators
 * emit) and returns canvas coords plus a normalised depth (0 at near plane,
 * 1 at far) and the view-space distance for fog.
 * Pure TypeScript, seeded-RNG-free (fully determined by params).
 */

import type { ParamDef } from '../schema'
import { clamp, clamp01, deg, norm, sub, cross, type V3 } from './math'

export interface CamParams {
  yaw: number
  pitch: number
  roll: number
  distance: number
  fov: number
  height: number
  lookX: number
  lookY: number
}

/** Shared camera block; generators spread it into their own param arrays. */
export const CAMERA_PARAMS: ParamDef[] = [
  { key: 'yaw', label: 'Orbit yaw', type: 'float', min: -180, max: 180, step: 1, default: 0, section: 'camera', unit: '°', rand: { min: -40, max: 40 } },
  { key: 'pitch', label: 'Camera pitch', type: 'float', min: 5, max: 85, step: 1, default: 58, section: 'camera', unit: '°', hint: 'Elevation above the ground: 85 top-down, ~12 low oblique.', rand: { min: 18, max: 62 } },
  { key: 'roll', label: 'Roll', type: 'float', min: -30, max: 30, step: 1, default: 0, section: 'camera', unit: '°', rand: { min: -12, max: 12 } },
  { key: 'distance', label: 'Distance', type: 'float', min: 0.6, max: 4, step: 0.05, default: 1.5, section: 'camera', unit: '×', hint: 'Camera distance as a multiple of the canvas diagonal.', rand: { min: 1.0, max: 1.8 } },
  { key: 'fov', label: 'Field of view', type: 'float', min: 20, max: 90, step: 1, default: 46, section: 'camera', unit: '°', rand: { min: 38, max: 58 } },
  { key: 'camHeight', label: 'Camera height', type: 'float', min: -0.5, max: 0.5, step: 0.01, default: 0, section: 'camera', unit: '×', hint: 'Vertical offset as a fraction of canvas height.', rand: { min: -0.2, max: 0.2 } },
  { key: 'lookX', label: 'Look-at X', type: 'float', min: -0.5, max: 0.5, step: 0.01, default: 0, section: 'camera', rand: { min: -0.15, max: 0.15 } },
  { key: 'lookY', label: 'Look-at Y', type: 'float', min: -0.5, max: 0.5, step: 0.01, default: 0.02, section: 'camera', rand: { min: -0.15, max: 0.15 } },
]

export interface Camera {
  w: number
  h: number
  /** focal length in px */
  f: number
  /** reference distance (for perspective size scale) */
  ref: number
  near: number
  far: number
  right: V3
  up: V3
  fwd: V3
  pos: V3
}

export function makeCamera(p: CamParams, w: number, h: number): Camera {
  const diag = Math.hypot(w, h)
  const dist = Math.max(80, p.distance * diag)
  const cp = Math.cos(deg(clamp(p.pitch, 1, 89)))
  const sp = Math.sin(deg(clamp(p.pitch, 1, 89)))
  const cy = Math.cos(deg(p.yaw))
  const sy = Math.sin(deg(p.yaw))
  const look = { x: p.lookX * w, y: p.lookY * h, z: 0 }
  // camera sits toward +y (south) at yaw 0, elevated by pitch
  const pos = {
    x: look.x + dist * cp * sy,
    y: look.y + dist * cp * cy,
    z: look.z + dist * sp + p.height * h,
  }
  const fwd = norm(sub(look, pos))
  const worldUp = { x: 0, y: -1, z: 0 }
  // note the order: world-up × forward keeps screen-right = world +x
  // (the reverse order mirrors the image left-right)
  let right = norm(cross(worldUp, fwd))
  if (!Number.isFinite(right.x)) right = { x: 1, y: 0, z: 0 }
  const up = norm(cross(fwd, right))
  // roll about the view axis
  const cr = Math.cos(deg(p.roll))
  const sr = Math.sin(deg(p.roll))
  const r2 = norm({
    x: right.x * cr + up.x * sr,
    y: right.y * cr + up.y * sr,
    z: right.z * cr + up.z * sr,
  })
  const u2 = norm(cross(r2, fwd))
  const f = h / 2 / Math.tan(deg(clamp(p.fov, 5, 120)) / 2)
  return {
    w, h, f, ref: dist,
    near: Math.max(1, dist - diag * 1.2),
    far: dist + diag * 1.6,
    right: r2, up: u2, fwd, pos,
  }
}

export interface Proj {
  x: number
  y: number
  /** 0 at near plane, 1 at far */
  depth: number
  /** view-space distance in px */
  dist: number
  behind: boolean
}

export function project(cam: Camera, x: number, y: number, z: number): Proj {
  // input is WORLD coords (origin at canvas centre); generators emit those
  const vx = x - cam.pos.x
  const vy = y - cam.pos.y
  const vz = z - cam.pos.z
  const xc = vx * cam.right.x + vy * cam.right.y + vz * cam.right.z
  const yc = vx * cam.up.x + vy * cam.up.y + vz * cam.up.z
  const zc = vx * cam.fwd.x + vy * cam.fwd.y + vz * cam.fwd.z
  if (!(zc > cam.near * 0.15)) {
    return { x: cam.w / 2, y: cam.h / 2, depth: 0, dist: cam.near * 0.15, behind: true }
  }
  return {
    x: cam.w / 2 + (xc / zc) * cam.f,
    y: cam.h / 2 - (yc / zc) * cam.f,
    depth: clamp01((zc - cam.near) / Math.max(1, cam.far - cam.near)),
    dist: zc,
    behind: false,
  }
}
