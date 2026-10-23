import { useState } from 'react'
import { C, SANS } from '../../../lib/admin/theme.js'
import { byId, RISK, plan } from '../catalog.js'
import { show } from './Row.jsx'
import { PinField, HoldButton } from './Pin.jsx'
import { post, pinWhy, usePoll } from '../api.js'

const FINAL = { done: ['✓ записано и проверено', '#32d583'], failed: ['✗ не записано, всё возвращено', '#fdb022'], 'failed-rollback': ['⛔ не удалось вернуть — смотрите шаги', '#f97066'], refused: ['✗ не начато', '#fdb022'] }

// Before any write: what changes, what the inverter would refuse, whether now is a good moment, how the write and the
// way back go; then the PIN and the button (held 2 s when a change is dangerous), and the write step by step.
export function Review({ changes, probs, conds, pin, onClose, onDone, revertOf, w, h }) {
  const steps = plan(changes)
  const refused = probs.filter((p) => p.refuse)
  const danger = changes.some((c) => byId[c.id].risk === 'danger')
  const condOk = conds.every((c) => c.ok)
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState(null)
  const [jobId, setJobId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [jr] = usePoll(jobId ? `api/settings/job?id=${jobId}` : null, 700, [jobId])
  const job = jobId ? jr?.job : null
  const fin = job && FINAL[job.state]
  const locked = !pin?.set || pin?.lockedUntil
  const can = !locked && !refused.length && condOk && code.length >= 4 && !busy && !jobId

  const fire = async () => {
    setBusy(true)
    setMsg(null)
    const r = await post('api/settings/apply', { pin: code, changes: changes.map((c) => ({ id: c.id, to: c.to })), held: danger, revertOf })
    setCode('')
    setBusy(false)
    if (r.ok) setJobId(r.job)
    else setMsg(r.status === 401 || r.status === 423 ? pinWhy(r) : r.why)
  }

  return (
    <div onClick={() => !jobId || fin ? (fin && onDone(), onClose()) : null} style={{ position: 'absolute', inset: 0, background: 'rgba(3,6,14,0.72)', display: 'grid', placeItems: 'center', zIndex: 40 }}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} data-scrollbar
        style={{ width: Math.min(760, w - 60), maxHeight: h - 60, overflow: 'auto', background: '#0d1426', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 18, padding: '22px 26px', color: C.ink, boxShadow: '0 20px 80px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22, fontWeight: 750 }}>{revertOf ? 'Вернуть как было' : 'Проверка изменений'}</span>
          <span style={{ flex: 1 }} />
          {!jobId || fin ? <button onClick={() => (fin && onDone(), onClose())} className="adm-btn" style={{ fontSize: 20, color: C.dim, cursor: 'pointer' }} title="Esc">✕</button> : null}
        </div>

        <Head n="1" text="Было → станет" />
        {changes.map((c) => {
          const s = byId[c.id]
          return (
            <div key={c.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ color: RISK[s.risk].color, fontSize: 12 }}>●</span>
              <span style={{ flex: 1, fontSize: 15 }}>{s.name}</span>
              <span style={{ fontFamily: SANS, fontVariantNumeric: 'tabular-nums', fontSize: 15, color: C.dim }}>{show(s, c.from)}</span>
              <span style={{ color: C.dim }}>→</span>
              <span style={{ fontFamily: SANS, fontVariantNumeric: 'tabular-nums', fontSize: 16, fontWeight: 700, color: C.battery }}>{show(s, c.to)}</span>
            </div>
          )
        })}

        {!jobId ? (
          <>
            <Head n="2" text="Проверки" />
            {probs.length ? probs.map((p, i) => <Line key={i} ok={false} color={p.refuse ? '#f97066' : C.battery} mark={p.refuse ? '⛔' : '⚠'} text={`${p.refuse ? 'инвертор не примет: ' : ''}${p.text}`} />)
              : <Line ok text="в пределах инвертора и хорошей полосы для банка" />}
            <Head n="3" text="Условия сейчас" />
            {conds.map((c, i) => <Line key={i} ok={c.ok} text={c.text} />)}
            <Head n="4" text="Как пойдёт запись" />
            <ol style={{ margin: '4px 0 0', paddingLeft: 22, fontSize: 14, lineHeight: 1.65, color: C.dim, listStyle: 'decimal' }}>
              <li>снимок всех настроек — точка отката</li>
              {steps.map((p) => <li key={p.id}><span style={{ color: C.ink, fontSize: 13 }}>{p.text}</span></li>)}
              <li>не совпало или нет ответа — стоп, записанное вернуть по снимку</li>
              <li>в журнал: когда, что, было, стало, прочитано</li>
            </ol>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 22, flexWrap: 'wrap' }}>
              <PinField value={code} onChange={setCode} disabled={!!locked} autoFocus />
              <HoldButton holdMs={danger ? 2000 : 0} disabled={!can} onFire={fire} color={danger ? '#f97066' : C.battery}>
                {busy ? '…' : danger ? 'удерживайте 2 с' : 'записать'}
              </HoldButton>
              <span style={{ fontSize: 14, color: msg ? '#f97066' : C.dim, lineHeight: 1.4, flex: 1, minWidth: 180 }}>
                {msg ?? (!pin?.set ? 'PIN не задан: только просмотр' : pin?.lockedUntil ? pinWhy(pin) : refused.length ? 'есть то, что инвертор не примет' : !condOk ? 'сейчас нельзя: см. условия' : '')}
              </span>
            </div>
          </>
        ) : (
          <>
            <Head n="2" text="Запись" />
            {(job?.steps ?? []).map((s, i) => <Line key={i} ok={s.ok} text={`${s.t?.slice(11, 19) ?? ''}  ${s.text}`} />)}
            {!fin ? <div className="adm-pulse" style={{ fontSize: 14, color: C.dim, marginTop: 6 }}>{job?.state ?? 'отправлено'}…</div> : null}
            {fin ? <div style={{ marginTop: 14, fontSize: 18, fontWeight: 750, color: fin[1] }}>{fin[0]}{job.why ? ` — ${job.why}` : ''}</div> : null}
          </>
        )}
      </div>
    </div>
  )
}

const Head = ({ n, text }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0 6px' }}>
    <span style={{ width: 22, height: 22, borderRadius: 11, background: 'rgba(255,255,255,0.1)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>{n}</span>
    <span style={{ fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: C.dim }}>{text}</span>
  </div>
)

const Line = ({ ok, text, mark, color }) => (
  <div style={{ display: 'flex', gap: 10, fontSize: 15, padding: '3px 0', color: ok ? C.ink : color ?? '#f97066' }}>
    <span style={{ width: 18 }}>{mark ?? (ok ? '✓' : '✗')}</span>
    <span>{text}</span>
  </div>
)
