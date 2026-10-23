import { useRef } from 'react'
import { C, SANS, nf } from '../../../lib/admin/theme.js'
import { RISK } from '../catalog.js'

// One setting: name, where it lives, the value now (and the draft beside it); opened, its control.
export function Row({ s, now, draft, open, onOpen, onDraft, w }) {
  const has = draft !== undefined
  const risk = RISK[s.risk]
  return (
    <div data-setting={s.id} style={{ borderRadius: 12, background: open ? 'rgba(255,255,255,0.05)' : 'transparent', borderLeft: `3px solid ${has ? C.battery : risk.color + (s.risk === 'locked' ? '55' : 'aa')}`, marginBottom: 4 }}>
      <button onClick={onOpen} className="adm-btn" style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 12px', textAlign: 'left', cursor: 'pointer', color: C.ink }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: s.risk === 'locked' ? C.dim : C.ink }}>{s.name}</span>
          <span style={{ display: 'block', fontSize: 11.5, color: C.dim, fontFamily: SANS, fontVariantNumeric: 'tabular-nums', marginTop: 1 }}>
            {s.prog ? `П${String(s.prog).padStart(2, '0')}` : '—'} · {s.reg ? `рег ${s.reg}` : 'облако'}
          </span>
        </span>
        <span style={{ fontFamily: SANS, fontVariantNumeric: 'tabular-nums', fontSize: 17, fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'right' }}>
          {has ? <span style={{ color: C.dim, textDecoration: 'line-through', fontSize: 14, marginRight: 6 }}>{show(s, now)}</span> : null}
          <span style={{ color: has ? C.battery : s.risk === 'locked' ? C.dim : C.ink }}>{show(s, has ? draft : now)}</span>
        </span>
      </button>
      {open ? (
        <div style={{ padding: '2px 12px 12px' }}>
          {s.risk === 'locked' ? null : s.kind === 'num' ? <Slider s={s} now={now} value={has ? draft : now} onChange={onDraft} w={w - 30} />
            : s.kind === 'enum' && s.options.length ? <Choice s={s} now={now} value={has ? draft : now} onChange={onDraft} />
            : s.kind === 'bool' ? <Choice s={{ ...s, options: [{ v: false, label: 'выкл' }, { v: true, label: 'вкл' }] }} now={now} value={has ? draft : now} onChange={onDraft} /> : null}
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 8, fontSize: 13, lineHeight: 1.4, color: C.dim }}>
            <span style={{ color: risk.color, fontWeight: 700, whiteSpace: 'nowrap' }}>● {risk.label}</span>
            <span>{s.unknownCode ?? s.why}</span>
          </div>
          {has ? <button onClick={() => onDraft(undefined)} className="adm-btn" style={{ marginTop: 8, fontSize: 13, color: C.dim, cursor: 'pointer', textDecoration: 'underline' }}>вернуть {show(s, now)}</button> : null}
        </div>
      ) : null}
    </div>
  )
}

export function show(s, v) {
  if (v == null) return s.unknownCode ? 'код 8' : '—'
  if (s.kind === 'triple') return v.map((x) => `${x}`).join(' / ') + ' %'
  if (s.kind === 'bool') return v ? 'вкл' : 'выкл'
  if (s.kind === 'enum') return s.options.find((o) => o.v === v)?.label ?? `код ${v}`
  return `${nf(v, s.digits)} ${s.unit}`
}

// The whole allowed range (the inverter's), the band that suits this bank in green, the factory value as a small
// mark, now in white, the draft in amber. Drag, click, or step with − +.
function Slider({ s, now, value, onChange, w }) {
  const ref = useRef(null)
  const h = 46
  const L = 8
  const x = (v) => L + ((v - s.min) / (s.max - s.min)) * (w - 2 * L)
  const at = (e) => {
    const r = ref.current.getBoundingClientRect()
    const v = s.min + ((e.clientX - r.left - L) / (r.width - 2 * L)) * (s.max - s.min)
    const q = Math.round(Math.min(s.max, Math.max(s.min, v)) / s.step) * s.step
    set(Math.round(q * 100) / 100)
  }
  const set = (v) => onChange(Math.abs(v - now) < 1e-9 ? undefined : v)
  const y = 16
  return (
    <div>
      <svg ref={ref} width={w} height={h} style={{ display: 'block', cursor: 'ew-resize', touchAction: 'none' }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e) }} onPointerMove={(e) => e.buttons && at(e)}>
        <rect x={L} y={y - 4} width={w - 2 * L} height={8} rx={4} fill={s.risk === 'danger' ? 'rgba(249,112,102,0.28)' : 'rgba(255,255,255,0.1)'} />
        {s.ok ? <rect x={x(s.ok[0])} y={y - 4} width={x(s.ok[1]) - x(s.ok[0])} height={8} rx={4} fill="rgba(50,213,131,0.55)" /> : null}
        {s.def != null ? <circle cx={x(s.def)} cy={y + 12} r={2.5} fill={C.dim}><title>заводское {nf(s.def, s.digits)}</title></circle> : null}
        <line x1={x(now)} x2={x(now)} y1={y - 10} y2={y + 10} stroke="#fff" strokeWidth={2} />
        {value !== now ? <circle cx={x(value)} cy={y} r={8} fill={C.battery} stroke={C.bg} strokeWidth={2} /> : <circle cx={x(now)} cy={y} r={7} fill="#fff" stroke={C.bg} strokeWidth={2} />}
        <text x={L} y={h - 2} fontSize={11} fill={C.dim}>{nf(s.min, s.digits)}</text>
        <text x={w - L} y={h - 2} fontSize={11} fill={C.dim} textAnchor="end">{nf(s.max, s.digits)} {s.unit}</text>
        {s.ok ? <text x={(x(s.ok[0]) + x(s.ok[1])) / 2} y={h - 2} fontSize={11} fill="rgba(50,213,131,0.9)" textAnchor="middle">{nf(s.ok[0], s.digits)}–{nf(s.ok[1], s.digits)}</text> : null}
      </svg>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        {[-1, 1].map((k) => (
          <button key={k} className="adm-btn" onClick={() => set(Math.round(Math.min(s.max, Math.max(s.min, value + k * s.step)) * 100) / 100)}
            style={{ width: 40, height: 30, borderRadius: 8, fontSize: 18, color: C.ink, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)', cursor: 'pointer' }}>{k < 0 ? '−' : '+'}</button>
        ))}
        <span style={{ alignSelf: 'center', fontSize: 12, color: C.dim, marginLeft: 6 }}>шаг {nf(s.step, s.digits)} {s.unit}</span>
      </div>
    </div>
  )
}

function Choice({ s, now, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {s.options.map((o) => {
        const isNow = o.v === now
        const on = o.v === value
        return (
          <button key={String(o.v)} className="adm-btn" title={o.bad ?? ''} onClick={() => onChange(isNow ? undefined : o.v)}
            style={{ padding: '6px 11px', borderRadius: 999, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              color: on ? C.bg : o.bad ? '#f97066' : C.ink, background: on ? (isNow ? C.ink : C.battery) : 'rgba(255,255,255,0.06)',
              border: `1px solid ${isNow ? '#fff' : o.bad ? 'rgba(249,112,102,0.5)' : 'rgba(255,255,255,0.14)'}` }}>
            {o.label}{isNow && !on ? ' · сейчас' : ''}
          </button>
        )
      })}
    </div>
  )
}
