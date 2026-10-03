/**
 * Headless engine check: renders every generator + a full project to SVG.
 * Run: bun run scripts/check.ts
 */
import { createProject, createLayer } from '../src/lib/project'
import { generateLayer, activeLayers } from '../src/lib/pipeline'
import { buildIR } from '../src/lib/ir'
import { renderSVG } from '../src/lib/render/svg'
import { GENERATORS } from '../src/lib/generators'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'

const outDir = '/tmp/opencode/fx-forge'
mkdirSync(outDir, { recursive: true })

/** Canvas size handed to filters whose reach is relative to it. */
const SPREAD_CTX = { width: 400, height: 300 }

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

// Pinned preset ids: dropping or renaming a preset fails the build.
// 38 originals + 8 ribbons + 3 gradient shapes + 4 mosaic = 53.
const EXPECTED_PRESET_IDS = [
  'gold-dust', 'blue-glitter-bokeh', 'fire-embers', 'autumn-leaves-streak',
  'neon-purple-rails', 'sparkle-rain', 'silver-haze', 'sunrise-god-rays',
  'anamorphic-flare', 'emerald-silk-flow', 'confetti-pop', 'winter-snowfall',
  'rose-petal-drift', 'cyan-horizon-grid', 'deep-starfield', 'ember-vortex',
  'film-haze-grain', 'prism-spirograph', 'winter-mountain-bokeh',
  'candy-confetti-rain', 'molten-sparks', 'violet-nebula', 'spiral-galaxy',
  'golden-starburst', 'mint-rings', 'sunset-light-trails', 'aurora-veil',
  'diamond-dust', 'sunset-bokeh-field', 'cosmic-dust-tunnel', 'neon-hex-lattice',
  'gold-leaf-fall', 'smoke-signals', 'liquid-waves', 'rain-on-lens',
  'kaleido-gems', 'sandstorm-dust', 'vapor-bloom',
  'blue-swirl-rings', 'purple-cyan-scurve', 'green-vortex', 'ember-speed-lines',
  'blue-fiber-fan', 'glowing-arrow', 'magenta-ellipse-rings', 'gold-sweep',
  'steel-spheres', 'rainbow-squares', 'tide-columns',
  'coral-triangles', 'teal-navy-mosaic', 'mono-lowpoly', 'pastel-mosaic',
]
let presetIdFailures = 0
{
  const got = new Set(PRESETS.map((d) => d.id))
  for (const id of EXPECTED_PRESET_IDS) {
    if (!got.has(id)) {
      presetIdFailures++
      console.log(`  !! missing expected preset: ${id}`)
    }
  }
  for (const def of PRESETS) {
    if (!EXPECTED_PRESET_IDS.includes(def.id)) {
      presetIdFailures++
      console.log(`  !! unexpected preset (pin the list): ${def.id}`)
    }
  }
  if (presetIdFailures === 0) console.log(`  preset ids pinned ${EXPECTED_PRESET_IDS.length}/${PRESETS.length} ✓`)
}

console.log('— new-generator gates (determinism, limits, extremes) —')
let gateFailures = 0
{
  const { getGenerator } = await import('../src/lib/generators')
  const { createRng, hash32 } = await import('../src/lib/rng')
  const { MAX_PRIMITIVES } = await import('../src/lib/pipeline')
  const hasBadNumber = (nodes: { g: { k: string; d?: string } }[]): boolean => {
    for (const n of nodes) {
      const d = (n.g as { d?: string }).d
      if (typeof d === 'string' && /(NaN|Infinity)/.test(d)) return true
    }
    return false
  }
  for (const genId of ['ribbons', 'gradShapes', 'mosaic']) {
    const gen = getGenerator(genId)
    if (!gen) {
      gateFailures++
      console.log(`  !! ${genId} missing from registry`)
      continue
    }
    const mkCtx = (seed: number) => {
      const p = createProject({ seed, layers: [] })
      const layer = createLayer(genId, seed)
      const salt = layer.salt ?? layer.id
      return {
        p,
        layer,
        ctx: {
          rng: createRng(hash32(seed, salt, layer.seedOffset)),
          w: 1080,
          h: 1080,
          minDim: 1080,
          dist: layer.dist,
          color: { ...layer.color },
          seed: hash32(seed, salt),
        },
      }
    }
    // determinism: same seed → identical node JSON
    const a = mkCtx(4242)
    const b = mkCtx(4242)
    const irA = gen.generate({ ...gen.defaults() }, a.ctx as never)
    const irB = gen.generate({ ...gen.defaults() }, b.ctx as never)
    if (irA.nodes.length === 0) {
      gateFailures++
      console.log(`  !! ${genId} produced ZERO nodes at defaults`)
    } else if (JSON.stringify(irA.nodes) !== JSON.stringify(irB.nodes)) {
      gateFailures++
      console.log(`  !! ${genId} non-deterministic at defaults`)
    } else {
      console.log(`  ${genId} deterministic (${irA.nodes.length} nodes) ✓`)
    }
    // count limits: density at defaults sane, extremes capped
    const dens = gen.density({ ...gen.defaults() })
    if (!(dens > 0) || dens > MAX_PRIMITIVES * 2) {
      gateFailures++
      console.log(`  !! ${genId} density out of range: ${dens}`)
    }
    // parameter extremes: every param at min and max must not throw,
    // must stay finite, and must stay under the layer cap
    for (const def of gen.params) {
      for (const edge of ['min', 'max'] as const) {
        const v = def[edge]
        if (v === undefined || typeof def.default !== 'number') continue
        if (def.type !== 'int' && def.type !== 'float') continue
        try {
          const params = { ...gen.defaults(), [def.key]: v }
          const c = mkCtx(999)
          const ir = gen.generate(params, c.ctx as never)
          if (ir.nodes.length > MAX_PRIMITIVES) {
            gateFailures++
            console.log(`  !! ${genId}.${def.key}=${v} exceeds cap (${ir.nodes.length})`)
          }
          if (hasBadNumber(ir.nodes as never)) {
            gateFailures++
            console.log(`  !! ${genId}.${def.key}=${v} produced NaN/Infinity path data`)
          }
        } catch (err) {
          gateFailures++
          console.log(`  !! ${genId}.${def.key}=${v} threw:`, err)
        }
      }
    }
  }
  if (gateFailures === 0) console.log('  new-generator gates pass ✓')
}

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
  const { maxNodeSpread } = await import('../src/lib/render/reach')

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

  // The selection box is drawn from `renderBounds`, so it is the content box
  // grown by the layer's spread. A canvas big enough that nothing clamps is
  // used here so the offset arithmetic is the only thing under test.
  const big = { ...p, canvas: { w: 2000, h: 1500, bg: { kind: 'transparent' as const } } }
  const movedBig = { ...big, layers: [moved] }
  const spread = maxNodeSpread(res.ir.nodes)
  const b0 = boundsOfNodes(res.ir.nodes)
  const b1 = layerBoundsFor([res], movedBig, moved.id)
  const boxOk =
    !!b0 &&
    !!b1 &&
    Math.abs(b1.x0 - (b0.x0 - spread + 100)) < 0.01 &&
    Math.abs(b1.y0 - (b0.y0 - spread + 50)) < 0.01
  if (!boxOk) {
    placeFailures++
    console.log('  !! selection bounds ignore Layer.offset')
  } else console.log('  selection bounds follow the offset ✓')

  // a composed IR already carries tx/ty; adding the offset again would
  // double-count it
  const composed = composeIR(movedBig, [res])
  const bc = boundsOfNodes(composed.nodes)
  const noDouble = !!bc && !!b1 && Math.abs(bc.x0 - spread - b1.x0) < 0.01
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

console.log('— filter gates —')
let filterFailures = 0
{
  const { FILTERS, getFilter, filterTypes, filtersByGroup, groupLabel } = await import(
    '../src/lib/filters/index'
  )
  const {
    createFilter,
    defaultFilterParams,
    ensureFilters,
    activeFilters,
    stackSpread,
    stackNeedsRaster,
  } = await import('../src/lib/filters/stack')
  const { compileLayerFilter } = await import('../src/lib/filters/svg')
  const { applyFilterStack, meanAbsError, isFiniteImage } = await import('../src/lib/filters/canvas')
  const { layerFilterMap, rasterFilteredLayers } = await import('../src/lib/filters/attach')
  const { FILTER_STACK_PRESETS } = await import('../src/lib/filters/presets')
  const { FILTER_PX_BUDGET, MAX_FILTERED_OPS, HEAVY_STACK_WEIGHT, DEGRADE_STACK_WEIGHT, stackCostWeight, estimateFilterMp, isHeavyStack } = await import(
    '../src/lib/filters/cost'
  )
  const { ensureProjectFilters } = await import('../src/lib/project')
  const { projectToSvg } = await import('../src/lib/export')
  const { composeIR, generateLayer } = await import('../src/lib/pipeline')
  type Params = Record<string, string | number | boolean>
  type Instance = { id: string; type: string; enabled: boolean; params: Params }

  /** Every `<fe…>` element name the SVG 1.1 filter spec defines. */
  const SVG_PRIMITIVES = new Set([
    'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
    'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood',
    'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feImage', 'feMerge',
    'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting',
    'feSpotLight', 'feTile', 'feTurbulence',
  ])
  const bad = (msg: string): void => {
    filterFailures++
    console.log(`  !! ${msg}`)
  }

  /* 1. registry integrity ---------------------------------------------- */
  const seenTypes = new Set<string>()
  for (const def of FILTERS) {
    if (seenTypes.has(def.type)) bad(`duplicate filter type: ${def.type}`)
    seenTypes.add(def.type)
    if (!def.label.trim()) bad(`${def.type}: empty label`)
    if (!def.description.trim()) bad(`${def.type}: empty description`)
    if (!Number.isFinite(def.cost) || def.cost < 1 || def.cost > 10)
      bad(`${def.type}: cost ${def.cost} outside 1–10`)
    if (def.rasterOnly && def.isVectorSafe)
      bad(`${def.type}: rasterOnly with isVectorSafe — export would emit a dead <filter>`)
    const keys = new Set<string>()
    for (const p of def.params) {
      if (keys.has(p.key)) bad(`${def.type}: duplicate param "${p.key}"`)
      keys.add(p.key)
      if (p.default === undefined) bad(`${def.type}.${p.key}: no default`)
      if ((p.type === 'float' || p.type === 'int') && typeof p.default === 'number') {
        if (!Number.isFinite(p.default)) bad(`${def.type}.${p.key}: non-finite default`)
        const lo = p.rand?.min ?? p.min
        const hi = p.rand?.max ?? p.max
        if (lo !== undefined && hi !== undefined) {
          if (lo > hi) bad(`${def.type}.${p.key}: empty range ${lo}–${hi}`)
          // the randomiser clamps into [lo,hi], so the default must live there
          if (p.default < lo || p.default > hi)
            bad(`${def.type}.${p.key}: default ${p.default} outside safe range ${lo}–${hi}`)
        }
      }
    }
    const spread = def.spread?.(defaultFilterParams(def.type), SPREAD_CTX)
    if (spread !== undefined && (!Number.isFinite(spread) || spread < 0))
      bad(`${def.type}: spread ${spread} is not a finite non-negative number`)
  }
  for (const { group, defs } of filtersByGroup()) {
    if (!groupLabel(group).trim()) bad(`group ${group} has no label`)
    if (defs.length === 0) bad(`group ${group} is empty`)
  }
  if (filterFailures === 0)
    console.log(`  registry: ${filterTypes().length} filters across ${filtersByGroup().length} groups ✓`)

  /* 2. per-filter SVG output is valid, portable and deterministic ------- */
  const svgCtx = (i: number) => ({
    filterId: `fx-L${i}`,
    input: i === 0 ? 'SourceGraphic' : `fx-${i - 1}`,
    output: 'fx-out',
    width: 400,
    height: 300,
  })
  const defaultsOf = (type: string): Params => defaultFilterParams(type)
  let svgOk = 0
  let identityByDefault = 0
  for (const def of FILTERS) {
    const params = defaultsOf(def.type)
    const a = def.toSvg(params, svgCtx(0))
    const b = def.toSvg(params, svgCtx(0))
    if (a !== b) bad(`${def.type}: toSvg is not deterministic`)
    if (def.rasterOnly) {
      if (a !== null) bad(`${def.type}: raster-only filter must return null from toSvg`)
      else svgOk++
      continue
    }
    if (a === null) {
      // legitimate: defaults are the identity for a pure colour grade
      identityByDefault++
      continue
    }
    if (!a.startsWith('<') || !a.endsWith('>')) bad(`${def.type}: toSvg is not a single element`)
    if (/rgba\(|hsl\(/.test(a)) bad(`${def.type}: toSvg emits a colour function strict renderers drop`)
    if (/mix-blend-mode/.test(a)) bad(`${def.type}: toSvg emits mix-blend-mode`)
    if (/NaN|Infinity|undefined/.test(a)) bad(`${def.type}: toSvg leaks a non-finite number`)
    for (const [, tag] of a.matchAll(/<(fe[A-Za-z]+)/g)) {
      if (!SVG_PRIMITIVES.has(tag)) bad(`${def.type}: unknown SVG primitive <${tag}>`)
    }
    const opens = (a.match(/<[a-z]/g) ?? []).length
    const closes = (a.match(/<\/[a-z]/g) ?? []).length + (a.match(/\/>/g) ?? []).length
    if (opens !== closes) bad(`${def.type}: unbalanced markup (${opens} open / ${closes} closed)`)
    svgOk++
  }
  if (filterFailures === 0)
    console.log(
      `  svg: ${svgOk} compile (${identityByDefault} identity at defaults), all valid + deterministic ✓`,
    )

  /* 3. per-filter canvas apply is deterministic and non-destructive ----- */
  const W = 48
  const H = 36
  const src = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    src[i * 4] = (i * 7) % 256
    src[i * 4 + 1] = (i * 3) % 256
    src[i * 4 + 2] = (i * 11) % 256
    src[i * 4 + 3] = i % W < W / 2 ? 255 : 96
  }
  const pristine = src.slice()
  let applied = 0
  for (const def of FILTERS) {
    const stack: Instance[] = [
      { id: 'f1', type: def.type, enabled: true, params: defaultsOf(def.type) },
    ]
    const a = applyFilterStack(src, W, H, stack as never, 4242)
    const b = applyFilterStack(src, W, H, stack as never, 4242)
    const drift = meanAbsError(a, b)
    if (!(drift === 0)) bad(`${def.type}: apply is not deterministic (err ${drift.toFixed(4)})`)
    if (meanAbsError(src, pristine) !== 0) bad(`${def.type}: apply mutated its input buffer`)
    if (a.length !== src.length) bad(`${def.type}: apply changed the buffer length`)
    if (!isFiniteImage(a)) bad(`${def.type}: apply produced non-finite pixels`)
    // a filter that widens the image must still report how far it can push
    // pixels, or the canvas offscreen surface clips it
    if (!def.rasterOnly && def.spread && stackSpread(stack as never, SPREAD_CTX) < 0)
      bad(`${def.type}: stackSpread went negative`)
    applied++
  }
  if (filterFailures === 0)
    console.log(`  canvas: ${applied} filters deterministic, non-destructive, finite ✓`)

  /* 4. default params must not damage the image ------------------------ */
  {
    const all = FILTERS.map(
      (d): Instance => ({ id: `d-${d.type}`, type: d.type, enabled: true, params: defaultsOf(d.type) }),
    )
    const every = applyFilterStack(src, W, H, all as never, 7)
    if (every.length !== src.length) bad('full default stack changed the buffer length')
    if (!isFiniteImage(every)) bad('full default stack produced non-finite pixels')
    if (meanAbsError(src, pristine) !== 0) bad('full default stack mutated its input buffer')
    // alpha must stay inside 0–255 (it always does for a ClampedArray, so the
    // real risk is a blown-out opaque result) — check the mean alpha did not run
    let a0 = 0
    let a1 = 0
    for (let i = 0; i < src.length; i += 4) {
      a0 += src[i + 3]
      a1 += every[i + 3]
    }
    const n = src.length / 4
    const drop = a0 / n - a1 / n
    if (drop > 8) bad(`full default stack lost ${drop.toFixed(1)}/255 of mean alpha`)
    // and each filter on its own must not lose more than a quarter of the alpha
    for (const def of FILTERS) {
      const one = applyFilterStack(
        src,
        W,
        H,
        [{ id: 'x', type: def.type, enabled: true, params: defaultsOf(def.type) }] as never,
        7,
      )
      let sa = 0
      let oa = 0
      for (let i = 0; i < src.length; i += 4) {
        sa += src[i + 3]
        oa += one[i + 3]
      }
      if (sa / n - oa / n > 64) bad(`${def.type}: default params drop a quarter of the alpha`)
    }
    if (filterFailures === 0) console.log('  default params are harmless on every filter ✓')
  }

  /* 5. a stack compiles to exactly ONE chained <filter> ----------------- */
  {
    const stack = [
      createFilter('gaussian-blur', { sigmaX: 3, sigmaY: 2 })!,
      createFilter('drop-shadow', { dx: 4, dy: 6, blur: 5 })!,
      createFilter('sepia', { amount: 0.4 })!,
      createFilter('sharpen', { amount: 0.5 })!,
    ]
    const compiled = compileLayerFilter('L-abc', stack as never, 400, 300)
    if (!compiled) {
      bad('a 4-filter vector-safe stack compiled to nothing')
    } else {
      const primitives = (compiled.element.match(/<fe[A-Za-z]+/g) ?? []).length
      if (primitives < 4) bad(`chained 4 filters emitted ${primitives} primitives`)
      if (!/color-interpolation-filters="sRGB"/.test(compiled.element))
        bad('compiled <filter> lost color-interpolation-filters="sRGB" — transparent exports halo')
      if (!compiled.element.includes('in="fx-0"') || !compiled.element.includes('result="fx-0"'))
        bad('primitives are not chained through intermediate results')
      // disabled entries must not reach the chain
      const withOff = compileLayerFilter(
        'L-abc',
        [...(stack as never[]), { ...createFilter('invert')!, enabled: false }],
        400,
        300,
      )
      if (withOff?.element !== compiled?.element) bad('a disabled filter still reached the chain')
      if (filterFailures === 0)
        console.log(`  stack → one <filter>, ${primitives} chained primitives ✓`)
    }

    // raster-only filters never compile — the exporter embeds the layer instead
    const rasterOnly = FILTERS.filter((d) => d.rasterOnly)
    const rasterStack = rasterOnly.map((d) => createFilter(d.type)!)
    if (compileLayerFilter('L-r', rasterStack as never, 400, 300) !== null)
      bad('a raster-only stack compiled to an SVG <filter>')
    for (const d of rasterOnly) {
      if (!stackNeedsRaster([createFilter(d.type)!] as never)) bad(`${d.type}: stackNeedsRaster missed it`)
    }

    // and the emitter turns a pre-rasterised layer into an <image>, not a
    // filtered <g> (this is pure string work, so it is assertable here)
    const { renderSVG } = await import('../src/lib/render/svg')
    const { buildIR, circle } = await import('../src/lib/ir')
    const { rasterId } = { rasterId: 'L-raster' }
    const rasterIr = buildIR(
      120,
      90,
      [circle(30, 30, 12, { k: 'solid', c: '#ff0000' })].map((n) => ({ ...n, lid: rasterId })),
    )
    const emitted = renderSVG(rasterIr, {
      layerFilters: { [rasterId]: [createFilter('chromatic')!] as never },
      rasterImages: { [rasterId]: 'data:image/png;base64,AAAA' },
    })
    if (!emitted.includes('<image')) bad('a raster-only layer did not emit an <image>')
    if (/<g filter=/.test(emitted)) bad('a raster-only layer still emitted a filtered <g>')
    if (/<filter id="fx-/.test(emitted)) bad('a raster-only layer still emitted a <filter>')
    if (!/preserveAspectRatio="none"/.test(emitted))
      bad('the embedded <image> would be letterboxed instead of filling the canvas')
    // without the pre-rasterised bitmap the layer must still render (unfiltered),
    // never disappear
    const withoutImage = renderSVG(rasterIr, {
      layerFilters: { [rasterId]: [createFilter('chromatic')!] as never },
    })
    if (!withoutImage.includes('#ff0000')) bad('a raster-only layer vanished from the export')
    if (filterFailures === 0)
      console.log('  raster-only → <image>, never silently dropped ✓')
  }

  /* 6. filters never leak into a filter-free project -------------------- */
  {
    const base = createProject({ seed: 4242 })
    const clone = () => ensureProjectFilters(structuredClone(base))
    const resultsOf = async (p: ReturnType<typeof createProject>) => {
      const out = []
      for (const layer of p.layers) out.push({ ...(await generateLayer(layer, p)), layerId: layer.id })
      return out
    }

    const plain = clone()
    const results = await resultsOf(plain)
    const plainSvg = projectToSvg(plain, results, {}).svg

    // a raw project (no migration, no `filters` key at all) must match
    const rawJson = JSON.parse(JSON.stringify(base)) as ReturnType<typeof createProject>
    delete (rawJson.layers[0] as Record<string, unknown>).filters
    delete (rawJson.layers[0] as Record<string, unknown>).filtersBypassed
    if (projectToSvg(rawJson, results, {}).svg !== plainSvg)
      bad('an un-migrated filter-free project exported different SVG')

    // an explicitly empty stack must be byte-identical too
    const emptied = clone()
    for (const l of emptied.layers) l.filters = []
    if (projectToSvg(emptied, await resultsOf(emptied), {}).svg !== plainSvg)
      bad('an explicitly empty filter stack changed the SVG')

    // a stack of only-disabled filters is still "no filters" everywhere
    const off = clone()
    for (const l of off.layers) l.filters = [{ ...createFilter('grain')!, enabled: false }]
    if (projectToSvg(off, await resultsOf(off), {}).svg !== plainSvg)
      bad('a stack of disabled filters changed the SVG')
    if (composeIR(off, await resultsOf(off)).nodes.some((n) => n.lid !== undefined))
      bad('disabled filters still stamped Node.lid')

    // and a live stack must stamp `lid` on exactly its own layer's nodes
    const filtered = clone()
    const target = filtered.layers[filtered.layers.length - 1]
    target.filters = [createFilter('grain', { amount: 0.2 })!, createFilter('chromatic')!]
    const filteredResults = await resultsOf(filtered)
    const stamped = composeIR(filtered, filteredResults).nodes.filter((n) => n.lid !== undefined)
    const targetNodes = filteredResults.find((r) => r.layerId === target.id)!.ir.nodes
    if (stamped.length !== targetNodes.length)
      bad(`expected ${targetNodes.length} stamped nodes, got ${stamped.length}`)
    if (stamped.some((n) => n.lid !== target.id)) bad('Node.lid does not match the owning layer')
    if (filterFailures === 0)
      console.log('  filter-free projects render byte-identically ✓')
  }

  /* 7. legacy (pre-filter) project JSON still loads --------------------- */
  {
    // A project exactly as it was saved before filters existed: no `filters`,
    // no `filtersBypassed`, no `masterFilters`.
    const saved = JSON.parse(JSON.stringify(createProject({ seed: 99 }))) as Record<string, unknown>
    const layers = (saved.layers as Array<Record<string, unknown>>).map((l) => {
      const rest = { ...l }
      delete rest.filters
      delete rest.filtersBypassed
      return rest
    })
    delete saved.masterFilters
    const p = ensureProjectFilters({ ...saved, layers } as never)
    const missing = p.layers.filter(
      (l) => !Array.isArray(l.filters) || typeof l.filtersBypassed !== 'boolean',
    )
    if (missing.length) bad(`${missing.length} legacy layer(s) missing filter defaults after migration`)
    if (!Array.isArray(p.masterFilters)) bad('legacy project missing masterFilters after migration')
    if (Object.keys(layerFilterMap(p)).length !== 0)
      bad('legacy project produced a non-empty filter map')
    if (rasterFilteredLayers(p).length !== 0) bad('legacy project marked layers as rasterised')
    for (const l of p.layers) {
      if (activeFilters(l).length !== 0) bad('legacy layer produced active filters')
      if (ensureFilters(l).length !== 0) bad('ensureFilters invented filters')
    }
    if (filterFailures === 0) console.log('  pre-filter project JSON loads unchanged ✓')
  }

  /* 8. stack presets reference real filters, in range ------------------- */
  {
    let checked = 0
    for (const preset of FILTER_STACK_PRESETS) {
      if (!preset.stack.length) bad(`preset "${preset.id}" is empty`)
      for (const entry of preset.stack) {
        const def = getFilter(entry.type)
        if (!def) {
          bad(`preset "${preset.id}" uses unknown filter "${entry.type}"`)
          continue
        }
        const params = { ...defaultsOf(entry.type), ...(entry.params ?? {}) }
        for (const p of def.params) {
          const v = params[p.key]
          if (typeof v !== 'number' || p.type === 'color') continue
          // presets are curated, so they are checked against the slider bounds
          // (what the inspector will actually clamp to) rather than `rand`
          if (p.min !== undefined && v < p.min) bad(`preset "${preset.id}": ${entry.type}.${p.key}=${v} < ${p.min}`)
          if (p.max !== undefined && v > p.max) bad(`preset "${preset.id}": ${entry.type}.${p.key}=${v} > ${p.max}`)
        }
        checked++
      }
    }
    if (filterFailures === 0)
      console.log(`  presets: ${FILTER_STACK_PRESETS.length} stacks, ${checked} filter refs valid ✓`)
  }

  /* 9. the randomiser only draws from the safe list --------------------- */
  {
    const { randomProject } = await import('../src/lib/randomize')
    const unsafe: string[] = []
    let withFilters = 0
    let totalFilters = 0
    for (let i = 0; i < 120; i++) {
      const p = randomProject(0x5eed0000 + i * 7919)
      for (const l of p.layers) {
        const filters = ensureFilters(l)
        if (filters.length) withFilters++
        totalFilters += filters.length
        for (const f of filters) {
          const def = getFilter(f.type)
          if (!def) {
            unsafe.push(`unknown:${f.type}`)
            continue
          }
          // every filter the randomiser uses must survive its own safe range,
          // which is what `resampleFilterStack` clamps into on an evolve walk
          for (const pd of def.params) {
            const v = f.params[pd.key]
            if (typeof v !== 'number' || pd.type === 'color' || pd.type === 'int') continue
            const lo = pd.rand?.min ?? pd.min
            const hi = pd.rand?.max ?? pd.max
            if ((lo !== undefined && v < lo) || (hi !== undefined && v > hi))
              unsafe.push(`${f.type}.${pd.key}=${v}`)
          }
        }
      }
    }
    if (unsafe.length) bad(`randomiser produced out-of-range params: ${[...new Set(unsafe)].join(', ')}`)
    if (totalFilters === 0) bad('the randomiser never adds a filter — projects would look flat')
    if (withFilters === 0) bad('the randomiser never put a filter on any layer')
    if (filterFailures === 0)
      console.log(
        `  randomiser: ${totalFilters} filters over 120 projects, all in safe range ✓`,
      )
  }

  /* 10. cost model stays finite for every stack ------------------------- */
  {
    // every numeric param at its maximum — the pessimistic case the budget
    // model has to survive
    const worstParams = (def: (typeof FILTERS)[number]): Params => {
      const out: Params = {}
      for (const p of def.params) {
        if (typeof p.default !== 'number') {
          out[p.key] = p.default
          continue
        }
        out[p.key] = p.rand?.max ?? p.max ?? p.default
      }
      return out
    }
    const worst = FILTERS.map(
      (d): Instance => ({ id: 'w', type: d.type, enabled: true, params: worstParams(d) }),
    )
    const costOf = (type: string): number => getFilter(type)?.cost ?? 0
    const weight = stackCostWeight(worst, costOf)
    const mp = estimateFilterMp(400 * 300, weight)
    if (!Number.isFinite(weight) || weight <= 0) bad(`stackCostWeight returned ${weight}`)
    if (!Number.isFinite(mp) || mp <= 0) bad(`estimateFilterMp returned ${mp}`)
    if (!(FILTER_PX_BUDGET > 0) || !(MAX_FILTERED_OPS > 0))
      bad('cost budget constants are not positive')
    if (HEAVY_STACK_WEIGHT >= DEGRADE_STACK_WEIGHT)
      bad('the "heavy" badge threshold must sit below the degrade threshold')
    if (!isHeavyStack(weight)) bad(`a 27-filter stack weighs ${weight} and is not flagged heavy`)
    const light = stackCostWeight([createFilter('sepia')!] as never, costOf)
    if (isHeavyStack(light)) bad('a single sepia is flagged heavy')
    // mirrors in render/canvas.ts must not drift
    const canvasSrc = readFileSync('src/lib/render/canvas.ts', 'utf8')
    if (!/FILTER_PX_BUDGET\s*=\s*600_000_000/.test(canvasSrc))
      bad('FILTER_PX_BUDGET drifted from its mirror in render/canvas.ts')
    if (!/MAX_FILTERED_OPS\s*=\s*3500/.test(canvasSrc))
      bad('MAX_FILTERED_OPS drifted from its mirror in render/canvas.ts')
    if (filterFailures === 0)
      console.log(`  cost: worst-case stack weighs ${weight} → ${mp.toFixed(2)} MP est ✓`)
  }
}

console.log('— bounds / clip gates —')
let boundsFailures = 0
{
  const { FILTERS } = await import('../src/lib/filters/index')
  const { createFilter } = await import('../src/lib/filters/stack')
  const {
    renderBounds,
    nodeLocalBounds,
    nodesContentBounds,
    matrixScale,
    surfaceRect,
    clampToCanvas,
    BLUR_SIGMA_SPREAD,
  } = await import('../src/lib/render/reach')
  const { contentBounds, rectContains, maxNodeSpread, deviceBounds } = await import(
    '../src/lib/render/bounds'
  )
  const { fitDownscale } = await import('../src/lib/render/scratch')
  const { compileLayerFilter } = await import('../src/lib/filters/svg')
  const { filterCacheKey } = await import('../src/lib/filters/cache')

  // Filters allowed to declare no `spread`, because they cannot move a pixel
  // outside the content: colour transforms, convolutions confined to the
  // source, and the one glow that is clipped *inward*. Anything else must
  // declare one or its pixels get sliced off at the surface edge.
  const NO_SPREAD_OK = new Set([
    'inner-glow', 'grain', 'pixelate',
    'brightness-contrast', 'hsl', 'grayscale', 'sepia', 'invert',
    'duotone', 'posterize', 'levels',
    'sharpen', 'emboss', 'edge-detect',
  ])
  for (const def of FILTERS) {
    if (!def.spread && !NO_SPREAD_OK.has(def.type)) {
      boundsFailures++
      console.log(`  !! ${def.type} declares no spread — it can move pixels past the surface edge`)
    }
    if (NO_SPREAD_OK.has(def.type) && def.spread) {
      boundsFailures++
      console.log(`  !! ${def.type} declares a spread but is pinned as pixel-stationary`)
    }
  }

  // renderBounds must enclose the geometry for every generator × every filter.
  const CW = 320
  const CH = 240
  let pairs = 0
  for (const gen of GENERATORS) {
    const p = createProject({ seed: 4242, layers: [] })
    p.canvas = { w: CW, h: CH, bg: { kind: 'transparent' } }
    const layer = createLayer(gen.id, 4242)
    p.layers = [layer]
    const res = await generateLayer(layer, p)
    const content = nodesContentBounds(res.ir.nodes)
    if (!content) continue
    // geometry that falls outside the canvas cannot be enclosed by a surface
    // that is clamped to it — so compare against the visible part
    const onCanvas = clampToCanvas(content, CW, CH)
    for (const def of FILTERS) {
      const f = createFilter(def.type)!
      const b = renderBounds(res.ir.nodes, {
        filters: [f],
        width: CW,
        height: CH,
        spreadCtx: { width: CW, height: CH },
      })
      pairs++
      if (!b || !rectContains(b, onCanvas)) {
        boundsFailures++
        console.log(`  !! renderBounds does not contain the geometry: ${gen.id} + ${def.type}`)
      } else if (b.x0 < 0 || b.y0 < 0 || b.x1 > CW || b.y1 > CH) {
        boundsFailures++
        console.log(`  !! renderBounds escaped the canvas: ${gen.id} + ${def.type}`)
      }
    }
  }
  console.log(`  renderBounds encloses the geometry for ${pairs} generator×filter pairs`)

  // A layer's own blur and stroke must survive into its bounds, and a radius
  // must be scaled by the matrix's true scale — `m.a` alone is a projection
  // under rotation, which silently shrank every spread and clipped the layer.
  const blurNode = {
    g: { k: 'rect' as const, x: 100, y: 100, w: 200, h: 200 },
    stroke: { k: 'solid' as const, c: '#fff' },
    sw: 10,
    blur: 8,
  }
  const nb = nodeLocalBounds(blurNode)!
  const wantPad = 8 * BLUR_SIGMA_SPREAD + 10 * 0.5
  if (Math.abs(nb.x0 - (100 - wantPad)) > 1e-6) {
    boundsFailures++
    console.log(`  !! nodeLocalBounds pad is ${nb.x0 - 100}, expected -${wantPad}`)
  }
  const rot = matrixScale({ a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 })
  if (Math.abs(rot - 1) > 1e-9) {
    boundsFailures++
    console.log(`  !! matrixScale under a 90° rotation returned ${rot}, expected 1`)
  }

  // The SVG <filter> region must never be tighter than the canvas surface.
  {
    const nodes = [{ g: { k: 'rect' as const, x: 10, y: 10, w: 40, h: 40 } }]
    const wide = createFilter('gaussian-blur', { sigmaX: 40, sigmaY: 40 })!
    const compiled = compileLayerFilter('L', [wide], 400, 300, nodes)
    const m = compiled ? /width="([\d.]+)"/.exec(compiled.element) : null
    const w = m ? Number(m[1]) : 0
    if (!(w >= 2.2)) {
      boundsFailures++
      console.log(`  !! the SVG filter region is ${w}× the bbox for a σ=40 blur (needs ≥2.2)`)
    }
    if (compileLayerFilter('L', [wide], 400, 300) && !compiled) {
      boundsFailures++
      console.log('  !! compileLayerFilter lost its filter when nodes were supplied')
    }
  }

  // The cached pixels are a device-space surface: a different transform or
  // scale must not reuse them.
  const f = createFilter('gaussian-blur')!
  const base = filterCacheKey('c', [f], 100, 100, 7)
  if (base === filterCacheKey('c', [f], 100, 100, 7, 'scale2')) {
    boundsFailures++
    console.log('  !! filterCacheKey ignores the transform')
  }

  // Reducing quality must shrink the surface, never crop it: a 5k-wide
  // surface at 1/4 is 25 MP, past the 16 MP ceiling, so k has to come down.
  if (fitDownscale(20_000, 20_000, 0.25) >= 0.25) {
    boundsFailures++
    console.log('  !! fitDownscale did not shrink a 25 MP surface')
  }
  if (fitDownscale(100, 100, 0.25) !== 0.25) {
    boundsFailures++
    console.log('  !! fitDownscale changed a surface that already fits')
  }
  // 4k at 1/4 is 8 MP — comfortably inside, so the fast path keeps its speed
  if (fitDownscale(4000, 4000, 0.25) !== 0.25) {
    boundsFailures++
    console.log('  !! fitDownscale needlessly degraded a surface that already fits')
  }

  // A device rect must never leave the canvas.
  const sr = surfaceRect({ x0: -50, y0: -50, x1: 500, y1: 400 }, 400, 300)
  if (!sr || sr.x0 < 0 || sr.y0 < 0 || sr.x1 > 400 || sr.y1 > 300) {
    boundsFailures++
    console.log('  !! surfaceRect escaped the canvas')
  }
  if (surfaceRect({ x0: 10, y0: 10, x1: 10, y1: 10 }, 400, 300) !== null) {
    boundsFailures++
    console.log('  !! surfaceRect accepted a rect with no area')
  }
  void contentBounds
  void deviceBounds
  void maxNodeSpread
  if (boundsFailures === 0) console.log('  every pixel-moving filter declares a spread, and every surface is expanded ✓')
}

console.log('— svg portability —')
if (portableFailures === 0) {
  console.log('  no renderer-hostile constructs ✓')
} else {
  console.log(`  ${portableFailures} file(s) use constructs strict SVG renderers mishandle`)
}

if (
  portableFailures > 0 ||
  aspectFailures > 0 ||
  placeFailures > 0 ||
  presetIdFailures > 0 ||
  gateFailures > 0 ||
  filterFailures > 0 ||
  boundsFailures > 0 ||
  empty > 0
) {
  console.log('FAILED')
  process.exitCode = 1
}

console.log('OK', ir1.stats)
