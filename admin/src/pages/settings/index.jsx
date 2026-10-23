// @page: Настройки инвертора
// The inverter's settings in four groups, as last read. A change is a draft; the check window shows what the inverter
// would refuse, the conditions now and the plan, and writes it with the PIN (held 2 s for a dangerous one) through
// the writer (writer/settings_writer.py): one register at a time, read back, rolled back on any mismatch. The journal
// keeps every write, each with "вернуть".
import { useEffect, useMemo, useState } from 'react'
import { Scene, useFrameSize, Drawer, asset, useExpose } from '@/space'
import { C, SANS } from '../../lib/admin/theme.js'
import { SETTINGS, GROUPS, IDENTITY, READ, CLOUD, valueOf, problems, conditions, byId } from './catalog.js'
import { Row, show } from './parts/Row.jsx'
import { Review } from './parts/Review.jsx'
import { usePoll, post } from './api.js'
import '../../lib/admin/admin.css'

const byReg = Object.fromEntries(SETTINGS.filter((s) => s.reg).map((s) => [s.reg, s]))
export const fromRaw = (s, raw) => (raw == null ? null : s.kind === 'num' ? Math.round(raw * s.scale * 100) / 100 : s.kind === 'bool' ? raw === 1 : raw)
const when = (iso) => new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function Page() {
  const { width, height } = useFrameSize()
  const w = width || 1400
  const h = height || 900
  const [api, refresh] = usePoll('api/settings', 4000)
  const [draft, setDraft] = useState({})
  const [open, setOpen] = useState(null)
  const [review, setReview] = useState(null) // null | { revertOf, changes? }
  const [showJournal, setShowJournal] = useState(false)
  const [readMsg, setReadMsg] = useState(null)

  const read = api?.current?.words ? { flat: api.current.words } : READ
  const NOW = useMemo(() => Object.fromEntries(SETTINGS.map((s) => [s.id, valueOf(s, read)])), [api?.current?.at])
  const live = api?.live ?? {}
  const pin = api?.pin
  const vals = useMemo(() => ({ ...NOW, ...draft }), [NOW, draft])
  const changes = Object.entries(draft).map(([id, to]) => ({ id, from: NOW[id], to }))
  const probs = problems(vals).filter((p) => p.refuse || draft[p.id] !== undefined)
  const setOne = (id, v) => setDraft((d) => {
    const n = { ...d }
    if (v === undefined) delete n[id]
    else n[id] = v
    return n
  })
  const reviewChanges = review?.changes ?? changes
  const reviewProbs = review?.changes ? problems({ ...NOW, ...Object.fromEntries(review.changes.map((c) => [c.id, c.to])) }).filter((p) => p.refuse || review.changes.some((c) => c.id === p.id)) : probs

  useExpose('settings', { draft: () => draft, set: setOne, open: setOpen, review: () => setReview({}), api: () => api })
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && (setReview(null), setShowJournal(false))
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const readNow = async () => {
    setReadMsg('читаю…')
    const r = await post('api/settings/read', {})
    setReadMsg(r.ok ? 'читаю…' : r.why)
    if (r.ok) setTimeout(() => (refresh(), setReadMsg(null)), 6000)
  }
  // the newest write of each register that is still in force can be returned
  const journal = api?.journal ?? []
  const returnable = new Set()
  const seen = new Set()
  for (const e of journal) {
    if (seen.has(e.reg)) continue
    seen.add(e.reg)
    if (e.kind === 'change' && e.ok && byReg[e.reg]) returnable.add(e)
  }

  const pad = 28
  const gap = 18
  const top = 84
  const colW = (w - 2 * pad - 3 * gap) / 4
  const bottom = changes.length ? 74 : 20
  const pinLabel = !pin ? '' : !pin.set ? '🔒 PIN не задан — только просмотр' : pin.lockedUntil ? '⛔ PIN заблокирован' : '🔑 изменения с PIN'
  return (
    <Scene mode="app" tone="dark">
      <div style={{ position: 'relative', width: w, height: h, overflow: 'hidden', color: C.ink, fontFamily: SANS, background: `radial-gradient(1400px 900px at 50% 0%, #0d1530 0%, ${C.bg} 65%)` }}>
        <div style={{ position: 'absolute', left: pad, right: pad, top: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href={asset('admin')} className="adm-btn" style={pill(false)}>← админка</a>
          <span style={{ fontSize: 22, fontWeight: 750, whiteSpace: 'nowrap' }}>Настройки инвертора</span>
          <span style={{ fontSize: 14, color: C.dim, whiteSpace: 'nowrap' }}>
            прочитано {when(api?.current?.at ?? READ.at)} · {api?.current?.source === 'dongle' ? 'донгл' : 'проба 23.10'}
          </span>
          <button className="adm-btn" onClick={readNow} disabled={!live.liveOk || api?.running} title={live.liveOk ? 'прочитать все настройки сейчас' : 'инвертор не на связи'}
            style={{ ...pill(false), opacity: !live.liveOk || api?.running ? 0.45 : 1 }}>↻ прочитать</button>
          {readMsg ? <span style={{ fontSize: 13, color: C.dim }}>{readMsg}</span> : null}
          <span style={{ flex: 1 }} />
          <span style={{ ...pill(false), color: live.liveOk ? C.full : C.dim, cursor: 'default' }}>{live.liveOk ? (live.phase === 'battery' ? '● на связи · от батареи' : '● на связи · сеть') : '● нет связи'}</span>
          <button className="adm-btn" onClick={() => setShowJournal((x) => !x)} style={pill(showJournal)}>журнал{journal.length ? ` · ${journal.filter((e) => e.kind === 'change').length}` : ''}</button>
          <span title="PIN задаётся на Mac mini: admin/pin.sh set" style={{ ...pill(false), color: pin?.set && !pin?.lockedUntil ? C.ink : C.dim, cursor: 'default' }}>{pinLabel}</span>
        </div>

        {GROUPS.map((g, i) => {
          const list = SETTINGS.filter((s) => s.group === g.id)
          const n = list.filter((s) => draft[s.id] !== undefined).length
          return (
            <section key={g.id} id={`g-${g.id}`} style={{ position: 'absolute', left: pad + i * (colW + gap), top, width: colW, bottom, display: 'flex', flexDirection: 'column',
              background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 8px' }}>
                <span style={{ fontSize: 22, color: g.color }}>{g.icon}</span>
                <span style={{ fontSize: 18, fontWeight: 750 }}>{g.title}</span>
                {n ? <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: C.bg, background: C.battery, borderRadius: 999, padding: '2px 9px' }}>{n}</span> : null}
              </div>
              <div data-scrollbar style={{ overflow: 'auto', padding: '0 8px 12px', flex: 1 }}>
                {list.map((s) => (
                  <Row key={s.id} s={s} now={NOW[s.id]} draft={draft[s.id]} open={open === s.id} onOpen={() => setOpen(open === s.id ? null : s.id)} onDraft={(v) => setOne(s.id, v)} w={colW - 16} />
                ))}
                {g.id === 'device' ? <Passport extra={api?.identity} /> : null}
              </div>
            </section>
          )
        })}

        {changes.length ? (
          <div style={{ position: 'absolute', left: pad, right: pad, bottom: 14, height: 48, display: 'flex', alignItems: 'center', gap: 16, padding: '0 8px 0 18px',
            borderRadius: 14, background: 'rgba(253,176,34,0.1)', border: '1px solid rgba(253,176,34,0.45)' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: C.battery }}>черновик: {changes.length}</span>
            <span style={{ fontSize: 14, color: C.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
              {probs.length ? probs.map((p) => `${p.refuse ? '⛔' : '⚠'} ${p.text}`).join('   ') : changes.map((c) => byId[c.id].name).join(' · ')}
            </span>
            <button className="adm-btn" onClick={() => setDraft({})} style={pill(false)}>сбросить</button>
            <button className="adm-btn" onClick={() => setReview({})} style={{ ...pill(true), background: C.battery, borderColor: C.battery }}>проверить →</button>
          </div>
        ) : null}

        {showJournal ? (
          <div data-scrollbar style={{ position: 'absolute', right: pad, top: 72, width: 460, maxHeight: h - 110, overflow: 'auto', zIndex: 30, background: '#0d1426', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16, padding: '14px 16px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: C.dim, marginBottom: 8 }}>журнал изменений</div>
            {!journal.length ? <div style={{ color: C.dim, fontSize: 14 }}>пока пусто</div> : null}
            {journal.map((e, i) => {
              const s = byReg[e.reg]
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 14 }}>
                  <span style={{ color: e.ok ? (e.kind === 'rollback' ? C.battery : C.full) : '#f97066', width: 14 }}>{e.ok ? (e.kind === 'rollback' ? '↶' : '✓') : '✗'}</span>
                  <span style={{ color: C.dim, width: 92, flex: 'none' }}>{when(e.t)}</span>
                  <span style={{ flex: 1 }}>{s?.name ?? `рег ${e.reg}`}{e.kind === 'rollback' ? ' (откат)' : ''}: {s ? `${show(s, fromRaw(s, e.from))} → ${show(s, fromRaw(s, e.to))}` : `${e.from} → ${e.to}`}</span>
                  {returnable.has(e) ? (
                    <button className="adm-btn" onClick={() => (setShowJournal(false), setReview({ revertOf: e.job, changes: [{ id: s.id, from: NOW[s.id], to: fromRaw(s, e.from) }] }))}
                      style={{ fontSize: 13, color: C.ink, textDecoration: 'underline', cursor: 'pointer', whiteSpace: 'nowrap' }}>вернуть</button>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}

        {review && reviewChanges.length ? (
          <Review changes={reviewChanges} probs={reviewProbs} conds={conditions(live)} pin={pin} revertOf={review.revertOf} w={w} h={h}
            onClose={() => setReview(null)} onDone={() => (setDraft({}), refresh())} />
        ) : null}
      </div>
      <Drawer title="Как это устроено" side="right" w={400}>
        <div style={{ fontSize: 14.5, lineHeight: 1.55 }}>
          <p style={{ margin: '0 0 10px' }}>Значения — последнее чтение донгла («↻ прочитать» — заново); время C.V. → float — из облака, {CLOUD.at.split('-').reverse().slice(0, 2).join('.')}. П — программа на панели, рег — регистр Modbus.</p>
          <p style={{ margin: '0 0 10px' }}>Нажмите строку: шкала — что разрешает инвертор, зелёное — что хорошо для банка, белая черта — сейчас. Изменение — черновик; «проверить» покажет, что будет, и запишет с PIN. Красное — удерживать кнопку 2 с.</p>
          <p style={{ margin: '0 0 10px' }}>Запись — только когда инвертор на связи, дом от сети и нет сильного заряда. По одному регистру: записать, прочитать, сверить; не совпало — всё записанное возвращается. Каждый шаг — в журнале, там же «вернуть».</p>
          <p style={{ margin: '0 0 10px' }}><span style={{ color: '#32d583' }}>●</span> безопасно · <span style={{ color: '#fdb022' }}>●</span> осторожно · <span style={{ color: '#f97066' }}>●</span> опасно · <span style={{ color: '#667085' }}>●</span> не трогаем</p>
          <p style={{ margin: '0 0 10px', color: 'var(--sk-soft)' }}>Источники: инструкция производителя инвертора (2026-07-03), карта Modbus SMG-II (github.com/syssi/esphome-smg-ii), спецификация Ritar.</p>
        </div>
      </Drawer>
    </Scene>
  )
}

// the model's facts (catalog), and this unit's own from config.json (served by /api/settings)
function Passport({ extra = [] }) {
  const own = new Set(extra.map(([k]) => k))
  const rows = [...extra, ...IDENTITY.filter(([k]) => !own.has(k))]
  return (
    <div style={{ marginTop: 14, padding: '12px 12px 4px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: C.dim, marginBottom: 6 }}>паспорт</div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '2px 0' }}>
          <span style={{ color: C.dim, width: 74, flex: 'none' }}>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  )
}

const pill = (on) => ({
  padding: '8px 14px', borderRadius: 999, fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', textDecoration: 'none', cursor: 'pointer',
  color: on ? C.bg : C.ink, background: on ? C.ink : 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
})
