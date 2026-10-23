// node check_calibrate.mjs — calibrate.mjs on a made-up test day whose truth is known: full at 14.1 V for an hour,
// then 300–500 W from the bank (the inverter takes the output × 1.03 + 22 W) down past the knee, the battery current
// read as the inverter does (2.8 A steps, cut toward zero), the voltage sagging 22 mΩ under load, then the recharge
// at 50.4 A to full. The answers must come back near the truth. And the real 23 Oct: no collector discharge.
import { analyse } from './calibrate.mjs'
import { readDay } from './feed.mjs'
import { discharge } from './src/lib/admin/model.js'

const results = []
const check = (name, ok, note = '') => {
  results.push(!!ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${note ? ' — ' + note : ''}`)
}
const step = (a) => Math.trunc(a / 2.8) * 2.8
const T0 = Date.parse('2026-10-24T08:00:00+03:00')
const TRUE_IDLE = 22
const TRUE_LOSS = 0.03
const TRUE_WH = 2150 // the bank gives this much before the stop
const ocv = (whOut) => (whOut < 1800 ? 13.25 - whOut * 0.00012 : 13.25 - 1800 * 0.00012 - (whOut - 1800) * 0.0025)

const rows = []
let t = T0
for (; t < T0 + 3600_000; t += 5000) rows.push({ ms_t: t, mode: 2, out_w: 60, bat_v: 14.1, bat_a: 0, bat_w: 0 })
let out = 0
let k = 0
while (out < TRUE_WH) {
  const w = [400, 300, 500, 400][Math.floor(k / 400) % 4] // a load step every ~33 min
  const pBat = w * (1 + TRUE_LOSS) + TRUE_IDLE
  const v0 = ocv(out)
  const i = pBat / v0
  const v = Math.round((v0 - i * 0.022) * 10) / 10
  rows.push({ ms_t: t, mode: 3, out_w: w, bat_v: v, bat_a: -step(i), bat_w: -Math.round(step(i) * v) })
  out += (pBat * 5) / 3600
  t += 5000
  k++
}
const outTrue = out
let ah = 0
const needAh = outTrue / 13.0 / 0.98
while (ah < needAh) {
  rows.push({ ms_t: t, mode: 2, out_w: 60, bat_v: 13.7, bat_a: 50.4, bat_w: 690 })
  ah += (50.4 * 5) / 3600
  t += 5000
}
for (let j = 0; j < 120; j++, t += 5000) rows.push({ ms_t: t, mode: 2, out_w: 60, bat_v: 14.1, bat_a: 0, bat_w: 0 })

const r = analyse(rows)
const near = (x, y, tol) => Math.abs(x - y) <= tol * y
check('finds the run, from full, knee reached', r.ok && r.fullBefore && r.kneeReached, `${r.hours} h, knee ${r.kneeReached}`)
check('energy out by the recharge within 3 % of the truth', near(r.eRechargeWh, outTrue, 0.03), `${r.eRechargeWh} vs ${Math.round(outTrue)}`)
check('the battery meter reads low (2.8 A steps), and the range holds the truth', r.eMeterWh < outTrue && r.eOutRange[0] <= outTrue * 1.03 && r.eOutRange[1] >= outTrue * 0.97, `${r.eMeterWh}, ${r.eOutRange}`)
check('the inverter\'s own draw comes out near 22 W + the 1 % extra loss', r.idleW > 15 && r.idleW < 40, `${r.idleW} W`)
check('the wiring resistance from the load steps ≈ 22 mΩ', r.R != null && near(r.R, 0.022, 0.5), `${r.R}`)
check('to the cut-off = the floor / 0.9', Math.abs(r.capWh - r.floorWh / 0.9) <= 1)

// the live STOP on the same data: it must come on before the end of the run, not before the knee
const pts = rows.map((x) => ({ t: x.ms_t, mode: x.mode, w: x.out_w, v: x.bat_v, a: x.bat_a }))
const endRun = rows.filter((x) => x.mode === 3).at(-1).ms_t
let firstStop = null
for (let tt = T0 + 3600_000; tt <= endRun; tt += 60_000) {
  const d = discharge(pts, tt)
  if (d?.why) {
    firstStop = { tt, d }
    break
  }
}
const whAtStop = firstStop?.d.wh
check('the live «СТОП» comes on near the knee, not on the plateau', firstStop && whAtStop > 1700 && whAtStop <= outTrue, `${firstStop?.d.why} at ${Math.round(whAtStop)} Wh of ${Math.round(outTrue)}`)

const real = analyse(readDay('2026-10-23'))
check('the real 23 Oct: the collector saw no discharge, nothing to calibrate', !real.ok, real.why)
console.log(`${results.filter(Boolean).length}/${results.length}`)
process.exit(results.every(Boolean) ? 0 : 1)
