// node check_server.mjs — the admin's changes end to end in a sandbox (sandbox.mjs), never the real inverter or the
// real bot: a fake inverter, the real collector reading it on other ports, this server on 127.0.0.1:18810 with its
// data in a temp folder, a fake notifier service and a fake Telegram.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { stack } from './sandbox.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PIN = '480913'
const results = []
const filesUnder = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(`${d}/${e.name}`) : [`${d}/${e.name}`]))
const check = (name, ok, note = '') => {
  results.push(!!ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${note ? ' — ' + note : ''}`)
}

// a fake Telegram that keeps what it was sent
const tg = []
const tgSrv = http.createServer((req, res) => {
  let b = ''
  req.on('data', (c) => (b += c))
  req.on('end', () => {
    tg.push({ url: req.url, body: b })
    res.end(JSON.stringify({ ok: true }))
  })
}).listen(18899, '127.0.0.1')

const S = stack(18810, [], { pin: PIN })
try {
  const s0 = await S.ready()
  check('the sandbox: PIN set, inverter on the line (fake), current values from the probe', s0?.pin?.set && s0?.live?.liveOk && s0.current.source === 'probe', JSON.stringify(s0?.live))

  let r = await S.api('/api/settings/apply', { changes: [{ id: 'light', to: 1 }] })
  check('no PIN → 401', r.status === 401)
  r = await S.api('/api/settings/apply', { pin: '000000', changes: [{ id: 'light', to: 1 }] })
  check('wrong PIN → 401 with attempts left', r.status === 401 && r.left === 3, `left ${r.left}`)
  for (let i = 0; i < 3; i++) r = await S.api('/api/settings/apply', { pin: '000001', changes: [{ id: 'light', to: 1 }] })
  check('the 5th wrong PIN locks changes (423)', r.status === 423 && r.lockedUntil > Date.now() + 14 * 60_000)
  r = await S.api('/api/settings/apply', { pin: PIN, changes: [{ id: 'light', to: 1 }] })
  check('the right PIN while locked → still 423, nothing written', r.status === 423 && S.regs()['305'] === 0)
  execFileSync('node', [`${ROOT}admin/pin.mjs`, 'unlock'], { env: S.env })

  r = await S.api('/api/settings/apply', { pin: PIN, changes: [{ id: 'cv', to: 14.4 }] })
  check('a red setting without the 2-second hold → 400', r.status === 400 && /удержание/.test(r.why), r.why)
  r = await S.api('/api/settings/apply', { pin: PIN, held: true, changes: [{ id: 'float', to: 14.6 }] })
  check('float above C.V. → 400 "инвертор не примет"', r.status === 400 && /не примет/.test(r.why), r.why)
  r = await S.api('/api/settings/apply', { pin: PIN, changes: [{ id: 'eq', to: true }] })
  check('a grey setting (EQ) never changes → 400', r.status === 400, r.why)
  r = await S.api('/api/settings/apply', { pin: PIN, changes: [{ id: 'cvTime', to: 60 }] })
  check('a cloud-only setting → 400', r.status === 400 && /облако/.test(r.why), r.why)
  r = await S.api('/api/settings/apply', { pin: PIN, changes: [{ id: 'maxAc', to: 1000 }] })
  check('out of range → 400', r.status === 400, r.why)

  r = await S.api('/api/settings/apply', { pin: PIN, changes: [{ id: 'light', to: 1 }] })
  let j = r.ok ? await S.waitJob(r.job) : null
  const after = await S.api('/api/settings')
  check('backlight off → on: 202, the writer does it, read back, journal, current values from the dongle',
    r.status === 202 && j?.state === 'done' && S.regs()['305'] === 1 && after.journal[0]?.reg === 305 && after.journal[0]?.ok && after.current.source === 'dongle' && after.current.words['305'] === 1, `${j?.state}`)
  await S.ready() // after a job the collector takes the dongle back; until it reads, the server says "not on the line"
  r = await S.api('/api/settings/apply', { pin: PIN, changes: [{ id: 'light', to: 0 }], revertOf: j?.id })
  j = r.ok ? await S.waitJob(r.job) : null
  check('"вернуть": the same path back, 305 = 0 again', j?.state === 'done' && S.regs()['305'] === 0)
  await S.ready()
  r = await S.api('/api/settings/apply', { pin: PIN, held: true, changes: [{ id: 'cv', to: 14.4 }, { id: 'float', to: 14.4 }] })
  j = r.ok ? await S.waitJob(r.job) : null
  check('a red pair (C.V. and float to 14.4) with the hold: done', j?.state === 'done' && S.regs()['324'] === 144 && S.regs()['325'] === 144, j?.state)

  await S.ready()
  r = await S.api('/api/settings/apply', { pin: PIN, changes: [{ id: 'buzzer', to: 1 }] })
  const r2 = await S.api('/api/settings/apply', { pin: PIN, changes: [{ id: 'home', to: 0 }] })
  check('a second change while one runs → 409', r.status === 202 && r2.status === 409, r2.why)
  await S.waitJob(r.job)
  await S.ready()
  r = await S.api('/api/settings/read', {})
  j = r.ok ? await S.waitJob(r.job) : null
  check('"↻ прочитать" without a PIN: a read job, nothing written', j?.state === 'done' && !j.steps.some((x) => /рег \d+:/.test(x.text)))

  check('a POST from another site → 403', (await S.api('/api/settings/read', {}, { Origin: 'http://evil.example' })).status === 403)
  const form = await fetch(`${S.base}/api/settings/apply`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `pin=${PIN}` })
  check('a form post (not JSON) → 415', form.status === 415)
  check('a body over 16 KB → 400', (await S.api('/api/bot/config', 'x'.repeat(20000))).status === 400)

  // the bot
  let b = await S.api('/api/bot')
  check('Бот: state reads the config, off', b.on === false && b.config.chatSet && b.config.defer.includes('lvl1'))
  r = await S.api('/api/bot/config', { pin: '111222', config: { queue: '2.1' } })
  check('Бот: wrong PIN → 401, config untouched', r.status === 401 && !JSON.parse(readFileSync(`${S.dir}/notify/config.json`, 'utf8')).queue)
  r = await S.api('/api/bot/config', { pin: PIN, config: { region: 'kyivska-oblast', queue: '2.1', off: ['blink'], night: [22, 7], rules: { levels: [40, 15], hot_c: 55 } } })
  const cfg = JSON.parse(readFileSync(`${S.dir}/notify/config.json`, 'utf8'))
  check('Бот: saved with PIN; chat id kept', r.ok && cfg.queue === '2.1' && cfg.chat_id === '42' && cfg.rules.levels[0] === 40 && cfg.night[0] === 22 && cfg.off[0] === 'blink')
  r = await S.api('/api/bot/config', { pin: PIN, config: { rules: { levels: [10, 30] } } })
  check('Бот: levels the wrong way round → 400', r.status === 400)
  r = await S.api('/api/bot/power', { pin: PIN, on: true })
  b = await S.api('/api/bot')
  check('Бот: switched on with PIN (fake service)', r.ok && b.on === true)
  r = await S.api('/api/bot/config', { pin: PIN, config: { max_per_hour: 6 } })
  check('Бот: a save while on restarts it', r.ok && r.restarted === true)
  r = await S.api('/api/bot/power', { pin: PIN, on: false })
  check('Бот: switched off', r.ok && (await S.api('/api/bot')).on === false)
  r = await S.api('/api/bot/test', { pin: PIN })
  check('Бот: test message goes to the chat in the config', r.ok && tg.length === 1 && /chat_id=42/.test(tg[0].body) && tg[0].url.includes('/botfake-token/sendMessage'))
  r = await S.api('/api/bot/test', { pin: PIN })
  check('Бот: a second test within 30 s → 429', r.status === 429)

  const holding = filesUnder(S.dir).filter((f) => readFileSync(f).includes(PIN))
  check('the PIN is nowhere: not in the data folder, not in the server log', !holding.length && !S.out().includes(PIN), holding.join(', '))
} catch (e) {
  check('the run', false, e.stack)
} finally {
  S.stop()
  tgSrv.close()
}

// on battery: the server refuses before any job
const B = stack(18830, ['--battery'], { pin: PIN })
try {
  const s = await B.ready()
  const r = await B.api('/api/settings/apply', { pin: PIN, changes: [{ id: 'light', to: 1 }] })
  check('on battery (an outage): 409, no job', s && r.status === 409 && /батаре/.test(r.why) && !existsSync(`${B.dir}/settings/jobs`), r.why)
} finally {
  B.stop()
}
console.log(`${results.filter(Boolean).length}/${results.length}`)
process.exit(results.every(Boolean) ? 0 : 1)
