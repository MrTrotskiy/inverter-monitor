// After the owner's discharge test: what his bank really holds, from the collector's 5-second readings.
//   node admin/calibrate.mjs <day> [--next <day>] [--write] [--force]
// Finds the longest run on battery that started from a full bank, and works out:
//   energy out, three ways: by the load (output W × loss + idle), by the inverter's battery meter (V × A, whose
//     current is cut to 2.8 A steps and reads low), and by the recharge after it (A·h back × 13 V, at 50 A where the
//     steps matter least) — the recharge is the best, the others bound it;
//   the inverter's own draw: battery energy minus output energy, over the hours;
//   the discharge curve (displayed and load-corrected voltage every 50 Wh), the wiring's resistance from load steps,
//   whether the knee was reached;
//   usable capacity to the 10 % floor (= the energy out at the stop) and to the cut-off (≈ that / 0.9).
// --write puts it in data/calibration.json, which the admin reads (the countdown, the Банк page). It refuses a run
// shallower than 60 % of the datasheet bank unless --force: a short run says little about the whole.
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readDay, DONGLE_DIR } from './feed.mjs'
import { kyivDay, kyivMidnight, nextDay, TEST } from './src/lib/admin/model.js'

const DATA = process.env.INVERTER_DATA || fileURLToPath(new URL('../data', import.meta.url))
const NAMEPLATE = 2560
const LOSS0 = 0.02

export function analyse(rows) {
  rows = rows.filter((r) => r.ms_t && r.bat_v != null).sort((a, b) => a.ms_t - b.ms_t)
  // runs on battery (mode 3), a break of > 2 min ends one
  const runs = []
  let cur = null
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.mode === 3) {
      if (!cur || r.ms_t - rows[i - 1].ms_t > 120_000 || rows[i - 1].mode !== 3) runs.push((cur = { a: i, b: i }))
      else cur.b = i
    } else cur = null
  }
  if (!runs.length) return { ok: false, why: 'в этот день банк не разряжался' }
  const run = runs.reduce((x, y) => (rows[y.b].ms_t - rows[y.a].ms_t > rows[x.b].ms_t - rows[x.a].ms_t ? y : x))
  const seg = rows.slice(run.a, run.b + 1)
  // was it full before? the last 30 min before the run: on mains, no charging current (≤ one step)
  const before = rows.slice(0, run.a).filter((r) => r.ms_t >= seg[0].ms_t - 30 * 60_000)
  const fullBefore = before.length > 10 && before.every((r) => r.mode === 2 && r.bat_a <= 2.8) && before.some((r) => r.bat_v >= 13.9)

  let eLoad = 0
  let eMeter = 0
  let hours = 0
  const curve = []
  let wh = 0
  let nextMark = 0
  const steps = []
  for (let i = 1; i < seg.length; i++) {
    const a = seg[i - 1]
    const b = seg[i]
    const dt = (b.ms_t - a.ms_t) / 3.6e6
    if (dt * 3600 > 60) continue
    hours += dt
    eLoad += ((a.out_w + b.out_w) / 2) * dt
    eMeter += (-(a.bat_w + b.bat_w) / 2) * dt
    wh += ((a.out_w + b.out_w) / 2 * (1 + LOSS0) + 20) * dt
    if (Math.abs(b.out_w - a.out_w) >= 80 && dt * 3600 <= 6) steps.push({ dv: b.bat_v - a.bat_v, di: (b.out_w - a.out_w) / b.bat_v })
    if (wh >= nextMark) {
      curve.push({ wh: Math.round(wh), v: b.bat_v, vc: Math.round((b.bat_v + ((b.out_w * (1 + LOSS0) + 20) / b.bat_v) * TEST.R) * 100) / 100, w: b.out_w })
      nextMark += 50
    }
  }
  // the recharge after the run: A·h until the current falls to one step for 5 min
  const after = rows.slice(run.b + 1)
  let ah = 0
  let fullAt = null
  let low = null
  for (let i = 1; i < after.length; i++) {
    const a = after[i - 1]
    const b = after[i]
    if (b.mode !== 2) break
    const dt = (b.ms_t - a.ms_t) / 3.6e6
    if (dt * 3600 <= 60 && b.bat_a > 0) ah += ((Math.max(0, a.bat_a) + b.bat_a) / 2) * dt
    if (ah > 1 && b.bat_a <= 2.8) {
      low = low ?? b.ms_t
      if (b.ms_t - low >= 5 * 60_000) {
        fullAt = low
        break
      }
    } else low = null
  }
  const eRecharge = fullAt ? ah * 13.0 * 0.98 : null // ≈98 % coulombic for LFP; 13.0 V: the bank's mean on the way down
  const best = eRecharge ?? eMeter
  const overheadW = hours ? (best - eLoad) / hours : null
  const idleW = overheadW != null ? Math.max(0, overheadW - (LOSS0 * eLoad) / Math.max(hours, 1e-9)) : null
  const r = steps.length >= 3 ? median(steps.map((s) => -s.dv / s.di).filter((x) => x > 0 && x < 0.2)) : null
  const tail = curve.slice(-3)
  const kneeReached = curve.length > 4 && tail.length === 3 && (curve.find((c) => c.wh >= curve.at(-1).wh - TEST.kneeWh)?.vc ?? 0) - curve.at(-1).vc >= TEST.kneeDropV
  return {
    ok: true, from: seg[0].ms_t, to: seg.at(-1).ms_t, hours: round(hours, 2), fullBefore, kneeReached,
    loadMeanW: round(eLoad / hours), eLoadWh: round(eLoad), eMeterWh: round(eMeter), eRechargeWh: eRecharge && round(eRecharge), rechargeAh: round(ah, 1), rechargeFullAt: fullAt,
    eOutWh: round(best), eOutRange: [round(Math.min(eMeter, eRecharge ?? eMeter, eLoad * (1 + LOSS0) + 20 * hours)), round(Math.max(eMeter, eRecharge ?? eMeter, eLoad * (1 + LOSS0) + 20 * hours))],
    idleW: idleW != null ? round(idleW, 1) : null, loss: LOSS0, R: r != null ? round(r, 4) : null,
    floorWh: round(best), capWh: round(best / (1 - TEST.floorPct / 100)), depthPct: round((100 * best) / NAMEPLATE), curve,
    vEnd: seg.at(-1).bat_v,
  }
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y)
  return s.length ? s[Math.floor(s.length / 2)] : null
}
const round = (x, d = 0) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d)

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const day = args.find((a) => /^\d{4}-\d\d-\d\d$/.test(a)) ?? kyivDay(Date.now())
  const rows = [...readDay(day), ...readDay(nextDay(day))]
  const res = analyse(rows)
  if (!res.ok) {
    console.log(res.why)
    process.exit(1)
  }
  const when = (t) => new Date(t).toLocaleString('ru-RU', { timeZone: 'Europe/Kyiv' })
  console.log(`run ${when(res.from)} → ${when(res.to)}, ${res.hours} h, mean load ${res.loadMeanW} W, from full: ${res.fullBefore}, knee: ${res.kneeReached}, end ${res.vEnd} V`)
  console.log(`energy out: recharge ${res.eRechargeWh ?? '—'} Wh (${res.rechargeAh} Ah), battery meter ${res.eMeterWh} Wh, by load ${res.eLoadWh} Wh at the socket`)
  console.log(`→ to the 10 % floor ${res.floorWh} Wh (range ${res.eOutRange.join('–')}), to the cut-off ≈ ${res.capWh} Wh; inverter's own draw ≈ ${res.idleW} W; wiring ${res.R ?? '—'} Ω; depth ${res.depthPct} % of ${NAMEPLATE}`)
  if (args.includes('--write')) {
    if (res.depthPct < 60 && !args.includes('--force')) {
      console.log('not written: the run is shallower than 60 % of the datasheet bank (--force to write anyway)')
      process.exit(2)
    }
    mkdirSync(DATA, { recursive: true })
    writeFileSync(`${DATA}/calibration.json`, JSON.stringify({ measuredAt: new Date().toISOString(), day, ...res }, null, 1))
    console.log(`written: ${DATA}/calibration.json`)
  }
}
