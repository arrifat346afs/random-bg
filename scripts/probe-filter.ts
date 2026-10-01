/** One-off: does ctx.filter blur respect the CTM? Run: bun run scripts/probe-filter.ts */
const CHROME = '/usr/bin/google-chrome-stable'
const PORT = 9341
const chrome = Bun.spawn(
  [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
   `--remote-debugging-port=${PORT}`, '--window-size=600,400', 'about:blank'],
  { stdout: 'ignore', stderr: 'ignore' },
)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let page: any
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    page = list.find((t: any) => t.type === 'page')
    if (page) break
  } catch { /* retry */ }
  await sleep(250)
}
if (!page) throw new Error('no page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (v: any) => void>()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data as string)
  if (m.id && pending.has(m.id)) { pending.get(m.id)!(m.result); pending.delete(m.id) }
})
await new Promise((r) => ws.addEventListener('open', r))
const send = (method: string, params: any = {}) => new Promise<any>((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
})
await send('Runtime.enable')

const expr = `(() => {
  function widthAt(scale) {
    const c = document.createElement('canvas'); c.width = 600; c.height = 300
    const x = c.getContext('2d');
    x.setTransform(scale, 0, 0, scale, 0, 0);
    x.filter = 'blur(6px)';
    x.fillStyle = '#000';
    x.fillRect(40, 40, 20, 20);   // 20x20 user units
    x.filter = 'none';
    const d = x.getImageData(0, 0, 600, 300).data;
    let first = -1, last = -1;
    for (let i = 0; i < 600; i++) {
      let any = false;
      for (let y = 0; y < 300; y++) if (d[(y * 600 + i) * 4 + 3] > 8) { any = true; break }
      if (any) { if (first < 0) first = i; last = i }
    }
    return last - first + 1;
  }
  const w1 = widthAt(1), w2 = widthAt(4);
  // width should be 20 + blur spread. If blur is transform-aware, w2 ~= w1; if
  // device-space, w2 ~= w1 + (something).
  return JSON.stringify({ w1, w2, ratio: +(w2 / w1).toFixed(3) });
})()`
const { result, exceptionDetails } = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
console.log(exceptionDetails ? 'ERR ' + JSON.stringify(exceptionDetails) : result.value)
ws.close(); chrome.kill(); await sleep(200)
Bun.spawnSync(['pkill', '-f', `remote-debugging-port=${PORT}`])
