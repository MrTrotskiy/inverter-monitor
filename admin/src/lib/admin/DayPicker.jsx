import { useState } from 'react'
import { C } from './theme.js'

const label = (day, opts) => new Date(day + 'T12:00:00+03:00').toLocaleDateString('ru-RU', { timeZone: 'Europe/Kyiv', ...opts })

// The day to look at: a button with the date, and under it every day that has readings, newest first, each with
// its outages, hours on battery, energy out of and into the bank, and where the readings came from.
export function DayPicker({ days, day, today, onPick }) {
  const [open, setOpen] = useState(false)
  const list = [...(days ?? [])].reverse()
  if (today && !list.some((d) => d.day === today)) list.unshift({ day: today, empty: true })
  const maxS = Math.max(3600, ...list.map((d) => d.batS ?? 0))
  return (
    <div style={{ position: 'relative', flex: 'none' }} data-pan="none" data-wheel="own">
      <button className="adm-btn" onClick={() => setOpen(!open)} title="выбрать день ([ и ] — соседний)"
        style={{ padding: '8px 14px', borderRadius: 12, fontSize: 16, fontWeight: 650, color: C.ink, background: open ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)', whiteSpace: 'nowrap' }}>
        📅 {day ? (day === today ? 'сегодня' : label(day, { weekday: 'short', day: 'numeric', month: 'short' })) : '…'} <span style={{ color: C.dim }}>▾</span>
      </button>
      {open ? (
        <div style={{ position: 'absolute', top: 46, left: 0, zIndex: 20, width: 470, maxHeight: 520, overflowY: 'auto', padding: 8, borderRadius: 16,
          background: 'rgba(12,17,32,0.97)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 24px 60px rgba(0,0,0,0.6)' }}>
          {list.map((d) => {
            const on = d.day === day
            return (
              <button key={d.day} className="adm-btn" onClick={() => { onPick(d.day); setOpen(false) }} disabled={d.empty && d.day !== today}
                style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 10, marginBottom: 2,
                  background: on ? 'rgba(255,255,255,0.1)' : 'transparent', border: `1px solid ${on ? 'rgba(255,255,255,0.25)' : 'transparent'}`, color: C.ink }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{d.day === today ? 'сегодня' : label(d.day, { day: 'numeric', month: 'short' })}</div>
                  <div style={{ fontSize: 12, color: C.dim }}>{label(d.day, { weekday: 'long' })}</div>
                </div>
                {d.empty ? (
                  <div style={{ fontSize: 14, color: C.dim, alignSelf: 'center' }}>ничего не прочитано</div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', gap: 14, fontSize: 14, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      <span><span style={{ color: C.battery }}>⚡</span> {d.outages}</span>
                      <span><span style={{ color: C.battery }}>↓</span> {d.outWh} Вт·ч</span>
                      <span><span style={{ color: C.charging }}>↑</span> {d.inWh} Вт·ч</span>
                    </div>
                    <svg width={300} height={6} style={{ display: 'block', margin: '5px 0 3px' }}>
                      <rect width={300} height={6} rx={3} fill="rgba(255,255,255,0.07)" />
                      <rect width={Math.max(d.batS ? 3 : 0, (300 * d.batS) / maxS)} height={6} rx={3} fill={C.battery} />
                    </svg>
                    <div style={{ fontSize: 12, color: C.dim }}>
                      {Math.round(d.batS / 360) / 10} ч от батарей · {[d.local ? `донгл ${d.local} мин` : null, d.cloud ? `облако ${d.cloud} пакет${d.cloud % 10 === 1 && d.cloud !== 11 ? '' : d.cloud % 10 >= 2 && d.cloud % 10 <= 4 && (d.cloud < 12 || d.cloud > 14) ? 'а' : 'ов'}` : null].filter(Boolean).join(' · ')}
                      {d.cloud + d.local < 6 ? ' · мало данных' : ''}
                    </div>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
