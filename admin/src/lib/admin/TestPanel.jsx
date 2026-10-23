import { C, nf, clockOf } from './theme.js'
import { TEST, CAP_WH } from './model.js'

const WHY = { energy: 'отдано 90 % банка', knee: 'напряжение пошло вниз — колено', voltage: 'напряжение у порога', cutoff: 'на экране ≤ 12,0 В — рядом отключение инвертора (11,7)' }

// The discharge test, in the strip's place: waiting for full, then how much is out and how far to the stop, then STOP.
export function TestPanel({ d, v, w, h }) {
  if (!d) {
    const full = v?.phase === 'full' || v?.kind === 'reserve' && v?.soc >= 99.5
    const text = v?.phase === 'charging' ? `идёт зарядка — ждём полного${v.eta ? ` (≈ ${clockOf(v.eta)})` : ''}` : full ? 'банк полный — можно отключать сеть' : 'ждём: банк должен быть полным'
    return (
      <Box w={w} h={h} color={full ? C.full : C.charging}>
        <Small>тест разряда · стоп на {TEST.floorPct} %</Small>
        <div style={{ fontSize: 26, fontWeight: 750, color: full ? C.full : C.ink }}>{text}</div>
      </Box>
    )
  }
  if (d.why) {
    return (
      <Box w={w} h={h} color={C.low} solid>
        <div style={{ fontSize: 40, fontWeight: 850, letterSpacing: 1, color: '#fff' }}>СТОП — включите сеть</div>
        <div style={{ fontSize: 17, color: 'rgba(255,255,255,0.9)' }}>{WHY[d.why]} · отдано {nf(d.wh)} Вт·ч · {nf(d.vc, 2)} В с поправкой</div>
      </Box>
    )
  }
  const pct = Math.min(1, d.wh / d.stopWh)
  const color = d.soon ? C.battery : C.charging
  return (
    <Box w={w} h={h} color={color}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, width: '100%' }}>
        <Small>тест разряда · стоп на {TEST.floorPct} %</Small>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 15, color: d.soon ? C.battery : C.dim, fontWeight: d.soon ? 750 : 500 }}>
          {d.soon ? 'скоро стоп · ' : ''}ещё ≈ {hm(d.leftToStopH)} при {nf(d.loadW)} Вт
        </span>
      </div>
      <svg width={w - 28} height={30} style={{ display: 'block' }}>
        <rect x={0} y={8} width={w - 28} height={14} rx={7} fill="rgba(255,255,255,0.08)" />
        <rect x={0} y={8} width={(w - 28) * pct} height={14} rx={7} fill={color} />
        <line x1={(w - 28) * (d.soonWh / d.stopWh)} x2={(w - 28) * (d.soonWh / d.stopWh)} y1={2} y2={28} stroke={C.battery} strokeDasharray="3 3" />
      </svg>
      <div style={{ display: 'flex', gap: 18, fontSize: 15, color: C.dim, width: '100%' }}>
        <span>отдано <b style={{ color: C.ink, fontSize: 19 }}>{nf(d.wh)}</b> из {nf(d.stopWh)} Вт·ч</span>
        <span>{nf(d.vc, 2)} В с поправкой ({nf(d.v, 1)} на экране)</span>
        <span>{d.drop != null ? `${d.drop >= 0.005 ? '−' : ''}${nf(Math.max(0, d.drop), 2)} В за 100 Вт·ч` : ''}</span>
      </div>
    </Box>
  )
}

export function stopGlow(d) {
  return d?.why ? { boxShadow: `inset 0 0 0 6px ${C.low}, inset 0 0 120px ${C.low}66` } : {}
}

const hm = (hours) => {
  const m = Math.max(0, Math.round(hours * 60))
  return m >= 60 ? `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин` : `${m} мин`
}
const Small = ({ children }) => <span style={{ fontSize: 13, color: C.dim, letterSpacing: 2, textTransform: 'uppercase' }}>{children}</span>
const Box = ({ w, h, color, solid, children }) => (
  <div style={{ position: 'relative', width: w, height: h, boxSizing: 'border-box', padding: '10px 14px', borderRadius: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: solid ? 'center' : 'flex-start', gap: 6,
    background: solid ? color : `${color}14`, border: `1px solid ${color}88` }}>
    {solid ? <div className="adm-pulse" style={{ position: 'absolute', inset: -2, borderRadius: 18, boxShadow: `0 0 48px 8px ${color}`, pointerEvents: 'none' }} /> : null}
    <div style={{ position: 'relative', display: 'contents' }}>{children}</div>
  </div>
)
