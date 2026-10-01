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

async function render(name: string, project: ReturnType<typeof createProject>) {
  const results = []
  for (const layer of activeLayers(project)) results.push(await generateLayer(layer, project))
  const nodes = results.flatMap((r) => r.ir.nodes)
  const ir = buildIR(project.canvas.w, project.canvas.h, nodes)
  const svg = renderSVG(ir, { background: project.canvas.bg })
  writeFileSync(`${outDir}/${name}.svg`, svg)
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

console.log('OK', ir1.stats)
