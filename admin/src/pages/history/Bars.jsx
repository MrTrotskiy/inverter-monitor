import { C } from '../../lib/admin/theme.js'

// Every day of the span as one column: Wh into the bank up (cyan), Wh out of it down (amber), around one axis.
// A day with no readings is a faint dash; a future day is empty. Hover highlights, a press opens the day.
export function Bars({ list, w, h, hover, setHover, onOpen, today }) {
  const n = list.length
  const L = 56
  const cw = (w - L) / n
  const mid = h / 2
  const max = Math.max(100, ...list.map((x) => Math.max(x.d?.inWh ?? 0, x.d?.outWh ?? 0)))
  const nice = [100, 200, 300, 500, 750, 1000, 1500, 2000, 3000].find((v) => v >= max) ?? max
  const y = (wh) => (wh / nice) * (mid - 14)
  return (
    <svg width={w} height={h} style={{ display: 'block' }} onPointerLeave={() => setHover(null)}>
      {[nice, nice / 2].map((v) => (
        <g key={v}>
          <line x1={L} x2={w} y1={mid - y(v)} y2={mid - y(v)} stroke="rgba(255,255,255,0.06)" />
          <line x1={L} x2={w} y1={mid + y(v)} y2={mid + y(v)} stroke="rgba(255,255,255,0.06)" />
          <text x={L - 8} y={mid - y(v) + 4} fontSize={12} fill={C.dim} textAnchor="end">{v}</text>
          <text x={L - 8} y={mid + y(v) + 4} fontSize={12} fill={C.dim} textAnchor="end">{v}</text>
        </g>
      ))}
      <text x={L + 6} y={12} fontSize={12} fill={C.charging}>↑ в банк, Вт·ч</text>
      <text x={L + 6} y={h - 18} fontSize={12} fill={C.battery}>↓ из банка, Вт·ч</text>
      <line x1={L} x2={w} y1={mid} y2={mid} stroke="rgba(255,255,255,0.25)" />
      {list.map((x, i) => {
        const cx = L + i * cw
        const bw = Math.max(2, cw * 0.62)
        const on = hover === x.day
        const first = x.day.endsWith('-01')
        const monday = new Date(x.day + 'T12:00:00Z').getUTCDay() === 1
        return (
          <g key={x.day} style={{ cursor: x.d ? 'pointer' : 'default' }} onPointerEnter={() => setHover(x.day)} onClick={() => x.d && onOpen(x.day)}>
            <rect x={cx} y={0} width={cw} height={h} fill={on ? 'rgba(255,255,255,0.07)' : 'transparent'} />
            {first ? <line x1={cx} x2={cx} y1={0} y2={h} stroke="rgba(255,255,255,0.18)" /> : null}
            {x.d ? (
              <>
                <rect x={cx + (cw - bw) / 2} y={mid - y(x.d.inWh) - 1} width={bw} height={Math.max(x.d.inWh ? 2 : 0, y(x.d.inWh))} rx={Math.min(3, bw / 3)} fill={C.charging} opacity={on || !hover ? 1 : 0.55} />
                <rect x={cx + (cw - bw) / 2} y={mid + 1} width={bw} height={Math.max(x.d.outWh ? 2 : 0, y(x.d.outWh))} rx={Math.min(3, bw / 3)} fill={C.battery} opacity={on || !hover ? 1 : 0.55} />
                {x.d.outages ? <circle cx={cx + cw / 2} cy={mid} r={Math.min(4, cw / 4)} fill="#fff" /> : null}
                {x.d.cloud + x.d.local < 6 ? <text x={cx + cw / 2} y={mid - 8} fontSize={10} fill={C.dim} textAnchor="middle">·</text> : null}
              </>
            ) : x.future ? null : (
              <line x1={cx + cw * 0.3} x2={cx + cw * 0.7} y1={mid} y2={mid} stroke="rgba(255,255,255,0.12)" strokeWidth={3} />
            )}
            {x.day === today ? <rect x={cx + 1} y={1} width={cw - 2} height={h - 2} rx={4} fill="none" stroke="rgba(255,255,255,0.45)" strokeDasharray="3 3" /> : null}
            {monday || first ? (
              <text x={cx + 2} y={h - 4} fontSize={11} fill={first ? C.ink : C.dim} fontWeight={first ? 700 : 400}>
                {first ? new Date(x.day + 'T12:00:00Z').toLocaleDateString('ru-RU', { month: 'short' }) : Number(x.day.slice(8))}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
