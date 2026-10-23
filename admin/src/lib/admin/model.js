// The admin's numbers: one moment of the bank, live or replayed. No JSX; model.check.js checks it.
// The same arithmetic as the notifier (inverter-monitor/notifier/rules.py): energy drawn = load × 1.02 + 20 W,
// usable bank = 2560 × 0.95 Wh, the charge given back counted in A·h at ~13 V.

// The bank's numbers: the datasheet's until the owner's own discharge test measures them (admin/calibrate.mjs →
// data/calibration.json → calibrate()). They are live bindings: every importer sees the measured values once set.
export let CAP_WH = 2560 * 0.95 // usable energy from full to the inverter's cut-off
export let IDLE_W = 20
export let LOSS = 0.02
export let CAL = { source: 'datasheet', capWh: CAP_WH, idleW: IDLE_W, loss: LOSS }
export function calibrate(c) {
  if (!c || !(c.capWh > 500 && c.capWh < 6000)) return CAL
  CAP_WH = c.capWh
  IDLE_W = c.idleW ?? IDLE_W
  LOSS = c.loss ?? LOSS
  CAL = { ...c, source: 'measured' }
  return CAL
}
export const CV_TAIL_MIN = 8 // 14.1 V reached → current under one step: 17:52:15 → 18:00:05 on 2026-10-23
export const BULK_A = 40 // above this the charger is still in its constant-current stage
export const STEP_A = 2.8 // the inverter reads battery current in 2.8 A steps
export const CV_V = 14.1 // the charger's C.V. voltage (setting 324)
export const MAX_VA = 3000
export const MAX_W = 1500

export const drawW = (w) => w * (1 + LOSS) + IDLE_W

// The discharge test's stop (the owner keeps 10 % in the bank): whichever comes first of
//   energy out since full ≥ 90 % of the usable bank (2304 Wh by the datasheet; the measured bank once known),
//   the knee: the load-corrected voltage fell ≥ 0.2 V over the last 100 Wh (on the plateau it moves ~0.05 V),
//   the load-corrected voltage ≤ 12.2 V (sources put 10 % anywhere from 12.0 to 12.7 V at rest).
// "Soon" at 80 %, or corrected ≤ 12.5 V. R: cable + terminals + cells, ~22 mΩ (measured 2026-09-18).
// And always: the voltage ON THE SCREEN ≤ 12.0 V — the inverter cuts at 11.7 V at its own terminals, and under a few
// hundred watts the wiring takes 0.5–0.9 V, so near the knee the cut-off can come before 10 % (Mac and router dark).
export const TEST = { floorPct: 10, soonPct: 20, kneeDropV: 0.2, kneeWh: 100, stopV: 12.2, soonV: 12.5, hardV: 12.0, soonShownV: 12.3, R: 0.022 }
export const vCorr = (v, w) => v + (drawW(w) / Math.max(10, v)) * TEST.R

// The test's state at the last point ≤ t: since the bank was last full, energy out (by the load), the corrected
// voltage, its drop over the last 100 Wh, and the verdict. → null when not discharging.
export function discharge(points, t) {
  let i = points.length - 1
  while (i >= 0 && points[i].t > t) i--
  if (i < 0 || points[i].mode !== 3) return null
  let j = i
  while (j > 0 && points[j - 1].mode === 3) j--
  const run = []
  let wh = 0
  for (let k = j; k <= i; k++) {
    const p = points[k]
    if (k > j) {
      const dt = (p.t - points[k - 1].t) / 3.6e6
      if (dt * 3600 <= 600) wh += ((drawW(points[k - 1].w) + drawW(p.w)) / 2) * dt
    }
    run.push({ t: p.t, wh, vc: vCorr(p.v, p.w), v: p.v, w: p.w })
  }
  const last = run.at(-1)
  const mean = (a) => a.reduce((s, x) => s + x.vc, 0) / a.length
  const recent = run.filter((x) => x.t >= last.t - 120_000)
  const vcNow = mean(recent)
  const back = run.filter((x) => x.wh <= last.wh - TEST.kneeWh && x.wh >= last.wh - TEST.kneeWh - 20)
  const drop = back.length ? mean(back) - vcNow : null
  const stopWh = CAP_WH * (1 - TEST.floorPct / 100)
  const soonWh = CAP_WH * (1 - TEST.soonPct / 100)
  const vShown = recent.reduce((s, x) => s + x.v, 0) / recent.length
  const why = vShown <= TEST.hardV ? 'cutoff' : last.wh >= stopWh ? 'energy' : drop != null && drop >= TEST.kneeDropV ? 'knee' : vcNow <= TEST.stopV ? 'voltage' : null
  const soon = !why && (last.wh >= soonWh || vcNow <= TEST.soonV || vShown <= TEST.soonShownV)
  const loadW = run.filter((x) => x.t >= last.t - 600_000).reduce((s, x, _, a) => s + x.w / a.length, 0)
  return { from: run[0].t, wh: last.wh, vc: vcNow, v: last.v, drop, stopWh, soonWh, why, soon, loadW, leftToStopH: Math.max(0, stopWh - last.wh) / drawW(loadW) }
}

// Charge left in %, from the energy spent since full and the A·h given back since.
export function soc(spentWh, chargedAh = 0) {
  return Math.min(100, Math.max(0, 100 * (1 - Math.max(0, spentWh - chargedAh * 13) / CAP_WH)))
}

// Hours left on battery at a load.
export const hoursLeft = (socPct, loadW) => ((socPct / 100) * CAP_WH) / drawW(Math.max(0, loadW))

// When the charge ends (epoch ms): the A·h still owed at the current now, plus the constant-voltage tail.
// cvSince: when the voltage first reached 14.1 V in this charge (null while still in bulk).
export function chargeEta({ t, spentWh, chargedAh, a, cvSince = null }) {
  if (cvSince != null) return Math.max(t + 60_000, cvSince + CV_TAIL_MIN * 60_000)
  const owedAh = Math.max(0, spentWh / 13 - chargedAh)
  return t + (owedAh / Math.max(a, 1)) * 3.6e6 + CV_TAIL_MIN * 60_000
}

// The charge current from now to the end, as the charger drew it on 2026-10-23: flat at `a` until 14.1 V,
// then down fast (50 → 8.4 A in ~2.3 min), then a slow tail to one step at `eta`. → [{ t, a }] every 15 s.
export function chargeCurve({ t, a, eta, cvSince = null }) {
  if (!eta || eta <= t) return []
  const cvAt = cvSince ?? Math.max(t, eta - CV_TAIL_MIN * 60_000)
  const fastEnd = cvAt + 140_000
  const out = []
  for (let s = t; s <= eta + 1; s += 15_000) {
    let v
    if (s < cvAt) v = a
    else if (s < fastEnd) v = Math.max(8.4, a * Math.exp(-(s - cvAt) / 75_000))
    else v = 8.4 - ((8.4 - STEP_A) * (s - fastEnd)) / Math.max(1, eta - fastEnd)
    out.push({ t: s, a: Math.max(0, Math.min(a, v)) })
  }
  return out
}

// Today's points from public/data/balance.json: the cloud's packets, the dongle's readings where they exist
// (16:35–16:47 and from 17:34:46), and the unseen minutes from the switch to the first local reading filled
// at that reading's current (the switch moment itself is a guess inside 17:28:03–17:33:13).
export function dayPoints(d, { switchT, localFrom }) {
  const dongleSpans = [[localFrom, Infinity]]
  const local = d.local.map((r) => ({ t: r.t, mode: r.mode, w: r.w, a: r.a, v: r.v, va: r.va }))
  const covered = (t) => local.some((r) => Math.abs(r.t - t) < 60_000) || dongleSpans.some(([a, b]) => t >= a && t <= b)
  const cloud = d.cloud
    .filter((r) => r.t < switchT && !covered(r.t))
    .map((r) => ({ t: r.t, mode: r.mode === 'Off-Grid Mode' ? 3 : 2, w: r.w, a: r.a, v: r.v, va: r.va, gridV: r.gridV || null }))
  const first = local.find((r) => r.t >= localFrom)
  const fill = first ? [{ t: switchT, mode: 2, w: first.w, a: first.a, v: first.v, va: first.va }] : []
  return [...cloud, ...local, ...fill].sort((a, b) => a.t - b.t)
}

// The collector's thinned series (feed.mjs thin()) as points.
export const seriesPoints = (series = []) =>
  series.map((p) => ({
    t: p.t, mode: p.mode, w: p.out_w, a: p.bat_a, v: p.bat_v, va: p.out_va, gridV: p.grid_v, gridHz: p.grid_hz,
    gridW: p.grid_w, chgW: p.chg_w, outV: p.out_v, outHz: p.out_hz, temp: p.temp_c, loadPct: p.load_pct,
  }))

// What the day added up to by time t (points in time order; a hole longer than `holeMs` is not bridged):
// out of the bank (the countdown's own count: load × 1.02 + 20 W on battery), into it (read A × V while
// charging), what the house used, the time on battery.
export function dayTotals(points, t, { from = -Infinity } = {}) {
  const r = { outWh: 0, inWh: 0, loadWh: 0, batS: 0, gridWh: 0 }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (a.t < from) continue
    if (a.t >= t) break
    const t1 = Math.min(b.t, t)
    const ms = t1 - a.t
    if (ms <= 0 || isHole(a, b)) continue
    const h = ms / 3.6e6
    r.loadWh += a.w * h
    if (a.mode === 3) {
      r.outWh += drawW(a.w) * h
      r.batS += ms / 1000
    } else {
      if (a.a > 0) r.inWh += a.a * (a.v || 13.6) * h
      r.gridWh += (a.gridW ?? a.w + Math.max(0, a.a) * (a.v || 13.6)) * h
    }
  }
  return r
}

// A day's points [{ t, mode, w, a, v }] (time order) → a function of time answering the bank at that moment.
export function replayDay(points, { start }) {
  const pts = points.filter((p) => p.t >= start - 3600_000)
  return function at(t) {
    let spent = 0
    let charged = 0
    let cvSince = null
    let prev = null
    let cur = null
    let chargeStart = null
    let outageFrom = null
    for (const p of pts) {
      if (p.t > t) break
      if (prev && p.t >= start) {
        const h = (p.t - prev.t) / 3.6e6
        if (prev.mode === 3) spent += ((drawW(prev.w) + drawW(p.w)) / 2) * h
        if (prev.mode === 2 && prev.a > 0) charged += ((prev.a + Math.max(0, p.a)) / 2) * h
      }
      if (p.mode === 3 && (!prev || prev.mode !== 3)) outageFrom = p.t
      if (p.mode === 2 && p.a > 2.8 && chargeStart == null && spent > 0) chargeStart = p.t
      if (p.mode === 2 && p.v >= CV_V && cvSince == null && chargeStart != null) cvSince = p.t
      prev = p
      cur = p
    }
    if (!cur) return null
    // the reading in force is held to t
    if (prev && t > prev.t && prev.mode === 3) spent += drawW(prev.w) * ((t - prev.t) / 3.6e6)
    if (prev && t > prev.t && prev.mode === 2 && prev.a > 0) charged += prev.a * ((t - prev.t) / 3.6e6)
    const s = soc(spent, charged)
    const charging = cur.mode === 2 && cur.a > 2.8
    const phase = cur.mode === 3 ? 'battery' : charging ? 'charging' : spent > 0 ? 'full' : 'grid'
    return {
      t, phase, w: cur.w, a: cur.a, v: cur.v, va: cur.va ?? null, soc: s, spentWh: spent, chargedAh: charged,
      leftH: hoursLeft(s, cur.w),
      eta: charging ? chargeEta({ t, spentWh: spent, chargedAh: charged, a: cur.a, cvSince }) : null,
      cvSince, chargeStart, outageFrom: cur.mode === 3 ? outageFrom : null,
      raw: cur, // everything the reading in force carries (grid V/Hz/W, output V/Hz, temperature… where read)
    }
  }
}

// One moment for the admin's screen, from a replayed state `s` and the load to count with (the real one, or
// the one the person dials in). count: seconds on the countdown; ticks: whether it runs down by itself.
export function screen(s, { loadW = null } = {}) {
  if (!s) return null
  const w = loadW ?? s.w
  const leftS = hoursLeft(s.soc, w) * 3600
  const kind = s.phase === 'battery' ? 'cutoff' : s.phase === 'charging' ? 'full' : 'reserve'
  const count = kind === 'full' ? (s.eta - s.t) / 1000 : leftS
  return {
    ...s, loadW: w, kind, count, ticks: kind !== 'reserve',
    cutoffAt: kind === 'cutoff' ? s.t + leftS * 1000 : null,
    curve: kind === 'full' ? chargeCurve({ t: s.t, a: s.a, eta: s.eta, cvSince: s.cvSince }) : [],
  }
}

// Minute samples of a replay over [t0, t1] for the timeline: { t, phase, a, soc }.
export function track(at, t0, t1, stepMs = 60_000) {
  const out = []
  for (let t = t0; t <= t1; t += stepMs) {
    const s = at(t)
    if (s) out.push({ t, phase: s.phase, a: s.a, soc: s.soc, w: s.w })
  }
  return out
}

// The day `day` (YYYY-MM-DD) starts at this epoch ms in Kyiv (EEST +03:00 until 25 Oct 2026, EET +02:00 after).
export function kyivMidnight(day) {
  const guess = Date.parse(`${day}T00:00:00+03:00`)
  const h = Number(new Date(guess).toLocaleString('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hour12: false }))
  return h === 23 ? guess + 3600_000 : guess
}
export const kyivDay = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' })
export const nextDay = (day) => kyivDay(kyivMidnight(day) + 26 * 3600_000)

// How long without a reading is a hole, by where the readings came from: the collector reads every 5 s (7 min is
// plenty), the cloud sends every ~5 min 10 s (12 min: two packets missed), the September test was written by
// hand every ~30 min (90 min). Between two readings the longer limit of the two holds.
const LIMIT = { hand: 90 * 60_000, cloud: 12 * 60_000 }
export const limitOf = (p) => LIMIT[p?.src] ?? 7 * 60_000
export const isHole = (a, b) => b.t - a.t > Math.max(limitOf(a), limitOf(b))

// Outages (runs on battery) that touch [from, to]: [{ start, end, open }] — `open` when the data ends on battery.
export function outagesOf(points, from = -Infinity, to = Infinity) {
  const out = []
  let cur = null
  for (const p of points) {
    if (p.mode === 3 && !cur) cur = { start: p.t, end: p.t, open: true }
    else if (p.mode === 3) cur.end = p.t
    else if (p.mode !== 3 && cur) {
      cur.end = p.t
      cur.open = false
      out.push(cur)
      cur = null
    }
  }
  if (cur) out.push(cur)
  return out.filter((o) => o.end >= from && o.start <= to)
}

// One line of the cloud log (inverter-monitor/data/dessmonitor-log.jsonl) → a point, or null. API rows carry the
// device's own `timestamp` (Kyiv local time; repeats of one frozen packet are dropped by the caller); hand-logged
// rows of the September test carry only `ts` and are kept, their mode read from the grid fields.
export function cloudPoint(r, toEpoch) {
  const t = r.timestamp ? toEpoch(r.timestamp) : Date.parse(r.ts)
  if (!Number.isFinite(t)) return null
  if (r.load_w == null && r.battery_v == null) return null
  let mode = r.operating_mode === 'Off-Grid Mode' ? 3 : r.operating_mode ? 2 : null
  if (mode == null) {
    if (r.grid_hz === 0 || r.grid_w === 0) mode = 3
    else if (r.grid_hz > 0 || r.grid_w > 0 || r.battery_a > 0) mode = 2
  }
  return {
    t, mode, w: r.load_w ?? null, va: r.load_va ?? null, a: r.battery_a ?? r.battery_current ?? null, v: r.battery_v ?? null,
    gridV: r.grid_voltage ?? null, gridHz: r.grid_hz ?? null, gridW: r.grid_w ?? null, outV: r.output_voltage ?? null,
    outHz: r.output_frequency ?? null, temp: r.temp_c ?? null, loadPct: r.load_pct ?? null, src: r.timestamp ? 'cloud' : 'hand',
  }
}

// Points with gaps in their fields filled from the reading before (or, at the start, after): a hand-logged row
// with no load or no mode carries its neighbour's.
export function fillGaps(points) {
  const keys = ['mode', 'w', 'v']
  const out = points.map((p) => ({ ...p }))
  for (const k of keys) {
    let last = out.find((p) => p[k] != null)?.[k] ?? (k === 'mode' ? 2 : 0)
    for (const p of out) {
      if (p[k] == null) p[k] = last
      else last = p[k]
    }
  }
  return out
}

// Collector readings win; a cloud point is kept only where no collector reading lies within 3 minutes.
export function mergePoints(local, cloud) {
  const ts = local.map((p) => p.t)
  const near = (t) => {
    let lo = 0
    let hi = ts.length
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (ts[m] < t) lo = m + 1
      else hi = m
    }
    return (lo < ts.length && ts[lo] - t < 180_000) || (lo > 0 && t - ts[lo - 1] < 180_000)
  }
  return [...local, ...cloud.filter((p) => !near(p.t))].sort((a, b) => a.t - b.t)
}

// A day as n slots (96 = quarter hours), one letter each: b on battery, c charging, g on mains, . nothing read
// (no reading in force: before the first, after the last, or inside a hole).
export function daySlots(points, from, to, n = 96) {
  let out = ''
  let i = -1
  const step = (to - from) / n
  for (let k = 0; k < n; k++) {
    const s = from + (k + 0.5) * step
    while (i + 1 < points.length && points[i + 1].t <= s) i++
    const p = points[i]
    const q = points[i + 1]
    const held = p && (q ? !isHole(p, q) : s - p.t <= limitOf(p))
    out += !held ? '.' : p.mode === 3 ? 'b' : p.a > 2.8 ? 'c' : 'g'
  }
  return out
}

// "1 ч 05 мин" pieces for the countdown: [hh, mm, ss] with hours uncapped.
export function hms(sec) {
  const s = Math.max(0, Math.floor(sec))
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
}
