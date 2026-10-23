import { C, nf } from '../../lib/admin/theme.js'

const hrs = (s) => `${nf(s / 3600, s && s < 36000 ? 1 : 0)} ч`
export const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many)

// The whole span in five numbers.
export function SpanFacts({ list }) {
  const has = list.filter((x) => x.d)
  const sum = (k) => has.reduce((a, x) => a + (x.d[k] ?? 0), 0)
  const past = list.filter((x) => !x.future).length
  const items = [
    { icon: '↑', v: `${nf(sum('inWh'))} Вт·ч`, c: C.charging, t: 'в банк' },
    { icon: '↓', v: `${nf(sum('outWh'))} Вт·ч`, c: C.battery, t: 'из банка' },
    { icon: '⚡', v: `${sum('outages')}`, c: C.battery, t: 'отключений' },
    { icon: '◷', v: hrs(sum('batS')), c: C.battery, t: 'от батарей' },
    { icon: '▦', v: `${has.length} из ${past}`, c: C.dim, t: 'дней с данными' },
  ]
  return (
    <div style={{ display: 'flex', gap: 22 }}>
      {items.map((x) => (
        <div key={x.t} style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 18, fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}><span style={{ color: x.c, marginRight: 5 }}>{x.icon}</span>{x.v}</span>
          <span style={{ fontSize: 12, color: C.dim, whiteSpace: 'nowrap' }}>{x.t}</span>
        </div>
      ))}
    </div>
  )
}

// One line about the day under the pointer.
export function DayLine({ day, d, firstData, today }) {
  if (!day) return <div style={{ fontSize: 15, color: C.dim, paddingTop: 8 }}>наведите на день · нажмите — откроется в админке</div>
  const date = new Date(day + 'T12:00:00+03:00').toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })
  if (!d) {
    const why = day > today ? 'ещё не наступил' : firstData && day < firstData ? 'до начала записей' : 'ничего не прочитано — облако было «заморожено», коллектора ещё не было'
    return <div style={{ fontSize: 18, paddingTop: 6 }}><b>{date}</b> <span style={{ color: C.dim }}>· {why}</span></div>
  }
  const src = [d.local ? `донгл ${d.local} мин` : null, d.cloud ? `облако ${d.cloud} ${plural(d.cloud, 'пакет', 'пакета', 'пакетов')}` : null].filter(Boolean).join(' · ')
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 22, fontSize: 18, paddingTop: 6, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
      <b>{date}</b>
      <span><span style={{ color: C.charging }}>↑</span> {nf(d.inWh)} Вт·ч в банк</span>
      <span><span style={{ color: C.battery }}>↓</span> {nf(d.outWh)} Вт·ч из банка</span>
      <span><span style={{ color: C.battery }}>⚡</span> {d.outages} {plural(d.outages, 'отключение', 'отключения', 'отключений')}</span>
      <span><span style={{ color: C.battery }}>◷</span> {hrs(d.batS)} от батарей</span>
      <span style={{ color: C.dim, fontSize: 15 }}>{src}{d.cloud + d.local < 6 ? ' · мало данных' : ''}</span>
      <span style={{ color: C.dim, fontSize: 15 }}>↵ открыть</span>
    </div>
  )
}
