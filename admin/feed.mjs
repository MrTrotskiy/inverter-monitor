// The admin's data, read-only, from the files the collector and the cloud poller write:
//   collector(day, step) → the collector's status.json and last events, and the chosen day's points: the collector's
//     readings (thinned to `step` s, means per bucket) merged with the cloud log's real packets, from 6 h before the
//     day's midnight (an outage that began the evening before) to its end.
//   days() → every day with any reading: how many from the collector and the cloud, its outages, hours on battery,
//     energy out of and into the bank.
// Files are read once and then
// only their new bytes, and a past day's summary is kept until its files change, so a poll costs a few ms.
import { readFileSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { cloudPoint, fillGaps, mergePoints, seriesPoints, kyivMidnight, kyivDay, nextDay, outagesOf, dayTotals, daySlots } from './src/lib/admin/model.js'

const DATA = process.env.INVERTER_DATA || fileURLToPath(new URL('../data', import.meta.url))
export const DONGLE_DIR = `${DATA}/dongle`
export const CLOUD_LOG = `${DATA}/dessmonitor-log.jsonl`
export const DAY_RE = /^\d{4}-\d\d-\d\d$/

const statOr = (p) => {
  try {
    return statSync(p)
  } catch {
    return null
  }
}

function parseReading(line, out) {
  if (!line.includes('"bat_w"')) return
  try {
    const r = JSON.parse(line)
    delete r.r
    r.ms_t = Date.parse(r.t)
    out.push(r)
  } catch {}
}

// one day's readings; a growing file is read from where it was left
const dayFiles = new Map() // path → { size, mtime, rows, rest }
export function readDay(day, dir = DONGLE_DIR) {
  const p = `${dir}/${day}.jsonl`
  const st = statOr(p)
  if (st) {
    let c = dayFiles.get(p)
    if (!c || st.size < c.size) c = { size: 0, mtime: 0, rows: [], rest: '' }
    if (st.size > c.size) {
      const fd = openSync(p, 'r')
      const buf = Buffer.alloc(st.size - c.size)
      try {
        readSync(fd, buf, 0, buf.length, c.size)
      } finally {
        closeSync(fd)
      }
      const lines = (c.rest + buf.toString('utf8')).split('\n')
      c.rest = lines.pop() // a line still being written waits for its end
      for (const line of lines) parseReading(line, c.rows)
      c.size = st.size
    }
    c.mtime = st.mtimeMs
    dayFiles.set(p, c)
    return c.rows
  }
  const gz = statOr(p + '.gz')
  if (!gz) return []
  let c = dayFiles.get(p + '.gz')
  if (!c || c.mtime !== gz.mtimeMs) {
    const rows = []
    for (const line of gunzipSync(readFileSync(p + '.gz')).toString('utf8').split('\n')) parseReading(line, rows)
    c = { size: gz.size, mtime: gz.mtimeMs, rows }
    dayFiles.set(p + '.gz', c)
    dayFiles.delete(p)
  }
  return c.rows
}

const KEYS = ['out_w', 'out_va', 'bat_v', 'bat_a', 'bat_w', 'grid_v', 'grid_w', 'chg_w', 'soc', 'grid_hz', 'out_v', 'out_hz', 'temp_c', 'load_pct']

export function thin(rows, stepS) {
  const out = []
  let cur = null
  for (const r of rows) {
    const b = Math.floor(r.ms_t / 1000 / stepS) * stepS * 1000
    if (!cur || cur.t !== b) {
      cur = { t: b, n: 0, mode: r.mode, min_w: r.out_w, max_w: r.out_w }
      for (const k of KEYS) cur[k] = 0
      out.push(cur)
    }
    cur.n++
    cur.mode = r.mode
    cur.min_w = Math.min(cur.min_w, r.out_w)
    cur.max_w = Math.max(cur.max_w, r.out_w)
    for (const k of KEYS) cur[k] += r[k] ?? 0
  }
  for (const c of out) for (const k of KEYS) c[k] = Math.round((c[k] / c.n) * 100) / 100
  return out
}

// the cloud log's real packets (one per device timestamp) and hand-logged rows, as points; cached by mtime
let cloudCache = { mtime: -1, points: [] }
export function cloudAll() {
  const st = statOr(CLOUD_LOG)
  const m = st ? st.mtimeMs : 0
  if (m === cloudCache.mtime) return cloudCache.points
  const seen = new Set()
  const pts = []
  const text = st ? readFileSync(CLOUD_LOG, 'utf8') : ''
  for (const line of text.split('\n')) {
    let r
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    if (r.timestamp) {
      if (seen.has(r.timestamp)) continue
      seen.add(r.timestamp)
    }
    const p = cloudPoint(r, (s) => new Date(s.replace(' ', 'T')).getTime()) // the Mac's local time is Kyiv's
    if (p) pts.push(p)
  }
  pts.sort((a, b) => a.t - b.t)
  cloudCache = { mtime: m, points: fillGaps(pts) }
  return cloudCache.points
}

function collectorDays() {
  if (!existsSync(DONGLE_DIR)) return []
  return [...new Set(readdirSync(DONGLE_DIR).filter((f) => /^\d{4}-\d\d-\d\d\.jsonl(\.gz)?$/.test(f)).map((f) => f.slice(0, 10)))].sort()
}

// the points that tell one day: from 6 h before its midnight to the next midnight
export function dayWindow(day, step = 15) {
  const from = kyivMidnight(day)
  const to = kyivMidnight(nextDay(day))
  const prev = kyivDay(from - 3600_000)
  const rows = [...readDay(prev), ...readDay(day)].filter((r) => r.ms_t >= from - 6 * 3600_000 && r.ms_t < to)
  const local = seriesPoints(thin(rows, step)).map((p) => ({ ...p, src: 'collector' }))
  const cloud = cloudAll().filter((p) => p.t >= from - 6 * 3600_000 && p.t < to)
  return { from, to, points: mergePoints(local, cloud), nLocal: local.length, nCloud: cloud.filter((p) => p.t >= from).length }
}

// a day's line in the list, kept until its own files or the cloud log change
const sig = (day) => {
  const s = statOr(`${DONGLE_DIR}/${day}.jsonl`) ?? statOr(`${DONGLE_DIR}/${day}.jsonl.gz`)
  return s ? `${s.size}:${s.mtimeMs}` : '-'
}
const dayLines = new Map()
function dayLine(day, cloudMtime) {
  const prev = kyivDay(kyivMidnight(day) - 3600_000)
  const key = `${cloudMtime}|${sig(prev)}|${sig(day)}`
  const had = dayLines.get(day)
  if (had?.key === key) return had.line
  const w = dayWindow(day, 60)
  const inDay = w.points.filter((p) => p.t >= w.from)
  const tot = dayTotals(w.points, w.to, { from: w.from })
  const line = {
    day, local: w.nLocal, cloud: w.nCloud, first: inDay[0]?.t ?? null, last: inDay.at(-1)?.t ?? null,
    outages: outagesOf(w.points, w.from, w.to).length, batS: Math.round(tot.batS), outWh: Math.round(tot.outWh), inWh: Math.round(tot.inWh),
    loadWh: Math.round(tot.loadWh), slots: daySlots(w.points, w.from, w.to),
  }
  dayLines.set(day, { key, line })
  return line
}

export function days() {
  const pts = cloudAll()
  const all = new Set([...collectorDays(), ...pts.map((p) => kyivDay(p.t))])
  return [...all].sort().map((d) => dayLine(d, cloudCache.mtime)).filter((d) => d.first != null)
}

// the last `n` lines of a file, reading at most its last 64 KB
function tailLines(p, n) {
  const st = statOr(p)
  if (!st) return []
  const len = Math.min(st.size, 65536)
  const fd = openSync(p, 'r')
  const buf = Buffer.alloc(len)
  try {
    readSync(fd, buf, 0, len, st.size - len)
  } finally {
    closeSync(fd)
  }
  const lines = buf.toString('utf8').split('\n').filter(Boolean)
  if (len < st.size) lines.shift() // the first one is cut
  const out = []
  for (const l of lines.slice(-n)) {
    try {
      out.push(JSON.parse(l))
    } catch {}
  }
  return out
}

export function collector(dayAsked, stepAsked) {
  const today = kyivDay(Date.now())
  const day = DAY_RE.test(dayAsked ?? '') ? dayAsked : today
  const step = Math.min(3600, Math.max(5, Number(stepAsked) || 15))
  let status = {}
  try {
    status = JSON.parse(readFileSync(`${DONGLE_DIR}/status.json`, 'utf8'))
  } catch {}
  const events = tailLines(`${DONGLE_DIR}/events.jsonl`, 40)
  const rows = readDay(day)
  const w = dayWindow(day, step)
  return { read: new Date().toISOString(), day, today, step, status, events, from: w.from, to: w.to, points: w.points, series: thin(rows, step), count: rows.length }
}
