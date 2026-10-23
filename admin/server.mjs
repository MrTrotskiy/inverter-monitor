// The admin on the Mac mini: dist/ (the built app) and its two read-only API routes, for the home LAN only.
//
//   node server.mjs            listens on config.json admin.port (8080 if unset) of this Mac's LAN address(es) and 127.0.0.1
//   ADMIN_PORT=… ADMIN_HOSTS=192.168.1.10,127.0.0.1 node server.mjs   to choose
//
// LAN ONLY, three ways: it binds to the private IPv4 addresses of this Mac's own interfaces (192.168/16, 10/8,
// 172.16/12), never to 0.0.0.0, so a VPN (Tailscale's 100.x) or a tunnel cannot reach it; it answers only clients
// from those ranges or loopback; and only a Host that is an IP, *.local or localhost (no DNS rebinding through a
// public name). The addresses are looked up again every minute: if the router hands the Mac another one, it follows.
// The server itself never talks to the inverter, the dongle or the cloud. Changes (actions.mjs) need the PIN and
// arrive only as same-origin JSON POSTs; a settings change is handed to writer/settings_writer.py as a job file.
import http from 'node:http'
import os from 'node:os'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collector, days } from './feed.mjs'
import { get as getConfig } from './localconfig.mjs'
import { settingsState, settingsRead, settingsApply, settingsJob, botState, botSave, botPower, botTest, bankState, testSet } from './actions.mjs'

// changes come only as JSON from a page of this server: a form or a script on another site cannot send them
const POSTS = { '/api/settings/read': (b) => settingsRead(), '/api/settings/apply': settingsApply, '/api/bot/config': botSave, '/api/bot/power': botPower, '/api/bot/test': botTest, '/api/bank/test': testSet }
function body(req, limit = 16_384) {
  return new Promise((res, rej) => {
    let n = 0
    const chunks = []
    req.on('data', (c) => {
      n += c.length
      if (n <= limit) chunks.push(c) // past the limit the rest is read and dropped, then answered
    })
    req.on('end', () => {
      if (n > limit) return rej(new Error('too large'))
      try {
        res(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        rej(new Error('not json'))
      }
    })
    req.on('error', rej)
  })
}
const sameOrigin = (req) => {
  const o = req.headers.origin
  if (!o) return true // a same-origin fetch in some browsers sends none; the JSON content type still keeps forms out
  try {
    return new URL(o).host === req.headers.host
  } catch {
    return false
  }
}

const PORT = Number(process.env.ADMIN_PORT) || Number(getConfig('admin.port')) || 8080
const DIST = fileURLToPath(new URL('./dist/', import.meta.url))
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' }
const PAGES = new Set(['/', '/admin', '/history', '/settings', '/bot', '/bank'])

const isPrivate4 = (a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)
const clientOk = (addr = '') => {
  const a = addr.replace(/^::ffff:/, '')
  return a === '127.0.0.1' || a === '::1' || isPrivate4(a)
}
const hostOk = (host = '') => {
  const h = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h.endsWith('.local') || /^[\d.]+$/.test(h) || h.includes(':')
}

function lanAddresses() {
  if (process.env.ADMIN_HOSTS) return process.env.ADMIN_HOSTS.split(',').map((s) => s.trim()).filter(Boolean)
  const out = ['127.0.0.1']
  for (const list of Object.values(os.networkInterfaces())) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal && isPrivate4(i.address)) out.push(i.address)
  return [...new Set(out)]
}

function send(res, code, body, type = 'application/json', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra })
  res.end(body)
}

async function handle(req, res) {
  if (!clientOk(req.socket.remoteAddress) || !hostOk(req.headers.host)) return send(res, 403, 'forbidden', 'text/plain')
  const url = new URL(req.url || '/', 'http://x')
  const p = url.pathname
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
  if (req.method === 'POST' && POSTS[p]) {
    if (!sameOrigin(req)) return send(res, 403, JSON.stringify({ ok: false, why: 'чужая страница' }))
    if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, JSON.stringify({ ok: false, why: 'только JSON' }))
    try {
      const r = await POSTS[p](await body(req), ip)
      return send(res, r.code, JSON.stringify(r.body), 'application/json', { 'Cache-Control': 'no-store' })
    } catch (e) {
      console.error(new Date().toISOString(), p, e.message) // never the body: it holds the PIN
      return send(res, 400, JSON.stringify({ ok: false, why: 'неверный запрос' }))
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed', 'text/plain')
  try {
    if (p === '/api/settings') return send(res, 200, JSON.stringify(settingsState()), 'application/json', { 'Cache-Control': 'no-store' })
    if (p === '/api/settings/job') {
      const r = settingsJob(url.searchParams.get('id'))
      return send(res, r.code, JSON.stringify(r.body), 'application/json', { 'Cache-Control': 'no-store' })
    }
    if (p === '/api/bot') return send(res, 200, JSON.stringify(await botState()), 'application/json', { 'Cache-Control': 'no-store' })
    if (p === '/api/bank') return send(res, 200, JSON.stringify(bankState()), 'application/json', { 'Cache-Control': 'no-store' })
    if (p === '/api/collector') return send(res, 200, JSON.stringify(collector(url.searchParams.get('day'), url.searchParams.get('step'))), 'application/json', { 'Cache-Control': 'no-store' })
    if (p === '/api/days') return send(res, 200, JSON.stringify({ days: days() }), 'application/json', { 'Cache-Control': 'no-store' })
    if (p === '/api/health') return send(res, 200, JSON.stringify({ ok: true, pid: process.pid, up: Math.round(process.uptime()), rssMB: Math.round(process.memoryUsage().rss / 1e6) }), 'application/json', { 'Cache-Control': 'no-store' })
  } catch (e) {
    console.error(new Date().toISOString(), p, e)
    return send(res, 503, JSON.stringify({ error: String(e.message || e) }))
  }
  // the app: a page address gives index.html, anything else a file of dist/
  const file = PAGES.has(p.replace(/\/+$/, '') || '/') ? 'index.html' : normalize(decodeURIComponent(p)).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '')
  const full = join(DIST, file)
  if (!full.startsWith(DIST)) return send(res, 403, 'forbidden', 'text/plain')
  try {
    const st = await stat(full)
    if (!st.isFile()) throw new Error('not a file')
    const body = await readFile(full)
    const cache = file.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    return send(res, 200, req.method === 'HEAD' ? '' : body, TYPES[extname(full)] ?? 'application/octet-stream', { 'Cache-Control': cache })
  } catch {
    return send(res, 404, 'not found', 'text/plain')
  }
}

// one listener per address; the set is re-read every minute
const listening = new Map() // address → server
function bindAll() {
  const want = lanAddresses()
  for (const [addr, srv] of listening) {
    if (!want.includes(addr)) {
      srv.close()
      listening.delete(addr)
      console.log(new Date().toISOString(), `stopped on ${addr}:${PORT} (address gone)`)
    }
  }
  for (const addr of want) {
    if (listening.has(addr)) continue
    const srv = http.createServer((req, res) => handle(req, res).catch((e) => (console.error(e), send(res, 500, 'error', 'text/plain'))))
    srv.keepAliveTimeout = 5000
    srv.on('error', (e) => {
      console.error(new Date().toISOString(), `cannot listen on ${addr}:${PORT}: ${e.code || e.message}`)
      listening.delete(addr)
    })
    srv.listen(PORT, addr, () => console.log(new Date().toISOString(), `admin on http://${addr}:${PORT}/`))
    listening.set(addr, srv)
  }
}

bindAll()
setInterval(bindAll, 60_000) // also keeps the process up at boot, before the network has given an address
