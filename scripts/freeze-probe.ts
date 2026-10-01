/**
 * freeze-probe.ts — measures UI responsiveness during a slider drag.
 *
 * Run: bun run scripts/freeze-probe.ts
 *
 * Answers one question: how many store subscribers wake per slider tick, and
 * which ones? A component that does not display the edited value should wake
 * zero times. Generation already runs in a Web Worker and the render itself is
 * cheap (see docs/limitations.md), so the freeze was never compute — it was
 * every component re-rendering because they all selected the whole `project`
 * object, whose identity changes on every commit.
 *
 * This is a diagnostic, not a gate: it prints a table and exits non-zero only if
 * a component that does not display params wakes more than `TOLERANCE` times.
 */

import { useProjectStore } from '../src/store/projectStore'
import { createProject } from '../src/lib/project'

/** Subscribers allowed to wake: these render the value being edited. */
const ALLOWED_TO_WAKE = new Set(['Inspector: selected layer'])

interface Probe {
  name: string
  select: (s: ReturnType<typeof useProjectStore.getState>) => unknown
  /** true when the component legitimately displays a changed param */
  rendersParams: boolean
}

/**
 * Mirrors the real selectors, so this stays honest as components change. Keep in
 * sync with the components listed here.
 */
const PROBES: Probe[] = [
  { name: 'TopBar: seed / canvas', select: (s) => `${s.project.seed}:${s.project.canvas.w}`, rendersParams: false },
  { name: 'ProjectStrip: name / canvas', select: (s) => `${s.project.name}:${s.project.canvas.w}x${s.project.canvas.h}`, rendersParams: false },
  { name: 'SettingsDialog: canvas+motion', select: (s) => `${s.project.canvas.w}:${JSON.stringify(s.project.motion)}`, rendersParams: false },
  { name: 'ExportDialog: canvas', select: (s) => `${s.project.canvas.w}x${s.project.canvas.h}`, rendersParams: false },
  { name: 'GalleryDialog: name / seed', select: (s) => `${s.project.name}:${s.project.seed}`, rendersParams: false },
  // shallow-compared projection: the layer panel renders names, swatches and
  // toggles, never params
  {
    name: 'LayerPanel: layer summaries (shallow)',
    select: (s) =>
      s.project.layers
        .map((l) =>
          [l.id, l.name, l.gen, l.visible, l.solo, l.locked, l.blend, l.opacity, l.groupId, l.offset?.x ?? 0, l.offset?.y ?? 0, l.color.palette.colors.join(',')].join(':'),
        )
        .join('|'),
    rendersParams: false,
  },
  {
    name: 'Inspector: selected layer',
    select: (s) => s.project.layers.find((l) => l.id === s.selectedLayerId) ?? null,
    rendersParams: true,
  },
  { name: 'Preview: layers.length', select: (s) => s.project.layers.length, rendersParams: false },
]

const TICKS = 20

function run(): { name: string; wakes: number; rendersParams: boolean }[] {
  const p = createProject({ seed: 3, layers: ['smoke', 'grain', 'particles'] })
  useProjectStore.setState({
    project: p,
    selectedLayerId: p.layers[0].id,
    past: [],
    future: [],
    version: 1,
  })

  const counts = PROBES.map(() => 0)
  const unsubs = PROBES.map((probe, i) => {
    let last = probe.select(useProjectStore.getState())
    return useProjectStore.subscribe(() => {
      const next = probe.select(useProjectStore.getState())
      // mirrors React's Object.is bail-out in useSyncExternalStore
      if (Object.is(next, last)) return
      last = next
      counts[i]++
    })
  })

  const id = p.layers[0].id
  for (let i = 0; i < TICKS; i++) {
    useProjectStore.getState().updateLayer(id, (l) => ({
      ...l,
      params: { ...l.params, sizeMin: i / 100 },
    }))
  }

  for (const un of unsubs) un()
  return PROBES.map((probe, i) => ({
    name: probe.name,
    wakes: counts[i],
    rendersParams: probe.rendersParams,
  }))
}

const results = run()

console.log(`slider drag: ${TICKS} ticks on one layer's params\n`)
console.log('  wakes  verdict  subscriber')
let noisy = 0
for (const r of results) {
  // A component that does not render params should not wake at all; one that
  // does may wake once per tick. One wake of slack for the initial commit.
  const bad = r.rendersParams ? r.wakes > TICKS : r.wakes > 1
  if (bad) noisy++
  console.log(
    `  ${String(r.wakes).padStart(5)}  ${bad ? '  JANK' : '    ok'}  ${r.name}` +
      (r.rendersParams && ALLOWED_TO_WAKE.has(r.name) ? '  (expected)' : ''),
  )
}

const total = results.reduce((n, r) => n + r.wakes, 0)
console.log(`\ntotal subscriber wakes across the drag: ${total}`)
console.log(noisy === 0 ? 'PASS — no component re-renders for a param it does not show' : `FAIL — ${noisy} component(s) re-render unnecessarily`)
if (noisy > 0) process.exitCode = 1