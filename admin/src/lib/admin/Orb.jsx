import { useRef } from 'react'
import { Canvas2D } from '@/space'
import { hms, CAP_WH } from './model.js'
import { C, MONO, nf, clockOf } from './theme.js'

const WORD = { cutoff: 'до отключения', full: 'до полного', reserve: 'запас без света' }

// The bank as a sphere of liquid: the level is the charge, bubbles rise while it charges (more amps, more
// bubbles), the surface sinks while it gives. Around it, sixty ticks: the countdown's seconds.
// `lost` ({ at }): no link; the charge at the last reading is the large number, nothing counts down.
export function Orb({ v, r, color, offline, lost = null }) {
  const S = 2 * r + 96
  const live = useRef({})
  live.current = { v, color, offline }
  const sec = v ? Math.floor(Math.max(0, v.count)) % 60 : 0
  const [hh, mm, ss] = v ? hms(v.count) : [0, 0, 0]
  return (
    <div style={{ position: 'relative', width: S, height: S, flex: 'none' }}>
      <Canvas2D w={S} h={S} live draw={(ctx, { t }) => drawOrb(ctx, S, r, t, live.current)} />
      <svg width={S} height={S} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {Array.from({ length: 60 }, (_, i) => {
          const a = (i / 60) * 2 * Math.PI - Math.PI / 2
          const back = (sec - i + 60) % 60 // 0 = this second, then the ones just gone
          const on = v?.ticks && !offline && back < 12
          const major = i % 5 === 0
          const r0 = r + 22
          const r1 = r + (major ? 40 : 32)
          return (
            <line key={i} x1={S / 2 + Math.cos(a) * r0} y1={S / 2 + Math.sin(a) * r0} x2={S / 2 + Math.cos(a) * r1} y2={S / 2 + Math.sin(a) * r1}
              stroke={on ? color : 'rgba(255,255,255,0.14)'} strokeOpacity={on ? 1 - back / 12 : 1} strokeWidth={major ? 3 : 2} strokeLinecap="round" />
          )
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{ fontSize: r * 0.075, letterSpacing: 3, textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)', textShadow: '0 1px 8px rgba(0,0,0,0.6)' }}>
          {lost ? `заряд в ${clockOf(lost.at)}` : offline ? 'нет связи' : WORD[v?.kind] ?? ''}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', fontFamily: MONO, fontWeight: 300, fontSize: r * 0.36, letterSpacing: -r * 0.012, lineHeight: 1.05, marginTop: r * 0.02, fontVariantNumeric: 'tabular-nums', color: '#fff', textShadow: `0 2px 3px rgba(0,0,0,0.35), 0 0 ${r * 0.1}px rgba(4,8,20,0.75), 0 0 ${r * 0.2}px ${color}66` }}>
          {lost && v ? (
            <>
              <span>{nf(v.soc)}</span>
              <span style={{ fontSize: '0.5em', opacity: 0.75, marginLeft: r * 0.03 }}>%</span>
            </>
          ) : offline ? <span style={{ opacity: 0.5 }}>--:--</span> : (
            <>
              {hh ? (
                <>
                  <Digits n={hh} pad={1} />
                  <Colon r={r} />
                </>
              ) : null}
              <Digits n={mm} pad={2} />
              <Colon r={r} />
              <span style={{ fontSize: '0.62em', opacity: 0.9 }}><Digits n={ss} pad={2} /></span>
            </>
          )}
        </div>
        {lost ? (
          <div style={{ marginTop: r * 0.06, fontSize: r * 0.085, fontWeight: 600, color: 'rgba(255,255,255,0.8)', textShadow: '0 1px 8px rgba(0,0,0,0.65)' }}>нет связи</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: r * 0.05, textShadow: '0 1px 10px rgba(0,0,0,0.6)' }}>
            <span style={{ fontSize: r * 0.2, fontWeight: 700, color: '#fff' }}>{v ? nf(v.soc) : '–'}</span>
            <span style={{ fontSize: r * 0.09, color: 'rgba(255,255,255,0.75)' }}>%</span>
          </div>
        )}
        {v && (!offline || lost) ? (
          <div style={{ display: 'flex', gap: r * 0.08, marginTop: r * 0.03, fontSize: r * 0.068, fontWeight: 600, color: 'rgba(255,255,255,0.86)', fontVariantNumeric: 'tabular-nums', textShadow: '0 1px 8px rgba(0,0,0,0.65)' }}>
            <span>{nf(v.v, 1)} В</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>{nf((v.soc / 100) * CAP_WH)} Вт·ч</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Digits({ n, pad }) {
  const s = String(n).padStart(pad, '0')
  return (
    <span>
      {s.split('').map((d, i) => (
        <span key={`${s.length - i}-${d}`} className="adm-digit">{d}</span>
      ))}
    </span>
  )
}

const Colon = ({ r }) => <span style={{ opacity: 0.45, margin: `0 ${r * 0.01}px`, fontWeight: 200 }}>:</span>

const hash = (i) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function drawOrb(ctx, S, r, t, { v, color, offline }) {
  const cx = S / 2
  const cy = S / 2
  const col = offline ? C.offline : color
  // halo
  const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, S / 2)
  halo.addColorStop(0, hexA(col, 0.22))
  halo.addColorStop(1, hexA(col, 0))
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, S, S)
  // glass
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, 2 * Math.PI)
  ctx.fillStyle = 'rgba(8,12,24,0.92)'
  ctx.fill()
  ctx.clip()
  const soc = v ? v.soc / 100 : 0
  const level = cy + r - 2 * r * (0.04 + soc * 0.9)
  const amp = r * (0.022 + (v?.kind === 'full' ? 0.018 : 0))
  const flow = v ? Math.min(1, Math.abs(v.a) / 50) : 0
  for (const [k, alpha, speed, len] of [[0, 0.55, 0.9, 1.0], [1, 0.95, -0.6, 1.35]]) {
    ctx.beginPath()
    ctx.moveTo(cx - r, cy + r)
    for (let x = -r; x <= r; x += 4) {
      const y = level + Math.sin((x / r) * Math.PI * len + t * speed * (1 + flow) + k * 2) * amp + Math.sin((x / r) * 5 + t * 1.7) * amp * 0.25
      ctx.lineTo(cx + x, y)
    }
    ctx.lineTo(cx + r, cy + r)
    ctx.closePath()
    const g = ctx.createLinearGradient(0, level - amp, 0, cy + r)
    g.addColorStop(0, hexA(col, alpha * 0.95))
    g.addColorStop(1, hexA(shade(col), alpha))
    ctx.fillStyle = g
    ctx.fill()
  }
  // bubbles: up while charging, slow motes sinking while it gives
  if (v && !offline && Math.abs(v.a) > 0.5) {
    const up = v.a > 0
    const n = Math.round(6 + 34 * flow)
    for (let i = 0; i < n; i++) {
      const sp = (0.12 + hash(i) * 0.25) * (up ? 1 : 0.35)
      const ph = (hash(i + 99) + t * sp) % 1
      const yy = up ? cy + r - ph * (cy + r - level) : level + ph * (cy + r - level)
      const xx = cx + (hash(i + 7) * 2 - 1) * r * 0.8 + Math.sin(t * 2 + i) * 4
      if (yy < level + 4) continue
      ctx.beginPath()
      ctx.arc(xx, yy, 1.5 + hash(i + 3) * (up ? 4 : 2.2), 0, 2 * Math.PI)
      ctx.fillStyle = `rgba(255,255,255,${up ? 0.28 : 0.16})`
      ctx.fill()
    }
  }
  ctx.restore()
  // rim and a highlight
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, 2 * Math.PI)
  ctx.strokeStyle = hexA(col, 0.55)
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, r - 10, Math.PI * 1.08, Math.PI * 1.42)
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 6
  ctx.lineCap = 'round'
  ctx.stroke()
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

function shade(hex) {
  const n = parseInt(hex.slice(1), 16)
  const f = (x) => Math.round(x * 0.35)
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => f(x).toString(16).padStart(2, '0')).join('')
}
