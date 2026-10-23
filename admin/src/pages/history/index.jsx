// @page: Месяцы: банк по дням
import { useEffect, useMemo, useState } from 'react'
import { Scene, useFrameSize, Drawer, asset, useExpose } from '@/space'
import { useDays } from '../../lib/admin/feeds.js'
import { C, SANS } from '../../lib/admin/theme.js'
import { kyivDay } from '../../lib/admin/model.js'
import { Bars } from './Bars.jsx'
import { Calendar } from './Calendar.jsx'
import { DayLine, SpanFacts } from './Facts.jsx'
import '../../lib/admin/admin.css'

// month arithmetic on 'YYYY-MM'
const addMonths = (ym, k) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + k, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const daysOf = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)
}
export const openDay = (day) => window.location.assign(asset(`admin?day=${day}`))

export default function Page() {
  const { width, height } = useFrameSize()
  const days = useDays()
  const today = kyivDay(Date.now())
  const [span, setSpan] = useState(2) // months on the screen
  const [last, setLast] = useState(today.slice(0, 7)) // the last month shown
  const [hover, setHover] = useState(null)

  const months = useMemo(() => Array.from({ length: span }, (_, i) => addMonths(last, i - span + 1)), [span, last])
  const byDay = useMemo(() => Object.fromEntries((days ?? []).map((d) => [d.day, d])), [days])
  const list = useMemo(() => months.flatMap(daysOf).map((day) => ({ day, d: byDay[day] ?? null, future: day > today })), [months, byDay, today])
  const firstData = days?.[0]?.day

  useExpose('history', { span: setSpan, last: setLast, hover: setHover, list: () => list.map((x) => ({ day: x.day, has: !!x.d })) })
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') setLast((m) => addMonths(m, -1))
      else if (e.key === 'ArrowRight') setLast((m) => addMonths(m, 1))
      else if (['1', '2', '3'].includes(e.key)) setSpan(Number(e.key))
      else if (e.key === 'Enter' && hover && byDay[hover]) openDay(hover)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const w = width || 1400
  const h = height || 900
  const pad = 28
  const barsTop = 128
  const barsH = Math.round(Math.min(230, h * 0.26))
  const calTop = barsTop + barsH + 34
  return (
    <Scene mode="app" tone="dark">
      <div style={{ position: 'relative', width: w, height: h, overflow: 'hidden', color: C.ink, fontFamily: SANS,
        background: `radial-gradient(1400px 900px at 50% 0%, #0d1530 0%, ${C.bg} 65%)` }}>
        <div style={{ position: 'absolute', left: pad, right: pad, top: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href={asset('admin')} className="adm-btn" style={btn(false)}>← админка</a>
          <span style={{ width: 12 }} />
          <button className="adm-btn" style={btn(false)} onClick={() => setLast((m) => addMonths(m, -1))} title="раньше (←)">‹</button>
          <span style={{ fontSize: 20, fontWeight: 700, minWidth: 220, textAlign: 'center', whiteSpace: 'nowrap' }}>{rangeName(months)}</span>
          <button className="adm-btn" style={btn(false)} onClick={() => setLast((m) => addMonths(m, 1))} title="позже (→)">›</button>
          <span style={{ width: 12 }} />
          {[1, 2, 3].map((k) => (
            <button key={k} className="adm-btn" style={btn(span === k)} onClick={() => setSpan(k)} title={`клавиша ${k}`}>{k} мес</button>
          ))}
          {last !== today.slice(0, 7) ? <button className="adm-btn" style={btn(false)} onClick={() => setLast(today.slice(0, 7))}>↺ к сегодня</button> : null}
          <span style={{ flex: 1 }} />
          <SpanFacts list={list} />
        </div>
        <div style={{ position: 'absolute', left: pad, right: pad, top: 76, height: 40 }}>
          <DayLine day={hover} d={hover ? byDay[hover] : null} firstData={firstData} today={today} />
        </div>
        {days == null ? (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: C.dim, fontSize: 20 }}>загружаю…</div>
        ) : (
          <>
            <div style={{ position: 'absolute', left: pad, top: barsTop }}>
              <Bars list={list} w={w - 2 * pad} h={barsH} hover={hover} setHover={setHover} onOpen={openDay} today={today} />
            </div>
            <div style={{ position: 'absolute', left: pad, top: calTop }}>
              <Calendar months={months} byDay={byDay} w={w - 2 * pad} h={h - calTop - 22} hover={hover} setHover={setHover} onOpen={openDay} today={today} />
            </div>
          </>
        )}
      </div>
      <Drawer title="Что здесь" side="right" w={400}>
        <div style={{ padding: '4px 4px 24px', fontSize: 15, lineHeight: 1.5 }}>
          <p style={{ margin: '0 0 12px' }}><b>Столбики</b> — каждый день: вверх голубым — Вт·ч в банк (зарядка), вниз янтарём — Вт·ч из банка (от батарей). <b>Календарь</b> — те же дни: полоска — сутки по четверти часа (янтарь — от батарей, голубой — зарядка, зелёный — сеть, пусто — ничего не прочитано), ⚡ — отключения, часы — сколько от батарей.</p>
          <p style={{ margin: '0 0 12px' }}>Нажмите на день — откроется в админке целиком. Наведите — сверху строка с подробностями. Клавиши: ← → месяц, 1 2 3 — сколько месяцев, Enter — открыть день под курсором.</p>
          <p style={{ margin: '0 0 12px', color: 'var(--sk-soft)' }}>Данные: облако DessMonitor с сентября и коллектор на Mac mini с 23 октября (каждые 5{' '}с). Облачный даталоггер почти весь сентябрь–октябрь отдавал один и тот же «замороженный» пакет, поэтому у большинства прошлых дней чтений нет или их единицы — это показано у каждого дня. 17–18 сентября — записи теста вручную. Вт·ч из банка считаются по нагрузке (× 1,02 + 20 Вт инвертора), в банк — ток зарядки × напряжение; промежутки без чтений не досчитываются.</p>
        </div>
      </Drawer>
    </Scene>
  )
}

const btn = (on) => ({
  padding: '8px 14px', borderRadius: 999, fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', textDecoration: 'none', cursor: 'pointer',
  color: on ? C.bg : C.ink, background: on ? C.ink : 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
})

function rangeName(months) {
  const name = (ym, withYear) => new Date(ym + '-15T12:00:00Z').toLocaleDateString('ru-RU', { month: 'long', ...(withYear ? { year: 'numeric' } : {}) }).replace(' г.', '')
  return months.length === 1 ? name(months[0], true) : `${name(months[0])} — ${name(months.at(-1), true)}`
}
