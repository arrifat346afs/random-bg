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

console.log('— svg portability —')
if (portableFailures === 0) {
  console.log('  no renderer-hostile constructs ✓')
} else {
  console.log(`  ${portableFailures} file(s) use constructs strict SVG renderers mishandle`)
  process.exitCode = 1
}

console.log('OK', ir1.stats)
