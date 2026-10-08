/**
 * scenes3d acceptance sweep (bun-only, no DOM).
 * Run: bun scripts/scene3d-check.ts
 * Covers: projection properties, CoC/fog monotonicity, determinism,
 * density honesty, no-white, 200-seed clutter sweep, 3D-tech recipe,
 * serialisation round-trip (undo/redo path).
 */
import { createLayer } from '../src/lib/project'
import { generateLayer, MAX_PRIMITIVES } from '../src/lib/pipeline'
import { getGenerator } from '../src/lib/generators'
import { networkDensityEstimate } from '../src/lib/generators/network/index'
import { surface3dDensityEstimate } from '../src/lib/generators/surface3d/index'
import { renderSVG } from '../src/lib/render/svg'
import { checkStockSvg } from '../src/lib/render/stock-check'
import { toStockIR } from '../src/lib/render/stock'
import { randomProject } from '../src/lib/randomize'
import { createRng, hash32 } from '../src/lib/rng'
import { makeCamera, project } from '../src/lib/scene3d/camera'
import { cocRadius, fogAlpha } from '../src/lib/scene3d/depth'
import type { GenContext } from '../src/lib/schema'

let failures = 0
const bad = (m: string): void => { failures++; console.log(`  !! ${m}`) }

const mkCtx = (genId: string, seed: number, w = 1080, h = 1080, params: Record<string, unknown> = {}): { ctx: GenContext; params: Record<string, unknown> } => {
  const layer = createLayer(genId, seed)
  layer.params = { ...layer.params, ...params }
  const salt = layer.salt ?? layer.id
  return {
    ctx: {
      rng: createRng(hash32(seed, salt, layer.seedOffset)),
      w, h, minDim: Math.min(w, h),
      dist: layer.dist,
      color: { ...layer.color },
      seed: hash32(seed, salt),
    },
    params: layer.params as Record<string, unknown>,
  }
}

const paintsOf = (ir: { nodes: { fill?: unknown; stroke?: unknown; blur?: number; blend?: string }[] }): string[] => {
  const out: string[] = []
  for (const nd of ir.nodes) {
    for (const key of ['fill', 'stroke'] as const) {
      const pl = nd[key] as { k: string; c?: string; stops?: { c: string }[] } | null | undefined
      if (!pl) continue
      if (pl.k === 'solid' && pl.c) out.push(pl.c)
      for (const s of pl.stops ?? []) out.push(s.c)
    }
    if (nd.blur) bad('node carries blur (stock-dirty)')
    if (nd.blend && nd.blend !== 'normal') bad(`node carries blend ${nd.blend}`)
  }
  return out
}

console.log('— projection —')
{
  // perspective must differ from orthographic: equal world steps along the
  // view axis must project to unequal screen gaps (foreshortening)
  const low = makeCamera({ yaw: 0, pitch: 12, roll: 0, distance: 0.85, fov: 55, height: 0, lookX: 0, lookY: 0.02 }, 1080, 1080)
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= 24; i++) pts.push(project(low, 0, 540 - i * 45, 0))
  if (pts.some((p) => (p as { behind?: boolean }).behind)) bad('low-angle preset clips behind camera')
  const gaps: number[] = []
  for (let i = 1; i < pts.length; i++) gaps.push(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  const ratio = Math.max(...gaps) / Math.max(0.01, Math.min(...gaps))
  console.log(`  low-angle near/far cell ratio: ${ratio.toFixed(2)}`)
  if (!(ratio >= 3)) bad(`foreshortening ratio ${ratio.toFixed(2)} < 3:1`)
  // high pitch must still differ across depth (no orthographic collapse)
  const top = makeCamera({ yaw: 0, pitch: 58, roll: 0, distance: 1.9, fov: 46, height: 0, lookX: 0, lookY: 0.02 }, 1080, 1080)
  const d1 = project(top, 0, 300, 0).depth
  const d2 = project(top, 0, -300, 0).depth
  if (!(Math.abs(d1 - d2) > 1e-4)) bad('depth does not vary across the scene')
  else console.log('  depth varies across scene ✓')
}

console.log('— CoC + fog monotonicity —')
{
  // CoC must shrink approaching the focus, then grow past it
  let cocOk = true
  let prev = Infinity
  for (const d of [0, 0.1, 0.2, 0.3, 0.37]) {
    const c = cocRadius(d, 0.45, 0.08, 0.6, 26)
    if (c > prev + 1e-9) cocOk = false
    prev = c
  }
  prev = -1
  for (const d of [0.53, 0.7, 0.85, 1]) {
    const c = cocRadius(d, 0.45, 0.08, 0.6, 26)
    if (c < prev - 1e-9) cocOk = false
    prev = c
  }
  if (cocRadius(0.45, 0.45, 0.08, 0.6, 26) !== 0) cocOk = false
  if (!cocOk) bad('CoC not monotonic in |depth-focus|')
  else console.log('  CoC shrinks to focus, grows past it ✓')
  let fogOk = true
  let fprev = 2
  for (const d of [0, 0.25, 0.5, 0.75, 1]) {
    const f = fogAlpha(d, 0.6)
    if (f > fprev + 1e-9) { fogOk = false; break }
    fprev = f
  }
  if (!fogOk) bad('fog not monotonic in depth')
  else console.log('  fog monotonic ✓')
}

console.log('— determinism —')
for (const genId of ['network', 'surface3d']) {
  const gen = getGenerator(genId)!
  for (const seed of [4242, 777]) {
    const a = mkCtx(genId, seed)
    const b = mkCtx(genId, seed)
    const ia = gen.generate({ ...gen.defaults(), ...a.params }, a.ctx as never)
    const ib = gen.generate({ ...gen.defaults(), ...b.params }, b.ctx as never)
    if (JSON.stringify(ia.nodes) !== JSON.stringify(ib.nodes)) bad(`${genId} non-deterministic seed ${seed}`)
  }
  console.log(`  ${genId} deterministic ✓`)
}

console.log('— density honesty + caps + no-white —')
{
  const cases: [string, Record<string, unknown>][] = [
    ['network', {}],
    ['network', { layout: 'globe', connection: 'gabriel', count: 900, pitch: 20 }],
    ['network', { layout: 'constellation', connection: 'mst', count: 2200, maxEdgeLen: 0.6, maxDegree: 8 }],
    ['surface3d', {}],
    ['surface3d', { structure: 'hex', resolution: 80, pitch: 15 }],
    ['surface3d', { structure: 'contours', resolution: 80 }],
    ['surface3d', { structure: 'dots', resolution: 80, pitch: 12 }],
  ]
  for (const [genId, over] of cases) {
    const gen = getGenerator(genId)!
    for (const seed of [4242, 777]) {
      for (const wh of [[1080, 1080], [1920, 1080]] as const) {
        const { ctx } = mkCtx(genId, seed, wh[0], wh[1], over)
        const full = { ...gen.defaults(), ...over }
        const ir = gen.generate(full, ctx as never)
        const est = genId === 'network' ? networkDensityEstimate(full as never) : surface3dDensityEstimate(full as never)
        const real = ir.nodes.length
        if (real > MAX_PRIMITIVES) bad(`${genId} ${JSON.stringify(over)}: ${real} exceeds cap`)
        if (real === 0) bad(`${genId} ${JSON.stringify(over)}: zero nodes`)
        const err = Math.abs(est - real) / Math.max(1, real)
        if (err > 0.25) bad(`${genId} ${JSON.stringify(over)} seed ${seed}: est ${est} vs real ${real} (${(err * 100).toFixed(1)}%)`)
        if (paintsOf(ir).some((c) => c.toLowerCase() === '#ffffff')) bad(`${genId}: pure-white paint`)
      }
    }
  }
  console.log('  estimates ±25%, under cap, no white/blur/blend ✓')
}

console.log('— 200-seed clutter sweep —')
{
  // edge-density cap: merged segments stay under the segment budget —
  // spaghetti would blow it long before the primitive cap
  let blank = 0
  let cluttered = 0
  for (let i = 0; i < 200; i++) {
    const seed = 5000 + i * 131
    const genId = i % 2 ? 'network' : 'surface3d'
    const gen = getGenerator(genId)!
    const { ctx } = mkCtx(genId, seed)
    const ir = gen.generate({ ...gen.defaults() }, ctx as never)
    const segs = ir.nodes.filter((n) => n.g.k === 'path').reduce((s, n) => s + ((n.g as { d: string }).d.match(/M/g) ?? []).length, 0)
    if (ir.nodes.length === 0) blank++
    if (segs > 12000) cluttered++
  }
  if (blank) bad(`${blank}/200 blank`)
  if (cluttered) bad(`${cluttered}/200 cluttered (>12000 segments)`)
  else console.log('  0 blank, segments within budget ✓')
}

console.log('— stock profile —')
{
  for (const genId of ['network', 'surface3d']) {
    const gen = getGenerator(genId)!
    const { ctx } = mkCtx(genId, 61001)
    const ir = gen.generate({ ...gen.defaults() }, ctx as never)
    const conv = toStockIR(ir)
    if (conv.unfaithful || conv.blurredNodes > 0 || conv.flattenedBlends > 0) {
      bad(`${genId}: stock conversion rewrote nodes`)
    }
    const svg = renderSVG(ir, { background: { kind: 'solid', color: '#040a1c' }, scale: 4, adobeCompat: true })
    const rules = checkStockSvg(svg, 4320, 4320, `${genId}-stock.svg`)
    for (const r of rules) if (!r.pass) bad(`${genId} stock rule ${r.id}: ${r.detail}`)
  }
  if (failures === 0) console.log('  9/9 rules pass, conversion faithful ✓')
}

console.log('— 3D-tech recipe —')
{
  let tech = 0
  let busyViolation = 0
  let badPitch = 0
  const BUSY = new Set(['particles', 'scatter', 'mosaic', 'bokeh'])
  for (let i = 0; i < 500; i++) {
    const proj = randomProject(9000 + i * 37)
    const ids = proj.layers.map((l) => l.gen)
    const is3d = ids.includes('surface3d') || (ids.includes('network') && proj.layers.length <= 3 && ids.every((g) => g === 'network' || g === 'mesh' || g === 'smoke'))
    if (is3d) {
      tech++
      if (ids.some((g) => BUSY.has(g))) busyViolation++
      for (const l of proj.layers) {
        if ((l.gen === 'surface3d' || l.gen === 'network') && typeof l.params.pitch === 'number') {
          if (l.params.pitch < 12 || l.params.pitch > 68) badPitch++
        }
      }
    }
  }
  const rate = tech / 500
  if (busyViolation) bad(`${busyViolation} busy violations`)
  if (badPitch) bad(`${badPitch} unpleasant recipe pitches`)
  // ~12% 3D-tech + ~20% legacy tech-network ≈ 30% combined, plus
  // recipe-shaped direct rolls; accept 12–35%
  if (rate < 0.12 || rate > 0.35) bad(`3D recipe rate ${(rate * 100).toFixed(1)}% outside 12–35% band`)
  console.log(`  recipe rate ${(rate * 100).toFixed(1)}%, 0 busy violations, pleasant pitches ✓`)
}

console.log('— serialisation round-trip (undo/redo path) —')
{
  const { PRESETS, buildPreset } = await import('../src/lib/presets')
  for (const id of ['low-angle-horizon-wave', 'deep-blue-network-cloud', 'cyan-honeycomb-wave']) {
    const def = PRESETS.find((d) => d.id === id)
    if (!def) { bad(`preset missing: ${id}`); continue }
    const project = buildPreset(def)
    const res = await generateLayer(project.layers[0], project)
    const clone = structuredClone(project)
    const res2 = await generateLayer(clone.layers[0], clone)
    if (JSON.stringify(res.ir.nodes) !== JSON.stringify(res2.ir.nodes)) bad(`${id}: clone regenerates differently`)
    if (res.ir.stats.count === 0) bad(`${id}: empty`)
    if (res.truncated) bad(`${id}: truncated`)
  }
  console.log('  clone-stable, non-empty, untruncated ✓')
}

console.log(failures === 0 ? 'SCENE3D-CHECK OK' : `SCENE3D-CHECK FAILED (${failures})`)
process.exitCode = failures === 0 ? 0 : 1
