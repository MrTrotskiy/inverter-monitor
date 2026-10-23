import { soc, hoursLeft, chargeEta, replayDay, chargeCurve, screen, hms, dayTotals, daySlots, CAP_WH, CV_TAIL_MIN } from './model.js'

export function chargeCurveFallsFromNowToOneStep() {
  const c = chargeCurve({ t: 0, a: 50.4, eta: 20 * 60_000 })
  const falls = c.every((p, i) => i === 0 || p.a <= c[i - 1].a + 1e-9)
  return c[0].a === 50.4 && c.at(-1).a <= 2.81 && falls && c.at(-1).t >= 20 * 60_000 - 15_000
}

export function screenCountsToCutoffOrToFull() {
  const bat = screen({ t: 0, phase: 'battery', soc: 50, w: 100, a: -8, eta: null })
  const ch = screen({ t: 0, phase: 'charging', soc: 90, w: 50, a: 50, eta: 600_000 })
  const what = screen({ t: 0, phase: 'battery', soc: 50, w: 100, a: -8, eta: null }, { loadW: 400 })
  return near(bat.count, hoursLeft(50, 100) * 3600) && bat.cutoffAt === bat.count * 1000 && ch.count === 600 && ch.curve.length > 10 && what.count < bat.count / 3
}

export function dayTotalsCountsBatteryAndChargeAndSkipsHoles() {
  // 1 h on battery at 100 W, a 30-min hole, then 30 min charging at 50 A × 13.6 V
  const pts = []
  for (let m = 0; m < 60; m += 5) pts.push({ t: m * M, mode: 3, w: 100, a: -8, v: 12.9 })
  pts.push({ t: 60 * M, mode: 2, w: 50, a: 0, v: 13.0 }) // the last battery reading ends the hour; then a 30-min hole
  for (let m = 90; m < 120; m += 5) pts.push({ t: m * M, mode: 2, w: 50, a: 50, v: 13.6 })
  pts.push({ t: 120 * M, mode: 2, w: 50, a: 0, v: 14.1 })
  const r = dayTotals(pts, 200 * M)
  return near(r.outWh, 122) && near(r.batS, 3600) && near(r.inWh, 340) && near(r.loadWh, 125)
}

export function daySlotsMarksBatteryChargeMainsAndHoles() {
  // 4 slots of 1 h: battery 0–1 h, charging 1–2 h, a hole 2–3 h, mains 3–4 h (readings every 5 min)
  const pts = []
  for (let m = 0; m < 60; m += 5) pts.push({ t: m * M, mode: 3, w: 50, a: -5, v: 13 })
  for (let m = 60; m < 120; m += 5) pts.push({ t: m * M, mode: 2, w: 50, a: 40, v: 13.6 })
  for (let m = 180; m < 240; m += 5) pts.push({ t: m * M, mode: 2, w: 50, a: 0, v: 14.1 })
  return daySlots(pts, 0, 240 * M, 4) === 'bc.g'
}

export function hmsKeepsHoursPastADay() {
  const [h, m, s] = hms(29 * 3600 + 61.9)
  return h === 29 && m === 1 && s === 1
}

const M = 60_000
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol

export function fullBankIsHundred() {
  return soc(0) === 100 && near(soc(CAP_WH / 2), 50) && soc(CAP_WH * 2) === 0
}

export function chargeGivenBackRefills() {
  return near(soc(130, 10), 100) && near(soc(260, 10), 100 * (1 - 130 / CAP_WH))
}

export function hoursAtHundredWatts() {
  return near(hoursLeft(100, 100), CAP_WH / 122)
}

export function etaInBulkCountsTheOwedCharge() {
  // 26 Wh owed = 2 A·h at 50 A: 2.4 min, then the 8-minute tail
  return near(chargeEta({ t: 0, spentWh: 26, chargedAh: 0, a: 50 }), 2.4 * M + CV_TAIL_MIN * M)
}

export function etaInTheTailIsFromCvStart() {
  return chargeEta({ t: 3 * M, spentWh: 0, chargedAh: 0, a: 20, cvSince: 0 }) === CV_TAIL_MIN * M
}

export function replayDischargesThenCharges() {
  // one hour at 100 W on battery, then 50 A until it is back
  const pts = [{ t: 0, mode: 3, w: 100, a: -8, v: 12.9 }, { t: 60 * M, mode: 3, w: 100, a: -8, v: 12.9 }, { t: 60 * M + 1, mode: 2, w: 50, a: 50, v: 13.6 }, { t: 75 * M, mode: 2, w: 50, a: 50, v: 13.7 }, { t: 76 * M, mode: 2, w: 50, a: 0, v: 14.1 }]
  const at = replayDay(pts, { start: 0 })
  const mid = at(30 * M)
  const end = at(60 * M)
  const ch = at(62 * M)
  const full = at(80 * M)
  return mid.phase === 'battery' && near(mid.spentWh, 61, 0.01) && near(end.spentWh, 122, 0.01) && ch.phase === 'charging' && ch.eta > 62 * M && full.phase === 'full' && full.soc === 100
}
