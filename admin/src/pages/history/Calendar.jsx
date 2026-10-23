import { C, nf } from '../../lib/admin/theme.js'

const COL = { b: C.battery, c: C.charging, g: C.full }
const WEEK = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

// The months side by side, a week a row. Each day: its number, ⚡ outages, a strip of the 24 hours (what the bank
// did each quarter hour, empty where nothing was read), Wh in and out as two bars, hours on battery.
export function Calendar({ months, byDay, w, h, hover, setHover, onOpen, today }) {
  const gap = 34
  const bw = (w - gap * (months.length - 1)) / months.length
  return (
    <div style={{ display: 'flex', gap }} onPointerLeave={() => setHover(null)}>
      {months.map((ym) => <Month key={ym} ym={ym} byDay={byDay} w={bw} h={h} hover={hover} setHover={setHover} onOpen={onOpen} today={today} />)}
    </div>
  )
}

function Month({ ym, byDay, w, h, hover, setHover, onOpen, today }) {
  const [y, m] = ym.split('-').map(Number)
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7 // Monday first
  const rows = Math.ceil((lead + n) / 7)
  const cw = (w - 6 * 6) / 7
  const ch = Math.max(56, Math.min(cw * 1.15, (h - 58) / rows - 6))
  const max = Math.max(100, ...Object.values(byDay).filter((d) => d.day.startsWith(ym)).flatMap((d) => [d.inWh, d.outWh]))
  return (
    <div style={{ width: w }}>
      <div style={{ fontSize: 22, fontWeight: 750, marginBottom: 8, textTransform: 'capitalize' }}>
        {new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('ru-RU', { month: 'long' })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(7, ${cw}px)`, gap: 6 }}>
        {WEEK.map((d) => <div key={d} style={{ fontSize: 12, color: C.dim, paddingLeft: 4 }}>{d}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`l${i}`} />)}
        {Array.from({ length: n }, (_, i) => {
          const day = `${ym}-${String(i + 1).padStart(2, '0')}`
          return <Cell key={day} day={day} d={byDay[day]} w={cw} h={ch} max={max} on={hover === day} setHover={setHover} onOpen={onOpen} today={today} />
        })}
      </div>
    </div>
  )
}

function Cell({ day, d, w, h, max, on, setHover, onOpen, today }) {
  const future = day > today
  const few = d && d.cloud + d.local < 6
  const big = w >= 120 && h >= 92
  const mid = !big && w >= 78 && h >= 86
  const sw = w - 16
  return (
    <div onPointerEnter={() => setHover(day)} onClick={() => d && onOpen(day)} className={d ? 'adm-btn' : ''}
      style={{ position: 'relative', width: w, height: h, borderRadius: 10, padding: '6px 8px', boxSizing: 'border-box', cursor: d ? 'pointer' : 'default', overflow: 'hidden',
        background: d ? (on ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)') : future ? 'transparent' : on ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.015)',
        border: `1px solid ${day === today ? 'rgba(255,255,255,0.55)' : d ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: d ? C.ink : future ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.32)' }}>{Number(day.slice(8))}</span>
        {d?.outages ? <span style={{ fontSize: 13, fontWeight: 700, color: C.battery }}>⚡{d.outages > 1 ? d.outages : ''}</span> : few ? <span title="мало данных" style={{ fontSize: 11, color: C.dim }}>{w >= 84 ? 'мало' : '·'}</span> : null}
      </div>
      {d ? (
        <>
          <Strip slots={d.slots} w={sw} h={big ? 10 : 7} />
          <svg width={sw} height={big ? 16 : 10} style={{ display: 'block', marginTop: 5 }}>
            <rect x={0} y={0} width={Math.max(d.inWh ? 2 : 0, (d.inWh / max) * sw)} height={big ? 6 : 4} rx={2} fill={C.charging} />
            <rect x={0} y={big ? 9 : 6} width={Math.max(d.outWh ? 2 : 0, (d.outWh / max) * sw)} height={big ? 6 : 4} rx={2} fill={C.battery} />
          </svg>
          {big ? (
            <div style={{ display: 'flex', gap: 8, fontSize: 12, marginTop: 3, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: C.dim }}>
              <span><span style={{ color: C.charging }}>↑</span>{nf(d.inWh)}</span>
              <span><span style={{ color: C.battery }}>↓</span>{nf(d.outWh)}</span>
              {d.batS ? <span>◷{nf(d.batS / 3600, 1)} ч</span> : null}
            </div>
          ) : mid ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 6, fontSize: 11, marginTop: 2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: C.dim }}>
              <span><span style={{ color: C.charging }}>↑</span>{nf(d.inWh)}</span>
              <span><span style={{ color: C.battery }}>↓</span>{nf(d.outWh)}</span>
            </div>
          ) : null}
        </>
      ) : !future ? (
        <div style={{ position: 'absolute', left: 8, right: 8, bottom: 10, height: 6, borderRadius: 3, background: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.07) 0 3px, transparent 3px 7px)' }} />
      ) : null}
    </div>
  )
}

// 96 quarter hours as runs of colour
function Strip({ slots, w, h }) {
  const runs = []
  for (let i = 0; i < slots.length; ) {
    let j = i
    while (j < slots.length && slots[j] === slots[i]) j++
    runs.push([i, j, slots[i]])
    i = j
  }
  const x = (k) => (k / slots.length) * w
  return (
    <svg width={w} height={h + 2} style={{ display: 'block', marginTop: 6 }}>
      <rect x={0} y={1} width={w} height={h} rx={2} fill="rgba(255,255,255,0.05)" />
      {runs.filter((r) => r[2] !== '.').map(([a, b, k]) => <rect key={a} x={x(a)} y={1} width={Math.max(1, x(b) - x(a))} height={h} fill={COL[k]} opacity={0.85} />)}
      <line x1={w / 2} x2={w / 2} y1={0} y2={h + 2} stroke="rgba(255,255,255,0.18)" />
    </svg>
  )
}
