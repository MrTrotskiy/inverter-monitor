// What the admin may change, behind the PIN: the inverter's settings (through writer/settings_writer.py, a separate
// program; this server never talks to the dongle) and the notifier (its config, on/off, a test message).
// Every change is checked here again, whatever the page said: the PIN, the catalog's rules, the conditions now.
import { spawn, execFile } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, renameSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { SETTINGS, READ, valueOf, problems, plan, byId } from './src/pages/settings/catalog.js'
import { checkPin, pinStatus } from './pin.mjs'
import { get as getConfig } from './localconfig.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DATA = process.env.INVERTER_DATA || `${ROOT}data`
const SET_DIR = `${DATA}/settings`
const JOBS = `${SET_DIR}/jobs`
const DONGLE = `${DATA}/dongle`
const NOTIFY = `${DATA}/notify`
const PY = process.env.WRITER_PYTHON || '/usr/bin/python3'
const WRITER = process.env.WRITER_SCRIPT || `${ROOT}writer/settings_writer.py`
const NOTIFIER_SERVICE = process.env.NOTIFIER_SERVICE || `${ROOT}notifier/service.sh`
const BOTCTL = `${ROOT}notifier/botctl.py`
const DONE = new Set(['done', 'failed', 'failed-rollback', 'refused'])

const read = (p, d = null) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return d
  }
}
const save = (p, obj) => {
  mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true })
  writeFileSync(p + '.tmp', JSON.stringify(obj, null, 1))
  renameSync(p + '.tmp', p)
}
const err = (code, why, extra = {}) => ({ code, body: { ...extra, ok: false, why } })
const ok = (body, code = 200) => ({ code, body: { ok: true, ...body } })

// ---------- the inverter now, from the collector ----------
export function live(now = Date.now()) {
  const st = read(`${DONGLE}/status.json`, {})
  const last = st.last
  const fresh = !!(st.connected && last && now - Date.parse(last.t) < 90_000)
  return { liveOk: fresh, mode: last?.mode ?? null, phase: !fresh ? null : last.mode === 3 ? 'battery' : (last.bat_a ?? 0) > 2.8 ? 'charging' : 'grid', a: last?.bat_a ?? null, at: last?.t ?? null, yielded: st.yielded ?? null }
}
function conditionsNow() {
  const l = live()
  if (!l.liveOk) return 'инвертор не на связи'
  if (l.mode !== 2) return 'дом от батареи: во время отключения ничего не пишем'
  if ((l.a ?? 0) > 40) return `идёт сильный заряд (${l.a} А)`
  return null
}

// ---------- settings ----------
function currentRead() {
  const c = read(`${SET_DIR}/current.json`)
  return c?.words ? { flat: c.words, at: c.at, source: c.source ?? 'dongle' } : { words: READ.words, at: READ.at, source: 'probe' }
}
function jobsNewestFirst() {
  if (!existsSync(JOBS)) return []
  return readdirSync(JOBS).filter((f) => f.endsWith('.json')).map((f) => ({ f, m: statSync(`${JOBS}/${f}`).mtimeMs })).sort((a, b) => b.m - a.m).map((x) => `${JOBS}/${x.f}`)
}
function running() {
  const lock = existsSync(`${SET_DIR}/writer.lock`)
  const j = jobsNewestFirst()[0]
  const job = j ? read(j) : null
  if (job && !DONE.has(job.state) && (lock || Date.now() - statSync(j).mtimeMs < 15_000)) return job
  return null
}
function journal(n = 80) {
  const p = `${SET_DIR}/journal.jsonl`
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').trim().split('\n').slice(-n).map((l) => {
    try {
      return JSON.parse(l)
    } catch {
      return null
    }
  }).filter(Boolean).reverse()
}
function startJob(job) {
  mkdirSync(JOBS, { recursive: true })
  const p = `${JOBS}/${job.id}.json`
  save(p, { ...job, state: 'queued', created: new Date().toISOString(), steps: [] })
  const child = spawn(PY, [WRITER, '--job', p], { detached: true, stdio: 'ignore', env: process.env })
  child.unref()
  return job.id
}
const newId = () => `${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`

export function settingsState() {
  const cur = currentRead()
  const last = jobsNewestFirst()[0]
  const inv = getConfig('inverter', {}) ?? {}
  const identity = [['модель', inv.model], ['серийный', inv.serial], ['прошивка', inv.firmware], ['донгл', [inv.pn && `PN ${inv.pn}`, getConfig('dongle.ip')].filter(Boolean).join(' · ')]].filter(([, v]) => v)
  return { current: { at: cur.at, source: cur.source, words: cur.flat ?? null }, journal: journal(), job: last ? read(last) : null, running: !!running(), pin: pinStatus(), live: live(), identity }
}

export function settingsRead() {
  if (running()) return err(409, 'уже идёт задание')
  if (!live().liveOk) return err(409, 'инвертор не на связи')
  return ok({ job: startJob({ id: newId(), kind: 'read', changes: [] }) }, 202)
}

export function settingsApply(body, ip) {
  if (running()) return err(409, 'уже идёт задание')
  const pin = checkPin(body?.pin, ip)
  if (!pin.ok) return err(pin.why === 'no-pin' ? 403 : pin.why === 'locked' ? 423 : 401, pin.why === 'no-pin' ? 'PIN не задан: только просмотр' : pin.why === 'locked' ? 'PIN заблокирован' : 'неверный PIN', pin)
  const asked = Array.isArray(body?.changes) ? body.changes : []
  if (!asked.length || asked.length > 12) return err(400, 'нет изменений')
  const cur = currentRead()
  const now = Object.fromEntries(SETTINGS.map((s) => [s.id, valueOf(s, cur)]))
  const vals = { ...now }
  const changes = []
  for (const c of asked) {
    const s = byId[c?.id]
    if (!s) return err(400, `нет такой настройки: ${c?.id}`)
    if (s.risk === 'locked') return err(400, `${s.name}: не меняется`)
    if (s.reg == null) return err(400, `${s.name}: только через облако`)
    let to = c.to
    if (s.kind === 'num') {
      if (typeof to !== 'number' || !Number.isFinite(to)) return err(400, `${s.name}: не число`)
      to = Math.round(to / s.step) * s.step
      to = Math.round(to * 100) / 100
    } else if (s.kind === 'bool') {
      if (typeof to !== 'boolean') return err(400, `${s.name}: да или нет`)
    } else if (s.kind === 'enum') {
      if (!s.options.some((o) => o.v === to)) return err(400, `${s.name}: нет такого варианта`)
    } else return err(400, `${s.name}: не меняется`)
    if (s.risk === 'danger' && body.held !== true) return err(400, `${s.name}: опасная настройка — нужно удержание`)
    if (to === now[s.id]) continue
    vals[s.id] = to
    changes.push({ id: s.id, from: now[s.id], to })
  }
  if (!changes.length) return err(400, 'ничего не меняется')
  const refused = problems(vals).filter((p) => p.refuse)
  if (refused.length) return err(400, `инвертор не примет: ${refused.map((p) => p.text).join('; ')}`)
  const cond = conditionsNow()
  if (cond) return err(409, cond)
  const raw = plan(changes).map((p, i) => ({ id: changes[i].id, name: byId[changes[i].id].name, reg: p.reg, from: p.from, to: p.to }))
  const revertOf = typeof body.revertOf === 'string' && /^[\w-]{1,40}$/.test(body.revertOf) ? body.revertOf : null
  return ok({ job: startJob({ id: newId(), kind: 'write', changes: raw, revert_of: revertOf, ip }) }, 202)
}

export function settingsJob(id) {
  if (!/^[\w-]{1,40}$/.test(id ?? '')) return err(400, 'нет задания')
  const j = read(`${JOBS}/${id}.json`)
  return j ? ok({ job: j }) : err(404, 'нет задания')
}

// ---------- the bank: the discharge test and what it measured ----------
// The test mode only changes what the admin shows (the STOP panel); it writes nothing anywhere else, so no PIN.
export function bankState() {
  return { calibration: read(`${DATA}/calibration.json`), test: read(`${DATA}/admin/test.json`, { on: false }) }
}
export function testSet(body) {
  if (typeof body?.on !== 'boolean') return err(400, 'вкл или выкл')
  save(`${DATA}/admin/test.json`, { on: body.on, since: body.on ? new Date().toISOString() : null })
  return ok({ on: body.on })
}

// ---------- the bot ----------
export const KINDS = ['full', 'lvl1', 'lvl2', 'off', 'on', 'sum', 'notfull', 'fast', 'hour', 'nocharge', 'over', 'hot', 'short', 'data', 'blink']
export const BOT_DEFAULTS = {
  off: [], night: [23, 8], night_kinds: ['over', 'hot', 'lvl2', 'hour', 'short', 'data'], max_per_hour: 12, region: null, queue: null,
  defer: ['off', 'on', 'sum', 'lvl1', 'lvl2'],
  rules: { levels: [50, 20], fast_w: 150, fast_min: 15, hot_c: 50, overload_va: 2400, overload_w: 1200, silent_min: 10, nocharge_min: 15, short_margin_min: 10, blink_s: 60 },
}
const RULE_RANGE = { fast_w: [50, 1500], fast_min: [5, 60], hot_c: [40, 70], overload_va: [500, 3000], overload_w: [300, 1500], silent_min: [3, 120], nocharge_min: [5, 120], short_margin_min: [0, 60], blink_s: [10, 600] }
const OLD = { lvl50: 'lvl1', lvl20: 'lvl2' }

function botConfig() {
  const c = read(`${NOTIFY}/config.json`, {})
  const tok = (a) => (a ?? []).map((k) => OLD[k] ?? k)
  return {
    off: tok(c.off ?? BOT_DEFAULTS.off), night: c.night ?? BOT_DEFAULTS.night, night_kinds: tok(c.night_kinds ?? BOT_DEFAULTS.night_kinds),
    max_per_hour: c.max_per_hour ?? BOT_DEFAULTS.max_per_hour, region: c.region ?? null, queue: c.queue ?? null, defer: tok(c.defer ?? BOT_DEFAULTS.defer),
    rules: { ...BOT_DEFAULTS.rules, ...(c.rules ?? {}) }, chatSet: !!c.chat_id,
  }
}
function service(cmd) {
  return new Promise((res) => execFile(NOTIFIER_SERVICE, [cmd], { timeout: 20_000 }, (e, out) => res({ ok: !e, out: String(out ?? '').trim() })))
}
export async function botState() {
  const st = await service('state')
  const log = existsSync(`${NOTIFY}/log.jsonl`) ? readFileSync(`${NOTIFY}/log.jsonl`, 'utf8').trim().split('\n').slice(-12).map((l) => {
    try {
      const r = JSON.parse(l)
      return { t: r.t, event: r.event ?? r.kind, kind: r.event ? r.kind : undefined }
    } catch {
      return null
    }
  }).filter(Boolean).reverse() : []
  return { config: botConfig(), on: st.out === 'on', log, pin: pinStatus(), defaults: BOT_DEFAULTS, kinds: KINDS }
}

function validBot(p) {
  const out = {}
  const sub = (a) => Array.isArray(a) && a.every((k) => KINDS.includes(k))
  if ('off' in p) { if (!sub(p.off)) return 'off'; out.off = [...new Set(p.off)] }
  if ('night_kinds' in p) { if (!sub(p.night_kinds)) return 'night_kinds'; out.night_kinds = [...new Set(p.night_kinds)] }
  if ('night' in p) {
    if (!Array.isArray(p.night) || p.night.length !== 2 || !p.night.every((h) => Number.isInteger(h) && h >= 0 && h <= 23)) return 'night'
    out.night = p.night
  }
  if ('max_per_hour' in p) { if (!Number.isInteger(p.max_per_hour) || p.max_per_hour < 1 || p.max_per_hour > 60) return 'max_per_hour'; out.max_per_hour = p.max_per_hour }
  if ('region' in p) { if (p.region !== null && !/^[a-z-]{3,40}$/.test(p.region)) return 'region'; out.region = p.region }
  if ('queue' in p) { if (p.queue !== null && !/^\d{1,2}\.\d$/.test(p.queue)) return 'queue'; out.queue = p.queue }
  if ('rules' in p) {
    const r = p.rules ?? {}
    const rules = {}
    for (const [k, v] of Object.entries(r)) {
      if (k === 'levels') {
        if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => Number.isInteger(x) && x >= 5 && x <= 95) || v[0] <= v[1]) return 'levels'
        rules.levels = v
      } else if (RULE_RANGE[k]) {
        if (typeof v !== 'number' || v < RULE_RANGE[k][0] || v > RULE_RANGE[k][1]) return k
        rules[k] = v
      } else return k
    }
    out.rules = rules
  }
  return out
}

export async function botSave(body, ip) {
  const pin = checkPin(body?.pin, ip)
  if (!pin.ok) return err(pin.why === 'no-pin' ? 403 : pin.why === 'locked' ? 423 : 401, pin.why === 'no-pin' ? 'PIN не задан' : pin.why === 'locked' ? 'PIN заблокирован' : 'неверный PIN', pin)
  const v = validBot(body?.config ?? {})
  if (typeof v === 'string') return err(400, `неверное значение: ${v}`)
  const cur = read(`${NOTIFY}/config.json`, {})
  const next = { ...cur, ...v, rules: { ...(cur.rules ?? {}), ...(v.rules ?? {}) } }
  save(`${NOTIFY}/config.json`, next)
  const st = await service('state')
  if (st.out === 'on') await service('install') // the notifier reads its config when it starts
  return ok({ restarted: st.out === 'on' })
}

export async function botPower(body, ip) {
  const pin = checkPin(body?.pin, ip)
  if (!pin.ok) return err(pin.why === 'no-pin' ? 403 : pin.why === 'locked' ? 423 : 401, pin.why === 'locked' ? 'PIN заблокирован' : 'неверный PIN', pin)
  if (typeof body?.on !== 'boolean') return err(400, 'вкл или выкл')
  const r = await service(body.on ? 'install' : 'uninstall')
  const st = await service('state')
  return r.ok ? ok({ on: st.out === 'on' }) : err(500, 'служба не ответила')
}

let lastTest = 0
export async function botTest(body, ip) {
  const pin = checkPin(body?.pin, ip)
  if (!pin.ok) return err(pin.why === 'no-pin' ? 403 : pin.why === 'locked' ? 423 : 401, pin.why === 'locked' ? 'PIN заблокирован' : 'неверный PIN', pin)
  if (Date.now() - lastTest < 30_000) return err(429, 'не чаще раза в 30 с')
  lastTest = Date.now()
  const st = await service('state')
  const out = await new Promise((res) => execFile(PY, [BOTCTL, 'test'], { timeout: 30_000, env: { ...process.env, NOTIFIER_ON: st.out === 'on' ? '1' : '0' } }, (e, so) => res(String(so ?? ''))))
  let r
  try {
    r = JSON.parse(out.trim().split('\n').at(-1))
  } catch {
    r = { ok: false, why: 'botctl не ответил' }
  }
  return r.ok ? ok({ sent: true }) : err(502, r.why ?? 'не отправлено')
}
