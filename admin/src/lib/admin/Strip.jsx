import { C, nf, clockOf, dayOf } from './theme.js'

// Under the bank, what comes next: while charging, the current from the start of the charge to its end
// (seen, then the charger's own curve of 23 Oct) and when it stops; on battery, the charge running down to
// the cut-off and when that comes.
export function Strip({ v, past, w, h, offline }) {
  if (!v || offline) return <div style={{ width: w, height: h }} />
  if (v.kind === 'reserve') {
    const at = v.t + v.count * 1000
    return (
      <div style={{ width: w, height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, color: C.dim, fontSize: 20 }}>
        <span>свет пропадёт — хватит до</span>
        <span style={{ color: C.ink, fontSize: 30, fontWeight: 700 }}>{v.count > 20 * 3600 ? `${dayOf(at)} ` : ''}{clockOf(at)}</span>
      </div>
    )
  }
  const charging = v.kind === 'full'
  const color = charging ? C.charging : v.soc < 25 ? C.low : C.battery
  const t0 = charging ? v.chargeStart ?? v.t - 10 * 60_000 : v.outageFrom ?? v.t - 30 * 60_000
  const t1 = charging ? v.eta + 60_000 : v.cutoffAt
  const end = charging ? v.eta : v.cutoffAt
  // a long future is drawn compressed: the first 40 % of the width is what happened, the rest what is coming
  const split = 0.42
  const pad = 14
  const x = (t) => (t <= v.t ? pad + ((t - t0) / Math.max(1, v.t - t0)) * (w * split - pad) : w * split + ((t - v.t) / Math.max(1, t1 - v.t)) * (w * (1 - split) - 190))
  const top = 30
  const bot = h - 10
  const y = charging ? (a) => bot - (Math.max(0, a) / 55) * (bot - top) : (s) => bot - (s / 100) * (bot - top)
  const val = (p) => (charging ? p.a : p.soc)
  const seen = past.filter((p) => p.t >= t0 && p.t <= v.t)
  const ahead = charging ? v.curve : [{ t: v.t, soc: v.soc }, { t: end, soc: 0 }]
  const line = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(val(p)).toFixed(1)}`).join('')
  const area = seen.length > 1 ? `${line(seen)} L${x(seen.at(-1).t)},${bot} L${x(seen[0].t)},${bot} Z` : ''
  const far = end - v.t > 20 * 3600_000
  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="adm-strip" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={pad} x2={x(end)} y1={bot} y2={bot} stroke="rgba(255,255,255,0.1)" />
      {area ? <path d={area} fill="url(#adm-strip)" /> : null}
      {seen.length > 1 ? <path d={line(seen)} fill="none" stroke={color} strokeWidth={2.5} /> : null}
      <path d={line(ahead)} fill="none" stroke={color} strokeWidth={2.5} strokeDasharray="2 7" strokeLinecap="round" />
      <circle cx={x(v.t)} cy={y(charging ? v.a : v.soc)} r={6} fill={color} className="adm-pulse" />
      <circle cx={x(v.t)} cy={y(charging ? v.a : v.soc)} r={3.5} fill="#fff" />
      <line x1={x(end)} x2={x(end)} y1={top - 18} y2={bot} stroke={color} strokeOpacity={0.6} strokeDasharray="3 4" />
      <text x={x(end) + 12} y={top + 8} fill={C.dim} fontSize={16}>{charging ? 'полный в' : 'отключится'}</text>
      <text x={x(end) + 12} y={top + 42} fill={C.ink} fontSize={34} fontWeight={750}>{far ? `${dayOf(end)} ` : ''}{clockOf(end)}</text>
      <text x={pad} y={top - 12} fill={C.dim} fontSize={14}>{charging ? `ток в банк · с ${clockOf(t0)}` : `заряд · с ${clockOf(t0)}`}</text>
      {charging ? <text x={pad} y={y(50) - 6} fill={C.dim} fontSize={12} opacity={0.7}>50 А</text> : null}
    </svg>
  )
}
