import { C, nf, clockOf } from './theme.js'
import { MAX_VA, drawW } from './model.js'

// Where the power goes: grid → bank (the charging current), bank → home (on battery), grid → home over the top
// (on mains). Dashes run at a speed that follows the watts.
export function Flow({ v, g, offline, elapsed }) {
  const { W, H, ox, oy, R, gx, hx, nr } = g
  const onBat = v?.phase === 'battery'
  const charging = v?.phase === 'charging'
  const chgW = charging ? v.a * (v.v || 13.6) : 0
  // on battery the inverter's own current reading is cut down to 2.8 A steps (it reads ~one step low): the line
  // shows what the countdown counts with, the load × 1.02 + its own 20 W
  const batW = onBat ? drawW(v.w) : 0
  const batA = batW / (v?.v || 12.9)
  // over the top of the sphere, clear of its ticks: the peak of the curve is at ¾ of the control points' height
  const arcY = (oy - R - 52 - 0.25 * (oy - nr - 8)) / 0.75
  const by = `M ${gx} ${oy - nr - 8} C ${gx + 40} ${arcY}, ${hx - 40} ${arcY}, ${hx} ${oy - nr - 8}`
  const toBank = `M ${gx + nr + 14} ${oy} L ${ox - R - 52} ${oy}`
  const toHome = `M ${ox + R + 52} ${oy} L ${hx - nr - 14} ${oy}`
  const midL = (gx + nr + ox - R - 40) / 2
  const midR = (ox + R + hx - nr) / 2
  const gap = ox - R - 52 - (gx + nr + 14) // room on the line for its label
  const big = Math.max(28, Math.min(54, gap / 4.2))
  return (
    <>
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
        <Line d={by} on={!offline && !onBat && v} color={C.grid} watts={v?.w ?? 0} />
        <Line d={toBank} on={!offline && charging} color={C.charging} watts={chgW} />
        <Line d={toHome} on={!offline && onBat} color={v?.soc < 25 ? C.low : C.battery} watts={batW} />
      </svg>

      {/* the charging current, on its way into the bank */}
      <Label x={midL} y={oy} size={big} show={!offline && charging} color={C.charging} big={`+${nf(v?.a, 1)} А`} small={`${nf(chgW)} Вт`} />
      <Label x={midR} y={oy} size={big} show={!offline && onBat} color={v?.soc < 25 ? C.low : C.battery} big={`−${nf(batA, 1)} А`} small={`${nf(batW)} Вт`} />

      <Node x={gx} y={oy} r={nr} color={offline ? C.offline : onBat ? C.battery : C.grid} dead={onBat}>
        <Bolt size={nr * 0.9} color={offline ? C.offline : onBat ? C.battery : C.grid} cross={onBat} />
      </Node>
      <div style={{ position: 'absolute', left: gx - 140, top: oy + nr + 14, width: 280, textAlign: 'center' }}>
        {onBat && !offline ? (
          <>
            <div style={{ fontSize: 30, fontWeight: 700, color: C.battery, fontVariantNumeric: 'tabular-nums' }}>{elapsed}</div>
            <div style={{ fontSize: 15, color: C.dim }}>без света с {clockOf(v.outageFrom ?? v.t)}</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 30, fontWeight: 600, color: offline ? C.dim : C.ink }}>{offline ? '' : v?.gridV ? `${nf(v.gridV)} В` : 'сеть'}</div>
            {!offline ? <Small items={[v?.gridHz ? `${nf(v.gridHz, 1)} Гц` : null, v?.gridW != null ? `${nf(Math.max(0, v.gridW))} Вт из сети` : null]} /> : null}
          </>
        )}
      </div>

      <Home v={v} g={g} offline={offline} />
    </>
  )
}

function Small({ items, hot }) {
  const xs = items.filter(Boolean)
  if (!xs.length) return null
  return <div style={{ fontSize: 15, color: hot ? C.low : C.dim, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{xs.join(' · ')}</div>
}

function Line({ d, on, color, watts }) {
  const speed = 18 + Math.sqrt(Math.max(0, watts)) * 6 // px/s
  return (
    <g>
      <path d={d} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={4} strokeLinecap="round" />
      {on ? (
        <>
          <path d={d} fill="none" stroke={color} strokeOpacity={0.18} strokeWidth={14} strokeLinecap="round" style={{ filter: 'blur(6px)' }} />
          <path d={d} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeDasharray="3 29" className="adm-flow" style={{ animationDuration: `${32 / speed}s` }} />
        </>
      ) : null}
    </g>
  )
}

function Label({ x, y, show, color, big, small, size = 54 }) {
  if (!show) return null
  return (
    <>
      <div style={{ position: 'absolute', left: x - 150, top: y - 32 - size, width: 300, textAlign: 'center', pointerEvents: 'none', whiteSpace: 'nowrap', fontSize: size, fontWeight: 750, color, letterSpacing: -1.5, fontVariantNumeric: 'tabular-nums', textShadow: `0 0 24px ${color}66` }}>{big}</div>
      <div style={{ position: 'absolute', left: x - 150, top: y + 16, width: 300, textAlign: 'center', pointerEvents: 'none', fontSize: 18, color: C.dim, fontVariantNumeric: 'tabular-nums' }}>{small}</div>
    </>
  )
}

function Node({ x, y, r, color, children }) {
  return (
    <div style={{ position: 'absolute', left: x - r, top: y - r, width: 2 * r, height: 2 * r, borderRadius: '50%', display: 'grid', placeItems: 'center',
      background: `radial-gradient(circle at 35% 30%, ${color}22, rgba(255,255,255,0.02) 70%)`, border: `1.5px solid ${color}66`, boxShadow: `0 0 40px ${color}22` }}>
      {children}
    </div>
  )
}

function Bolt({ size, color, cross }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M13 2 L4 14 h7 l-1 8 9-12 h-7 z" fill={color} fillOpacity={cross ? 0.35 : 0.95} />
      {cross ? <path d="M4 4 L20 20" stroke={color} strokeWidth={2.2} strokeLinecap="round" /> : null}
    </svg>
  )
}

function House({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M3 11 L12 3 L21 11 V21 H14 V15 H10 V21 H3 Z" fill={color} fillOpacity={0.9} />
    </svg>
  )
}

// The home: what it draws (the real load, nothing dialled in), and a ring for how near the inverter's 3000 VA it is.
function Home({ v, g, offline }) {
  const { oy, hx, nr } = g
  const w = v?.w ?? 0
  const frac = Math.min(1, (v?.va ?? v?.w ?? 0) / MAX_VA)
  const ringR = nr + 12
  const L = 2 * Math.PI * ringR
  const ringC = frac > 0.8 ? C.low : frac > 0.5 ? C.battery : C.load
  return (
    <>
      <svg width={2 * ringR + 8} height={2 * ringR + 8} style={{ position: 'absolute', left: hx - ringR - 4, top: oy - ringR - 4, pointerEvents: 'none' }}>
        <circle cx={ringR + 4} cy={ringR + 4} r={ringR} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
        <circle cx={ringR + 4} cy={ringR + 4} r={ringR} fill="none" stroke={ringC} strokeWidth={4} strokeLinecap="round"
          strokeDasharray={`${Math.max(2, L * frac)} ${L}`} transform={`rotate(-90 ${ringR + 4} ${ringR + 4})`} />
      </svg>
      <Node x={hx} y={oy} r={nr} color={offline ? C.offline : C.load}>
        <House size={nr * 0.85} color={offline ? C.offline : C.load} />
      </Node>
      <div style={{ position: 'absolute', left: hx - 150, top: oy + nr + 10, width: 300, textAlign: 'center' }}>
        <div style={{ fontSize: 40, fontWeight: 750, color: C.ink, fontVariantNumeric: 'tabular-nums', letterSpacing: -1 }}>
          {offline ? '' : `${nf(w)} Вт`}
        </div>
        {!offline ? (
          <>
            <Small items={[v?.va ? `${nf(v.va)} ВА · ${nf((100 * v.va) / MAX_VA)} % предела` : null]} />
            <Small items={[v?.outV ? `${nf(v.outV)} В` : null, v?.outHz ? `${nf(v.outHz, 1)} Гц` : null, v?.temp != null ? `🌡 ${nf(v.temp)} °C` : null]} hot={v?.temp >= 50} />
          </>
        ) : null}
      </div>
    </>
  )
}
