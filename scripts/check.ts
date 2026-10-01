/**
 * Headless engine check: renders every generator + a full project to SVG.
 * Run: bun run scripts/check.ts
 */
import { createProject, createLayer } from '../src/lib/project'
import { generateLayer, activeLayers } from '../src/lib/pipeline'
import { buildIR } from '../src/lib/ir'
import { renderSVG } from '../src/lib/render/svg'
import { GENERATORS } from '../src/lib/generators'
import { writeFileSync, mkdirSync } from 'node:fs'

const outDir = '/tmp/opencode/fx-forge'
mkdirSync(outDir, { recursive: true })

/**
 * Portability guard. These are constructs browsers accept but strict SVG
 * renderers (Inkscape, resvg, librsvg, Illustrator) silently mishandle. They
 * cost a black or flat image with no error anywhere, so they must fail loudly
 * rather than ship.
 */
let portableFailures = 0
function checkPortable(name: string, svg: string) {
  const bad: string[] = []
  if (/="rgba\(/.test(svg)) bad.push('rgba() in a presentation attribute renders black in Inkscape/resvg')
  if (/="hsl\(/.test(svg)) bad.push('hsl() in a presentation attribute')
  if (/mix-blend-mode="plus-lighter"/.test(svg))
    bad.push('plus-lighter as a presentation attribute — strict renderers drop the blend')
  if (/style="[^"]*mix-blend-mode/.test(svg))
    bad.push('mix-blend-mode in style="" — use the presentation attribute')
  if (bad.length) {
    portableFailures++
    for (const b of bad) console.log(`  !! ${name}: ${b}`)
  }
}

async function render(name: string, project: ReturnType<typeof createProject>) {
  const results = []
  for (const layer of activeLayers(project)) results.push(await generateLayer(layer, project))
  const nodes = results.flatMap((r) => r.ir.nodes)
  const ir = buildIR(project.canvas.w, project.canvas.h, nodes)
  const svg = renderSVG(ir, { background: project.canvas.bg })
  writeFileSync(`${outDir}/${name}.svg`, svg)
  checkPortable(name, svg)
  console.log(
    `${name.padEnd(18)} nodes=${String(ir.stats.count).padStart(6)} ` +
      `blurs=${String(ir.stats.blurs).padStart(5)} bytes=${String(svg.length).padStart(7)} ` +
      `ms=${results.map((r) => r.ms).join('/')}`,
  )
  return ir
}

console.log('— every generator —')
for (const gen of GENERATORS) {
  const p = createProject({ seed: 777, layers: [] })
  p.layers = [createLayer(gen.id, 777)]
  p.canvas.bg = { kind: 'solid', color: '#101014' }
  try {
    const ir = await render(`gen-${gen.id}`, p)
    if (ir.stats.count === 0) console.log(`  !! ${gen.id} produced ZERO nodes`)
  } catch (err) {
    console.log(`  !! ${gen.id} threw:`, err)
  }
}

console.log('— projects —')
const p1 = createProject({ seed: 12345 })
const ir1 = await render('starter', p1)
const t = performance.now()
await render('cached', p1)
console.log(`  cached render took ${(performance.now() - t).toFixed(1)}ms`)

console.log('— presets —')
const { PRESETS, buildPreset } = await import('../src/lib/presets')
console.log(`count = ${PRESETS.length}`)
let empty = 0
for (const def of PRESETS) {
  const project = buildPreset(def)
  const results = []
  for (const layer of activeLayers(project)) results.push(await generateLayer(layer, project))
  const count = results.reduce((s, r) => s + r.ir.stats.count, 0)
  if (count === 0) {
    console.log(`  !! ${def.id} produced no primitives`)
    empty++
  }
}
console.log(empty === 0 ? '  all presets render ✓' : `  ${empty} empty presets`)

console.log('— random projects —')
const { randomProject } = await import('../src/lib/randomize')
for (let i = 0; i < 8; i++) {
  const proj = randomProject(1000 + i * 37)
  const results = []
  for (const layer of activeLayers(proj)) results.push(await generateLayer(layer, proj))
  const count = results.reduce((s, r) => s + r.ir.stats.count, 0)
  console.log(
    `  #${i} ${proj.name.padEnd(22)} layers=${proj.layers.length} prims=${String(count).padStart(6)} bg=${proj.canvas.bg.kind}`,
  )
}

console.log('— canvas aspect —')
let aspectFailures = 0
{
  // The lock must pin the canvas exactly, including sizes that are not presets.
  const LOCK = { w: 1234, h: 567 }
  let drifted = 0
  for (let i = 0; i < 200; i++) {
    const p = randomProject(i * 7919 + 1, { canvas: LOCK })
    if (p.canvas.w !== LOCK.w || p.canvas.h !== LOCK.h) drifted++
  }
  if (drifted) {
    aspectFailures++
    console.log(`  !! aspect lock: ${drifted}/200 locked rolls changed the canvas size`)
  } else console.log(`  aspect lock holds 200/200 at ${LOCK.w}×${LOCK.h} ✓`)

  // Unlocked rolls must stay inside the curated pool. Two independent w/h pools
  // used to pair up arbitrarily and produced 1920×500 (3.84:1) and similar.
  const pool = new Set(['1080x1080', '1920x1080', '1080x1350', '1080x1920', '1500x500', '1200x1200'])
  const offPool = new Set<string>()
  for (let i = 0; i < 200; i++) {
    const p = randomProject(i * 104729 + 3)
    const k = `${p.canvas.w}x${p.canvas.h}`
    if (!pool.has(k)) offPool.add(k)
  }
  if (offPool.size) {
    aspectFailures++
    console.log(`  !! unlocked rolls produced off-pool sizes: ${[...offPool].join(', ')}`)
  } else console.log('  unlocked rolls stay in the curated pool (200/200) ✓')
}

console.log('— layer placement —')
let placeFailures = 0
{
  // Dragging must never invalidate the layer cache, or every pointer move would
  // regenerate up to 40k primitives.
  const { createProject, createLayer } = await import('../src/lib/project')
  const { generateLayer, composeIR, layerCacheKey } = await import('../src/lib/pipeline')
  const { projectToSvg } = await import('../src/lib/export')
  const { boundsOfNodes, layerBoundsFor } = await import('../src/lib/select')

  const p = createProject({ seed: 11, layers: [] })
  p.canvas = { w: 400, h: 300, bg: { kind: 'transparent' } }
  const base = createLayer('geometric', 1)
  const moved = { ...base, offset: { x: 100, y: 50 } }
  const res = { ...(await generateLayer(base, p)), layerId: base.id }
  const movedProject = { ...p, layers: [moved] }

  const keySame = layerCacheKey(base, p) === layerCacheKey(moved, p)
  if (!keySame) {
    placeFailures++
    console.log('  !! layer.offset changes the cache key — dragging would regenerate')
  } else console.log('  offset leaves the layer cache key intact ✓')

  const b0 = boundsOfNodes(res.ir.nodes)
  const b1 = layerBoundsFor([res], movedProject, moved.id)
  const boxOk =
    !!b0 && !!b1 && Math.abs(b1.x0 - b0.x0 - 100) < 0.01 && Math.abs(b1.y0 - b0.y0 - 50) < 0.01
  if (!boxOk) {
    placeFailures++
    console.log('  !! selection bounds ignore Layer.offset')
  } else console.log('  selection bounds follow the offset ✓')

  // a composed IR already carries tx/ty; adding the offset again would
  // double-count it
  const composed = composeIR(movedProject, [res])
  const bc = boundsOfNodes(composed.nodes)
  const noDouble = !!bc && !!b1 && Math.abs(bc.x0 - b1.x0) < 0.01
  if (!noDouble) {
    placeFailures++
    console.log('  !! offset applied twice to a composed IR')
  } else console.log('  offset is not double-counted on a composed IR ✓')

  const { svg } = projectToSvg(movedProject, [res])
  const stamped = composed.nodes.filter((n) => n.tx === 100 && n.ty === 50).length
  const inSvg = (svg.match(/transform="translate\(100 50\)"/g) ?? []).length
  if (stamped === 0 || inSvg !== stamped) {
    placeFailures++
    console.log(`  !! svg exports ${inSvg} translate() for ${stamped} moved nodes`)
  } else console.log(`  svg export carries all ${inSvg} placements ✓`)
}

console.log('— svg portability —')
if (portableFailures === 0) {
  console.log('  no renderer-hostile constructs ✓')
} else {
  console.log(`  ${portableFailures} file(s) use constructs strict SVG renderers mishandle`)
}

if (portableFailures > 0 || aspectFailures > 0 || placeFailures > 0) {
  console.log('FAILED')
  process.exitCode = 1
}

console.log('OK', ir1.stats)
