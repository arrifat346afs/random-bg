/**
 * scripts/banding.ts — banding + dither audit for smooth wallpaper fields.
 *
 * Two halves:
 *  A. dither unit proof (Bun, deterministic): a synthetic 4K smooth ramp is
 *     quantised plain vs with the real `triangularDither`. Banding reads as
 *     long constant runs punctuated by multi-LSB jumps; dither must break the
 *     runs and never add visible grain (flat σ ≤ 0.6).
 *  B. in-page routing proof (see `scripts/_banding.txt`): the flowWaves layer
 *     actually takes the dither road (bytes differ vs plain), renders
 *     deterministically, and preview/export agree structurally.
 *
 * Usage: bun run scripts/banding.ts   (dev server must be up)
 */

import { triangularDither } from '../src/lib/render/dither'

/* ---- A. synthetic ramp --------------------------------------------------- */

const W = 3840
const H = 8
const ramp = new Uint8ClampedArray(W * H * 4)
// float ramp 24..168 (a long calm gradient) then hard quantise = plain 8-bit
for (let x = 0; x < W; x++) {
  const v = Math.round(24 + (144 * x) / (W - 1))
  for (let y = 0; y < H; y++) {
    const o = (y * W + x) * 4
    ramp[o] = v
    ramp[o + 1] = v
    ramp[o + 2] = v
    ramp[o + 3] = 255
  }
}
const dithered = Uint8ClampedArray.from(ramp)
triangularDither(dithered, W, H, 4242)
const dithered2 = Uint8ClampedArray.from(ramp)
triangularDither(dithered2, W, H, 4242)

function runs(buf: Uint8ClampedArray): { maxRun: number; bigSteps: number; maxStep: number } {
  let maxRun = 1
  let run = 1
  let bigSteps = 0
  let maxStep = 0
  for (let x = 1; x < W; x++) {
    const a = buf[(x - 1) * 4]
    const b = buf[x * 4]
    const s = Math.abs(b - a)
    if (s > maxStep) maxStep = s
    if (b === a) {
      run++
      if (run > maxRun) maxRun = run
    } else {
      run = 1
      if (s > 1) bigSteps++
    }
  }
  return { maxRun, bigSteps, maxStep }
}
const plainRuns = runs(ramp)
const dithRuns = runs(dithered)
let detSame = true
for (let i = 0; i < dithered.length; i++) {
  if (dithered[i] !== dithered2[i]) {
    detSame = false
    break
  }
}
// flat noise: constant mid-grey field, stddev must stay invisible
const flat = new Uint8ClampedArray(64 * 64 * 4).fill(128)
for (let i = 3; i < flat.length; i += 4) flat[i] = 255
triangularDither(flat, 64, 64, 7)
let m = 0
for (let i = 0; i < flat.length; i += 4) m += flat[i]
m /= 64 * 64
let va = 0
for (let i = 0; i < flat.length; i += 4) va += (flat[i] - m) * (flat[i] - m)
const flatStd = Math.sqrt(va / (64 * 64))

console.log(`synthetic 4K ramp: plain maxRun=${plainRuns.maxRun} bigSteps=${plainRuns.bigSteps} maxStep=${plainRuns.maxStep}`)
console.log(`synthetic 4K ramp: dithered maxRun=${dithRuns.maxRun} bigSteps=${dithRuns.bigSteps} maxStep=${dithRuns.maxStep}`)
console.log(`dither deterministic=${detSame} flatStd=${flatStd.toFixed(3)}`)

const fails: string[] = []
if (!(dithRuns.maxRun < plainRuns.maxRun)) fails.push('dither did not break constant runs')
// ±1 dither of neighbouring pixels can legitimately differ by 2 (same level
// flipping opposite ways) and by 3 across a level boundary — never more
if (dithRuns.maxStep > 3) fails.push(`dithered step ${dithRuns.maxStep} exceeds the ±1 mechanism ceiling`)
if (dithRuns.bigSteps > W * 0.06) fails.push('dither added jumps on more than 6% of pixels')
if (flatStd > 0.6) fails.push(`flat noise ${flatStd.toFixed(3)} > 0.6`)
if (!detSame) fails.push('dither not deterministic')

const ROOT = import.meta.dir + '/..'
const URL_ = process.env.APP_URL ?? 'http://localhost:5173/'

const proc = Bun.spawn(['bun', 'scripts/cdp-eval.ts', URL_, ROOT + '/scripts/_banding.txt', '12000'], {
  stdout: 'pipe',
  stderr: 'pipe',
  cwd: ROOT,
})
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
])
void stderr
void exitCode

const body = stdout.split('--- console ---')[0].trim()
if (!body || body.startsWith('ERROR') || body.startsWith('TIMEOUT')) {
  console.error('banding: in-page run failed')
  console.error(body.slice(0, 1000))
  process.exit(1)
}
const d = JSON.parse(body) as {
  w: number
  h: number
  nodes: number
  bytesDiffer: boolean
  deterministic: boolean
  meanFull: number
  meanHalf: number
}

console.log(`4K render ${d.w}x${d.h}, ${d.nodes} nodes`)
console.log(`routing: dithered-vs-plain bytes differ=${d.bytesDiffer}`)
console.log(`deterministic=${d.deterministic} meanFull=${d.meanFull} meanHalf=${d.meanHalf}`)

if (!d.bytesDiffer) fails.push('dither road did not change any pixel (routing broken)')
if (!d.deterministic) fails.push('renders differ byte-for-byte')
if (Math.abs(d.meanFull - d.meanHalf) > 1.5) fails.push('preview/export means disagree')
for (const f of fails) console.log(`  FAIL ${f}`)
console.log(fails.length ? 'RESULT: FAIL' : 'RESULT: PASS')
process.exit(fails.length ? 1 : 0)
