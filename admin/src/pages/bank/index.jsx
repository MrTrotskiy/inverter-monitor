// @page: Банк: сколько держит
// What the bank really holds, from the owner's discharge test (admin/calibrate.mjs → data/calibration.json), or the
// datasheet until then; how long it lasts at a load; the curve; and the test mode that puts the STOP on the admin.
import { useMemo, useState } from 'react'
import { Scene, useFrameSize, asset, useExpose } from '@/space'
import { C, SANS, nf } from '../../lib/admin/theme.js'
import { calibrate, drawW, TEST } from '../../lib/admin/model.js'
import { usePoll, post } from '../settings/api.js'
import '../../lib/admin/admin.css'

const LOADS = [50, 100, 200, 400, 800, 1200]
const hm = (h) => {
  const m = Math.max(0, Math.round(h * 60))
  return m >= 60 ? `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин` : `${m} мин`
}

export default function Page() {
  const { width, height } = useFrameSize()
  const w = width || 1400
  const h = height || 900
  const [api, refresh] = usePoll('api/bank', 10_000)
  const [load, setLoad] = useState(100)
  const cal = api?.calibration
  const c = useMemo(() => calibrate(cal), [cal?.measuredAt])
  const measured = c.source === 'measured'
  const capWh = c.capWh
  const floorWh = measured ? cal.floorWh : capWh * (1 - TEST.floorPct / 100)
  const test = api?.test

  useExpose('bank', { load: setLoad, api: () => api })
  const pad = 28
  const colW = (w - 2 * pad - 20) / 2
  const toggle = async () => {
    await post('api/bank/test', { on: !test?.on })
    refresh()
  }
  return (
    <Scene mode="app" tone="dark">
      <div style={{ position: 'relative', width: w, height: h, overflow: 'hidden', color: C.ink, fontFamily: SANS, background: `radial-gradient(1400px 900px at 50% 0%, #0d1530 0%, ${C.bg} 65%)` }}>
        <div style={{ position: 'absolute', left: pad, right: pad, top: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
          <a href={asset('admin')} className="adm-btn" style={pill}>← админка</a>
          <span style={{ fontSize: 22, fontWeight: 750 }}>Банк</span>
          <span style={{ ...pill, cursor: 'default', color: measured ? C.full : C.battery, borderColor: measured ? `${C.full}88` : `${C.battery}88` }}>
            {measured ? `измерено ${new Date(cal.from).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}` : 'по паспорту — ещё не измерено'}
          </span>
        </div>

        <section style={{ position: 'absolute', left: pad, top: 80, width: colW, bottom: 20, ...card }}>
          <Title text="сколько держит, от полного" />
          <div style={{ display: 'flex', gap: 28, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <Big v={nf(floorWh)} unit="Вт·ч" sub={`до ${TEST.floorPct} % (ваш запас)`} color={C.full} />
            <Big v={nf(capWh)} unit="Вт·ч" sub="до отключения инвертора" color={C.dim} />
            <Big v={nf(c.idleW, measured ? 1 : 0)} unit="Вт" sub="сам инвертор" color={C.load} />
          </div>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 6 }}>
            {measured
              ? `по дозарядке ${nf(cal.eRechargeWh ?? cal.eOutWh)} Вт·ч, по прибору ${nf(cal.eMeterWh)}, по нагрузке ${nf(cal.eLoadWh)} у розетки · разряд ${nf(cal.hours, 1)} ч при ${nf(cal.loadMeanW)} Вт${cal.kneeReached ? ' · до колена' : ' · колено не достигнуто — ёмкость не меньше'}`
              : `паспорт: 2 × 1280 Вт·ч, в счёт 95 %; свой расход инвертора ~20 Вт (замер 17.09)`}
          </div>

          <Title text="сколько продержится" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <input type="range" min={0} max={100} value={Math.round(Math.log(load / 20) / Math.log(1500 / 20) * 100)} onChange={(e) => setLoad(Math.round(20 * (1500 / 20) ** (e.target.value / 100) / 5) * 5)}
              style={{ flex: 1, accentColor: C.full }} />
            <span style={{ fontSize: 22, fontWeight: 750, width: 100, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{nf(load)} Вт</span>
          </div>
          <div style={{ display: 'flex', gap: 28, marginTop: 8 }}>
            <Big v={hm(floorWh / drawW(load))} sub={`до ${TEST.floorPct} %`} color={C.full} />
            <Big v={hm(capWh / drawW(load))} sub="до отключения" color={C.dim} />
          </div>
          <table style={{ marginTop: 14, borderCollapse: 'collapse', fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
            <tbody>
              {LOADS.map((L) => (
                <tr key={L} onClick={() => setLoad(L)} style={{ cursor: 'pointer', color: L === load ? C.ink : C.dim }}>
                  <td style={{ padding: '3px 18px 3px 0', textAlign: 'right' }}>{nf(L)} Вт</td>
                  <td style={{ padding: '3px 18px 3px 0', color: L === load ? C.full : undefined }}>{hm(floorWh / drawW(L))}</td>
                  <td style={{ padding: '3px 0' }}>{hm(capWh / drawW(L))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Title text="кривая разряда" />
          {measured && cal.curve?.length > 2 ? <Curve curve={cal.curve} w={colW - 40} h={Math.max(120, h - 640)} floorWh={floorWh} /> : <div style={{ color: C.dim, fontSize: 14 }}>появится после теста</div>}
        </section>

        <section style={{ position: 'absolute', left: pad + colW + 20, top: 80, width: colW, ...card }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Title text="тест разряда" />
            <span style={{ flex: 1 }} />
            <button className="adm-btn" onClick={toggle} style={{ ...pill, background: test?.on ? `${C.full}22` : 'rgba(255,255,255,0.06)', borderColor: test?.on ? `${C.full}88` : 'rgba(255,255,255,0.14)', color: test?.on ? C.full : C.ink }}>
              {test?.on ? '● тест идёт — выключить' : 'начать тест'}
            </button>
          </div>
          <ol style={{ margin: '6px 0 0', paddingLeft: 22, fontSize: 15.5, lineHeight: 1.7, listStyle: 'decimal' }}>
            <li>Включить инвертор, сеть есть. Ждать <b>«банк полный»</b> на админке.</li>
            <li>«Начать тест» здесь.</li>
            <li>Отключить сеть на входе инвертора. Нагрузка ровная, <b>около 300 Вт</b>, не больше 400 (≈ 5–7 ч): больше — сильнее просадка в проводах.</li>
            <li>Смотреть админку: полоса внизу — сколько отдано и сколько до стопа.</li>
            <li>Красное <b>«СТОП — включите сеть»</b> → включить сеть. Mac и роутер не гаснут.</li>
            <li>Дать зарядиться до полного (≈ 4–5 ч) — дозарядка тоже замер.</li>
          </ol>
          <div style={{ fontSize: 13.5, color: C.dim, lineHeight: 1.55, marginTop: 10 }}>
            СТОП — что раньше: отдано 90 % банка ({nf(capWh * 0.9)} Вт·ч); колено — напряжение с поправкой на ток упало на {nf(TEST.kneeDropV, 1)} В за 100 Вт·ч;
            ≤ {nf(TEST.stopV, 1)} В с поправкой; или ≤ {nf(TEST.hardV, 1)} В на экране. 11,7 В — это отключение инвертора, не 10 %.
          </div>
        </section>
      </div>
    </Scene>
  )
}

function Curve({ curve, w, h, floorWh }) {
  const maxWh = Math.max(...curve.map((c) => c.wh), floorWh)
  const vs = curve.flatMap((c) => [c.v, c.vc])
  const lo = Math.floor(Math.min(...vs) * 10) / 10 - 0.1
  const hi = Math.ceil(Math.max(...vs) * 10) / 10 + 0.1
  const x = (wh) => 36 + (wh / maxWh) * (w - 44)
  const y = (v) => 8 + (1 - (v - lo) / (hi - lo)) * (h - 30)
  const line = (k) => curve.map((c, i) => `${i ? 'L' : 'M'}${x(c.wh).toFixed(1)},${y(c[k]).toFixed(1)}`).join('')
  return (
    <svg width={w} height={h}>
      {[lo, (lo + hi) / 2, hi].map((v) => <text key={v} x={0} y={y(v) + 4} fontSize={11} fill={C.dim}>{nf(v, 1)}</text>)}
      <path d={line('vc')} fill="none" stroke={C.full} strokeWidth={2} />
      <path d={line('v')} fill="none" stroke={C.dim} strokeWidth={1.2} strokeDasharray="4 3" />
      <line x1={x(floorWh)} x2={x(floorWh)} y1={4} y2={h - 22} stroke={C.battery} strokeDasharray="3 4" />
      <text x={x(floorWh) - 6} y={16} fontSize={11} fill={C.battery} textAnchor="end">стоп {nf(floorWh)} Вт·ч</text>
      <text x={36} y={h - 6} fontSize={11} fill={C.dim}>0</text>
      <text x={w} y={h - 6} fontSize={11} fill={C.dim} textAnchor="end">{nf(maxWh)} Вт·ч · зелёное — с поправкой на ток, пунктир — на экране</text>
    </svg>
  )
}

const card = { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: '8px 20px 16px' }
const pill = { padding: '8px 14px', borderRadius: 999, fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', textDecoration: 'none', cursor: 'pointer', color: C.ink, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)' }
const Title = ({ text }) => <div style={{ margin: '14px 0 8px', fontSize: 12.5, letterSpacing: 2, textTransform: 'uppercase', color: C.dim }}>{text}</div>
const Big = ({ v, unit, sub, color }) => (
  <div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontSize: 34, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>{v}</span>
      {unit ? <span style={{ fontSize: 15, color: C.dim }}>{unit}</span> : null}
    </div>
    <div style={{ fontSize: 13, color: C.dim }}>{sub}</div>
  </div>
)
