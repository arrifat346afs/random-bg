/**
 * scripts/profile.ts — CPU-profile a live dev-server session over CDP.
 *
 * Usage: bun run scripts/profile.ts <url> <exprFile> [waitMs] [profileMs]
 *
 * Navigates, evaluates the expression, samples the JS profiler while it runs,
 * then prints the top self-time frames so you can see exactly what is slow.
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5199/'
const exprFile = process.argv[3]
const waitMs = Number(process.argv[4] ?? 3500)
const profileMs = Number(process.argv[5] ?? 8000)
if (!exprFile) throw new Error('usage: profile <url> <exprFile> [waitMs] [profileMs]')

const PORT = 9346
const CHROME = '/usr/bin/google-chrome-stable'
const chrome = Bun.spawn(
  [
    CHROME,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--disable-dev-shm-usage',
    '--force-device-scale-factor=1',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1600,1000',
    'about:blank',
  ],
  { stdout: 'ignore', stderr: 'ignore' },
)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let page: any
for (let i = 0; i < 80; i++) {
  try {
    const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as any[]
    page = list.find((t) => t.type === 'page')
    if (page) break
  } catch {
    /* not up yet */
  }
  await sleep(250)
}
if (!page) throw new Error('chrome debugging endpoint never came up')

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (v: any) => void>()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data as string)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)!(m.error ? { __error: m.error } : m.result)
    pending.delete(m.id)
  }
})
await new Promise((r) => ws.addEventListener('open', r))
const send = (method: string, params: any = {}) =>
  new Promise<any>((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })

await send('Page.enable')
await send('Runtime.enable')
await send('Profiler.enable')
await send('Page.navigate', { url })
await sleep(waitMs)

await send('Profiler.setSamplingInterval', { interval: 500 })
await send('Profiler.start')
const expression = await Bun.file(exprFile).text()
const { result, exceptionDetails } = await send('Runtime.evaluate', {
  expression,
  returnByValue: true,
  awaitPromise: true,
})
if (exceptionDetails) {
  console.log('ERROR:', exceptionDetails.exception?.description ?? exceptionDetails.text)
} else {
  console.log('RESULT:', typeof result.value === 'string' ? result.value : JSON.stringify(result.value))
}
await sleep(profileMs)
const stopped = await send('Profiler.stop')
const profile = stopped.profile
if (!profile) {
  console.log('no profile:', JSON.stringify(stopped))
  process.exit(1)
}

/** hitCount == samples whose top frame was this function == its self time */
const hits = new Map<string, number>()
for (const n of profile.nodes as any[]) {
  const h = n.hitCount ?? 0
  if (!h) continue
  const cf = n.callFrame
  const name = cf.functionName || '(anonymous)'
  const loc = cf.url
    ? `${cf.url.replace(/^https?:\/\/[^/]+/, '')}:${cf.lineNumber + 1}`
    : cf.scriptName
      ? `${cf.scriptName}:${cf.lineNumber + 1}`
      : '(native)'
  const key = `${name}  ${loc}`
  hits.set(key, (hits.get(key) ?? 0) + h)
}
const total = (profile.samples as any[]).length || 1
console.log(`\n${total} samples (≈${((total * 500) / 1000).toFixed(0)} ms) — top self-time frames`)
const top = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 32)
for (const [k, v] of top) console.log(`${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`)

ws.close()
chrome.kill()
await sleep(200)
Bun.spawnSync(['pkill', '-f', `remote-debugging-port=${PORT}`])
