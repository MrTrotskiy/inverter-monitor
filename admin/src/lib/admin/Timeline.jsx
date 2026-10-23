import { useRef } from 'react'
import { C, clockOf } from './theme.js'
import { drawW } from './model.js'

const BAND = { battery: C.battery, charging: C.charging, full: C.full, grid: C.full }

// The day under one finger: a band coloured by what the bank did, the charge as a line on it, holes where
// nothing was read. Drag anywhere on it to see that moment; the screen above follows.
export function Timeline({ samples, holes = [], from, to, t, w, h = 92, onScrub, liveEnd }) {
  const ref = useRef(null)
  const L = 16
  const x = (tt) => L + ((tt - from) / Math.max(1, to - from)) * (w - 2 * L)
  const tOf = (px) => from + ((px - L) / (w - 2 * L)) * (to - from)
  const scrub = (e) => {
    const r = ref.current.getBoundingClientRect()
    onScrub(Math.min(to, Math.max(from, tOf(((e.clientX - r.left) / r.width) * w))))
  }
  const top = 22
  const bh = h - 44
  const bands = []
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]
    const b = samples[i]
    bands.push(<rect key={a.t} x={x(a.t)} y={top} width={Math.max(0.5, x(b.t) - x(a.t) + 0.6)} height={bh} fill={BAND[a.phase] ?? C.offline} fillOpacity={0.32} />)
  }
  // no link (holes between readings, today's time since the last one): solid grey over everything, said in words
  // where it is wide enough
  const gaps = holes.map(([a, b]) => {
    const gw = Math.max(1, x(b) - x(a))
    return (
      <g key={`h${a}`}>
        <rect x={x(a)} y={top} width={gw} height={bh} fill={C.bg} />
        <rect x={x(a)} y={top} width={gw} height={bh} fill={C.offline} fillOpacity={0.42} />
        {gw > 90 ? <text x={x(a) + gw / 2} y={top + bh / 2 + 5} fontSize={13} fontWeight={600} fill="rgba(255,255,255,0.75)" textAnchor="middle">нет связи</text> : null}
      </g>
    )
  })
  const last = samples.at(-1)
  if (last && last.t < to) bands.push(<rect key="tail" x={x(last.t)} y={top} width={Math.max(0, x(to) - x(last.t))} height={bh} fill="url(#adm-hole)" />)
  // the battery's current through the day around the band's middle: up while it takes, down while it gives
  const mid = top + bh / 2
  const ya = (s) => {
    const a = s.phase === 'battery' ? -drawW(s.w) / 12.9 : Math.max(0, s.a)
    return mid - Math.max(-1, Math.min(1, a / 55)) * (bh / 2 - 3)
  }
  const amps = samples.length > 1 ? `M${x(samples[0].t)},${mid} ${samples.map((s) => `L${x(s.t).toFixed(1)},${ya(s).toFixed(1)}`).join(' ')} L${x(samples.at(-1).t)},${mid} Z` : ''
  bands.push(<line key="mid" x1={L} x2={w - L} y1={mid} y2={mid} stroke="rgba(255,255,255,0.12)" />)
  bands.push(<path key="amps" d={amps} fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.55)" strokeWidth={1} />)
  const soc = samples.map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)},${(top + bh - (s.soc / 100) * bh * 0.86 - 4).toFixed(1)}`).join('')
  const ticks = []
  // at most ~12 labels whatever the span (a span from t = 0 once drew 166,000 of them and hung the browser)
  const span = Math.max(1, to - from)
  const stepH = [0.5, 1, 2, 3, 6, 12, 24].find((s) => span / (s * 3600_000) <= 12) ?? Math.ceil(span / 3600_000 / 12)
  for (let tt = Math.ceil(from / (stepH * 3600_000)) * stepH * 3600_000; tt <= to && ticks.length < 24; tt += stepH * 3600_000) ticks.push(tt)
  return (
    <svg ref={ref} width={w} height={h} data-pan="none" style={{ cursor: 'ew-resize', touchAction: 'none', display: 'block' }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e) }}
      onPointerMove={(e) => e.buttons && scrub(e)}>
      <defs>
        <pattern id="adm-hole" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="rgba(255,255,255,0.025)" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
        </pattern>
      </defs>
      <rect x={L} y={top} width={w - 2 * L} height={bh} rx={10} fill="rgba(255,255,255,0.03)" />
      {bands}
      <path d={soc} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={1.2} strokeDasharray="4 4" />
      {gaps}
      {ticks.map((tt) => (
        <text key={tt} x={x(tt)} y={h - 4} fontSize={13} fill={C.dim} textAnchor="middle">{clockOf(tt)}</text>
      ))}
      {liveEnd ? <circle cx={x(liveEnd)} cy={top + bh / 2} r={4} fill={C.full} className="adm-pulse" /> : null}
      <g>
        <line x1={x(t)} x2={x(t)} y1={top - 6} y2={top + bh + 6} stroke="#fff" strokeWidth={2} />
        <rect x={x(t) - 34} y={0} width={68} height={20} rx={10} fill="#fff" />
        <text x={x(t)} y={15} fontSize={13} fontWeight={700} fill={C.bg} textAnchor="middle">{clockOf(t)}</text>
      </g>
    </svg>
  )
}
