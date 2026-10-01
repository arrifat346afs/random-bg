/**
 * scripts/cdp-eval.ts — run an expression in the dev-server page via CDP.
 *
 * Usage: bun run scripts/cdp-eval.ts <url> <exprFile> [waitMs]
 * Prints the JSON result (and any console output the expression logs).
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5199/'
const exprFile = process.argv[3]
const waitMs = Number(process.argv[4] ?? 2500)
if (!exprFile) throw new Error('usage: cdp-eval <url> <exprFile> [waitMs]')

const PORT = 9344
const CHROME = '/usr/bin/google-chrome-stable'
const chrome = Bun.spawn(
  [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
   '--disable-dev-shm-usage', '--force-device-scale-factor=1',
   `--remote-debugging-port=${PORT}`, '--window-size=1600,1000', 'about:blank'],
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
    /* not up */
  }
  await sleep(250)
}
if (!page) throw new Error('chrome debugging endpoint never came up')

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (v: any) => void>()
const logs: string[] = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data as string)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)!(m.result)
    pending.delete(m.id)
    return
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(
      m.params.args.map((a: any) => a.value ?? a.description ?? '').join(' '),
    )
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text))
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
// Real phone viewports need emulation — Chrome's window-size floor is ~500 px.
// Usage: EMULATE=1 [VW=390] [VH=844] bun run scripts/cdp-eval.ts …
if (process.env.EMULATE === '1') {
  await send('Emulation.setDeviceMetricsOverride', {
    width: Number(process.env.VW ?? 390),
    height: Number(process.env.VH ?? 844),
    deviceScaleFactor: 2,
    mobile: true,
  })
}
await send('Page.navigate', { url })
await sleep(waitMs)

const expression = await Bun.file(exprFile).text()
const { result, exceptionDetails } = await send('Runtime.evaluate', {
  expression,
  returnByValue: true,
  awaitPromise: true,
})
if (exceptionDetails) {
  console.log('ERROR:', exceptionDetails.exception?.description ?? exceptionDetails.text)
} else {
  console.log(typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2))
}
if (logs.length) console.log('--- console ---\n' + logs.slice(0, 30).join('\n'))

ws.close()
chrome.kill()
await sleep(200)
Bun.spawnSync(['pkill', '-f', `remote-debugging-port=${PORT}`])
