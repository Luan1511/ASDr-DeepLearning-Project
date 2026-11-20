// Headless-Chrome screenshots of the local sandbox (http://localhost:5175, API :4100).
// Usage: node shoot.mjs shots.json   (shots: [{ name, as, path, wait, scrollY, width, height, click }])
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP = 'http://localhost:5175'
const API = 'http://127.0.0.1:4100/api'
const PASSWORD = 'sandbox123' // sandbox default from backend/test/e2e/sandbox.ts
const ACCOUNTS = { parent: 'e2e-parent-a@e2e.test', parentB: 'e2e-parent-b@e2e.test', admin: 'e2e-admin@e2e.test', doctor: 'bs.minhanh@asdr.local' }
const OUT = path.resolve('shots')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const shots = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
fs.mkdirSync(OUT, { recursive: true })

const tokens = {}
for (const role of new Set(shots.map((s) => s.as))) {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ACCOUNTS[role], password: PASSWORD }) })
  if (!r.ok) throw new Error(`login ${role}: ${r.status}`)
  tokens[role] = (await r.json()).token
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shoot-'))
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', '--lang=vi-VN', 'about:blank'], { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch('http://127.0.0.1:9333/json')).json(); if (targets.some((t) => t.type === 'page')) break } catch { /* not up yet */ }
  await sleep(200)
}
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, (m) => (m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result))); ws.send(JSON.stringify({ id: n, method, params })) })
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value

await send('Page.enable')
let currentRole = null
for (const s of shots) {
  const width = s.width ?? 1440
  const height = s.height ?? 900
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false })
  if (currentRole !== s.as) {
    await send('Page.navigate', { url: APP + '/login' })
    await sleep(1500)
    await evaluate(`localStorage.clear(); localStorage.setItem('asdr_token', ${JSON.stringify(tokens[s.as])}); true`)
    currentRole = s.as
  }
  await send('Page.navigate', { url: APP + s.path })
  await sleep(s.wait ?? 3500)
  if (s.click) {
    await evaluate(`(() => { const el = [...document.querySelectorAll('button, a, summary')].find(b => b.textContent.trim().includes(${JSON.stringify(s.click)})); if (el) el.click(); return !!el })()`)
    await sleep(s.afterClick ?? 2000)
  }
  if (s.scrollY) { await evaluate(`(document.querySelector('main') ?? document.scrollingElement).scrollTo(0, ${s.scrollY}); window.scrollTo(0, ${s.scrollY}); true`); await sleep(800) }
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, s.name + '.png'), Buffer.from(data, 'base64'))
  console.log('saved', s.name, await evaluate('location.pathname'))
}
ws.close()
chrome.kill()
await sleep(500)
fs.rmSync(profile, { recursive: true, force: true })
