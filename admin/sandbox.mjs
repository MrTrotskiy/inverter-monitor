// A whole admin against a FAKE inverter, to try changes without touching the real one:
//   node admin/sandbox.mjs [--host 127.0.0.1] [--port 8801] [--pin 4829] [-- fake inverter flags, e.g. --battery]
// starts writer/fake_inverter.py, a second collector reading it (other ports, its own data in a temp folder), this
// admin's server on host:port with that data, a fake notifier service and a fake Telegram; prints the address and
// the sandbox PIN, and stops everything on Ctrl-C. check_server.mjs uses the same stack.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PY = '/usr/bin/python3'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function stack(port, fakeArgs = [], { host = '127.0.0.1', pin = '4829', tgPort = 18899 } = {}) {
  const dir = mkdtempSync(`${tmpdir()}/inv-admin-`)
  mkdirSync(`${dir}/dongle`, { recursive: true })
  mkdirSync(`${dir}/notify`, { recursive: true })
  writeFileSync(`${dir}/notify/config.json`, JSON.stringify({ chat_id: '42', defer: ['off', 'on', 'sum', 'lvl50', 'lvl20'], night: [23, 8], max_per_hour: 12 }))
  writeFileSync(`${dir}/bot.env`, 'BOT_TOKEN=fake-token\n')
  // the sandbox's own config.json: the real one (addresses, the chat, the token file) is never read here
  writeFileSync(`${dir}/config.json`, JSON.stringify({ dongle: { ip: '127.0.0.1', broadcast: '127.0.0.1' }, inverter: { model: 'fake inverter' }, telegram: { botEnv: `${dir}/bot.env` } }))
  writeFileSync(`${dir}/svc.sh`, `#!/bin/bash\nS="${dir}/svc"\ncase "$1" in install) echo on > "$S";; uninstall) echo off > "$S";; state) cat "$S" 2>/dev/null || echo off;; esac\n`)
  chmodSync(`${dir}/svc.sh`, 0o755)
  const udp = port + 40000
  const tcp = port + 1
  const procs = []
  procs.push(spawn(PY, [`${ROOT}writer/fake_inverter.py`, '--udp-port', String(udp), '--state', `${dir}/fake.json`, ...fakeArgs], { stdio: 'ignore' }))
  procs.push(spawn(PY, [`${ROOT}collector/collector.py`, '--data', `${dir}/dongle`, '--cloud-log', `${dir}/cloud.jsonl`, '--dongle', '127.0.0.1', '--broadcast', '127.0.0.1',
    '--udp-port', String(udp), '--tcp-port', String(tcp), '--me', '127.0.0.1', '--every', '1'], { stdio: 'ignore' }))
  const env = { ...process.env, INVERTER_DATA: dir, INVERTER_CONFIG: `${dir}/config.json`, ADMIN_PORT: String(port), ADMIN_HOSTS: host, WRITER_DONGLE: '127.0.0.1', WRITER_BROADCAST: '127.0.0.1',
    WRITER_UDP_PORT: String(udp), WRITER_TCP_PORT: String(tcp), WRITER_ME: '127.0.0.1', WRITER_SETTLE_S: '0.2', NOTIFIER_SERVICE: `${dir}/svc.sh`, BOT_ENV: `${dir}/bot.env`, TELEGRAM_API: `http://127.0.0.1:${tgPort}` }
  let out = ''
  const srv = spawn('node', [`${ROOT}admin/server.mjs`], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  srv.stdout.on('data', (c) => (out += c))
  srv.stderr.on('data', (c) => (out += c))
  procs.push(srv)
  execFileSync('node', [`${ROOT}admin/pin.mjs`, 'set'], { input: pin, env })
  const base = `http://${host}:${port}`
  const api = async (path, body, headers = {}) => {
    const r = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
    return { status: r.status, ...(await r.json().catch(() => ({}))) }
  }
  const regs = () => JSON.parse(readFileSync(`${dir}/fake.json`, 'utf8'))
  const waitJob = async (id) => {
    for (let i = 0; i < 120; i++) {
      const j = (await api(`/api/settings/job?id=${id}`)).job
      if (j && ['done', 'failed', 'failed-rollback', 'refused'].includes(j.state)) return j
      await sleep(250)
    }
    return null
  }
  const ready = async () => {
    for (let i = 0; i < 60; i++) {
      const s = await api('/api/settings').catch(() => null)
      if (s?.live?.liveOk) return s
      await sleep(300)
    }
    return null
  }
  const stop = () => {
    for (const p of procs) p.kill()
    rmSync(dir, { recursive: true, force: true })
  }
  return { dir, base, api, regs, waitJob, ready, out: () => out, env, stop }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = process.argv.slice(2)
  const get = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d)
  const fake = a.includes('--') ? a.slice(a.indexOf('--') + 1) : []
  const http = await import('node:http')
  http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      console.log(`[fake telegram] ${req.url.replace(/bot[^/]+/, 'bot…')}`)
      res.end('{"ok":true}')
    })
  }).listen(18899, '127.0.0.1')
  const S = stack(Number(get('--port', 8801)), fake, { host: get('--host', '127.0.0.1'), pin: get('--pin', '4829') })
  const s = await S.ready()
  console.log(`sandbox: ${S.base}/settings  (fake inverter ${s ? 'on the line' : 'NOT on the line'}), PIN ${get('--pin', '4829')}, data ${S.dir}`)
  process.on('SIGINT', () => (S.stop(), process.exit(0)))
  process.on('SIGTERM', () => (S.stop(), process.exit(0)))
}
