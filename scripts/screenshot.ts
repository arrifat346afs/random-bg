/**
 * scripts/screenshot.ts — tiny CDP driver used for visual QA.
 *
 * Launches headless Chrome, opens a URL, waits, captures console errors,
 * evaluates a JS expression and writes a PNG. No dependencies (bun's global
 * WebSocket + fetch are enough).
 *
 * Usage: bun run scripts/screenshot.ts <url> <outfile> [waitMs] [width] [height] [exprFile]
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5199/'
const out = process.argv[3] ?? '/tmp/opencode/fx-shots/shot.png'
const waitMs = Number(process.argv[4] ?? 4000)
const width = Number(process.argv[5] ?? 1600)
const height = Number(process.argv[6] ?? 1000)
/** optional JS run after the first wait, then a second wait before capture */
const action = process.argv[7] ?? ''
const postWaitMs = Number(process.argv[8] ?? 2500)

const DEBUG_PORT = 9333
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
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ],
  { stdout: 'ignore', stderr: 'ignore' },
)

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
      const list = (await res.json()) as any[]
      const page = list.find((t) => t.type === 'page')
      if (page) return page
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('chrome debugging endpoint never came up')
}

const page = await targets()
const ws = new WebSocket(page.webSocketDebuggerUrl)

let id = 0
const pending = new Map<number, { resolve: (v: any) => void }>()
const errors: string[] = []

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data as string)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)!.resolve(msg.result)
    pending.delete(msg.id)
    return
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    errors.push(`EXCEPTION: ${d.text} ${d.exception?.description ?? ''}`)
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const type = msg.params.type
    if (type === 'error' || type === 'warning') {
      const text = msg.params.args
        .map((a: any) => a.value ?? a.description ?? '')
        .join(' ')
      errors.push(`${type.toUpperCase()}: ${text}`)
    }
  }
  if (msg.method === 'Log.entryAdded') {
    const e = msg.params.entry
    if (e.level === 'error') errors.push(`LOG: ${e.text} ${e.url ?? ''}`)
  }
})

await new Promise((r) => ws.addEventListener('open', r))

function send(method: string, params: any = {}) {
  const msgId = ++id
  return new Promise<any>((resolve) => {
    pending.set(msgId, { resolve })
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })
}

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')

// Real mobile viewports need emulation — Chrome's window-size floor is ~500px.
if (process.env.EMULATE === '1') {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
  })
}

await send('Page.navigate', { url })
await sleep(waitMs)

if (action) {
  // `;;` separates sequential steps so a test can open a dialog, then act.
  for (const step of action.split(';;')) {
    const { result: r, exceptionDetails } = await send('Runtime.evaluate', {
      expression: step,
      returnByValue: true,
      awaitPromise: true,
    })
    if (exceptionDetails) console.log('ACTION ERROR:', exceptionDetails.text, exceptionDetails.exception?.description ?? '')
    else if (r?.value !== undefined) console.log('ACTION:', JSON.stringify(r.value))
    await sleep(600)
  }
  await sleep(postWaitMs)
}

const { result } = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    primitives: document.body.innerText.match(/[\\d,]+ primitives/)?.[0] ?? null,
    generating: document.body.innerText.includes('generating…'),
    status: document.body.innerText.slice(0, 400),
    dark: document.documentElement.classList.contains('dark'),
    dialog: document.querySelector('[role=dialog]')?.innerText.slice(0, 30) ?? null,
    sheets: [...document.querySelectorAll('[role=dialog]')].length,
  })`,
  returnByValue: true,
})
console.log('STATE:', result.value)

if (process.env.NO_ANIM !== '0') {
  // Headless capture restarts CSS animations, so freeze them to their end
  // state. This is a screenshot-only aid, not part of the app.
  await send('Runtime.evaluate', {
    expression: `(() => {
      let s = document.getElementById('qa-freeze')
      if (!s) {
        s = document.createElement('style')
        s.id = 'qa-freeze'
        document.head.appendChild(s)
      }
      s.textContent = '*,*::before,*::after{animation:none !important;transition:none !important;}'
    })()`,
  })
  await sleep(400)
}

const shot = await send('Page.captureScreenshot', { format: 'png' })
await Bun.write(out, Buffer.from(shot.data, 'base64'))
console.log('SHOT:', out)

if (errors.length) {
  console.log('--- console ---')
  for (const e of errors.slice(0, 40)) console.log(e)
} else {
  console.log('--- console clean ---')
}

ws.close()
chrome.kill()
await sleep(200)
Bun.spawnSync(['pkill', '-f', `remote-debugging-port=${DEBUG_PORT}`])
