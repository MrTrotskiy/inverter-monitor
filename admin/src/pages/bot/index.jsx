// @page: Бот: уведомления
// The notifier, set up by the owner: which notifications come, their thresholds, the night and what still comes then,
// the outage queue, on/off for the whole notifier, a test message. Every change needs the PIN.
import { useEffect, useMemo, useState } from 'react'
import { Scene, useFrameSize, asset, useExpose } from '@/space'
import { C, SANS } from '../../lib/admin/theme.js'
import { usePoll, post, pinWhy } from '../settings/api.js'
import { PinField } from '../settings/parts/Pin.jsx'
import '../../lib/admin/admin.css'

// each kind: what it says, and the thresholds it reads (key, unit, min, max, step)
const KINDS = [
  { k: 'full', icon: '🔋', name: 'Банк полный', t: [] },
  { k: 'lvl1', icon: '🟡', name: 'Уровень', t: [['levels.0', '%', 30, 90, 5]] },
  { k: 'lvl2', icon: '🔴', name: 'Уровень', t: [['levels.1', '%', 5, 50, 5]] },
  { k: 'off', icon: '⚡', name: 'Свет пропал', t: [] },
  { k: 'on', icon: '✅', name: 'Свет вернулся', t: [] },
  { k: 'sum', icon: '🧾', name: 'Итог отключения', t: [] },
  { k: 'notfull', icon: '⚠️', name: 'Пропал при неполном банке', t: [] },
  { k: 'fast', icon: '🔥', name: 'Быстрый разряд', t: [['fast_w', 'Вт', 50, 1500, 10], ['fast_min', 'мин', 5, 60, 1]] },
  { k: 'hour', icon: '⛔', name: 'Остался час', t: [] },
  { k: 'short', icon: '🪫', name: 'Не дотянет до света по графику', t: [['short_margin_min', 'мин запас', 0, 60, 5]] },
  { k: 'nocharge', icon: '❓', name: 'Свет есть, заряда нет', t: [['nocharge_min', 'мин', 5, 120, 5]] },
  { k: 'over', icon: '🟥', name: 'Перегрузка', t: [['overload_va', 'ВА', 500, 3000, 100], ['overload_w', 'Вт', 300, 1500, 50]] },
  { k: 'hot', icon: '🌡', name: 'Перегрев', t: [['hot_c', '°C', 40, 70, 1]] },
  { k: 'data', icon: '📡', name: 'Нет данных', t: [['silent_min', 'мин', 3, 120, 1]] },
  { k: 'blink', icon: '〰️', name: 'Мигания света', t: [['blink_s', 'с', 10, 600, 10]] },
]
const QUEUES = ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '5.1', '5.2', '6.1', '6.2']
const getK = (rules, key) => (key.startsWith('levels.') ? rules.levels[Number(key.slice(7))] : rules[key])

export default function Page() {
  const { width, height } = useFrameSize()
  const w = width || 1400
  const h = height || 900
  const [api, refresh] = usePoll('api/bot', 5000)
  const [d, setD] = useState(null) // the edited config
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const base = api?.config
  useEffect(() => {
    if (base && !d) setD(structuredClone(base))
  }, [base])
  const dirty = useMemo(() => (d && base ? diff(base, d) : {}), [d, base])
  const nDirty = Object.keys(dirty).length
  const pinState = api?.pin
  const noPin = pinState && (!pinState.set || pinState.lockedUntil)

  useExpose('bot', { config: () => d, set: (patch) => setD((x) => ({ ...x, ...patch })), api: () => api })

  const act = async (path, body, okText) => {
    if (pin.length < 4) return setMsg('введите PIN')
    setBusy(true)
    const r = await post(path, { pin, ...body })
    setBusy(false)
    setPin('')
    setMsg(r.ok ? okText(r) : r.status === 401 || r.status === 423 ? pinWhy(r) : r.why)
    if (r.ok) {
      setD(null)
      refresh()
    }
  }
  const toggle = (list, k) => setD((x) => ({ ...x, [list]: x[list].includes(k) ? x[list].filter((y) => y !== k) : [...x[list], k] }))
  const setRule = (key, v) => setD((x) => {
    const rules = { ...x.rules, levels: [...x.rules.levels] }
    if (key.startsWith('levels.')) rules.levels[Number(key.slice(7))] = v
    else rules[key] = v
    return { ...x, rules }
  })

  const pad = 28
  if (!d) return <Scene mode="app" tone="dark"><div style={{ width: w, height: h, display: 'grid', placeItems: 'center', color: C.dim, fontFamily: SANS }}>загружаю…</div></Scene>
  const colL = Math.min(820, w * 0.56)
  return (
    <Scene mode="app" tone="dark">
      <div style={{ position: 'relative', width: w, height: h, overflow: 'hidden', color: C.ink, fontFamily: SANS, background: `radial-gradient(1400px 900px at 50% 0%, #0d1530 0%, ${C.bg} 65%)` }}>
        <div style={{ position: 'absolute', left: pad, right: pad, top: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
          <a href={asset('admin')} className="adm-btn" style={pill(false)}>← админка</a>
          <span style={{ fontSize: 22, fontWeight: 750 }}>Бот</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 999, fontSize: 15, fontWeight: 750, color: api?.on ? C.full : C.dim,
            background: api?.on ? `${C.full}1f` : 'rgba(255,255,255,0.06)', border: `1px solid ${api?.on ? C.full + '88' : 'rgba(255,255,255,0.16)'}` }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: api?.on ? C.full : C.offline }} className={api?.on ? 'adm-pulse' : ''} />
            {api?.on ? 'уведомления включены' : 'уведомления выключены'}
          </span>
          <span style={{ flex: 1 }} />
          <PinField value={pin} onChange={setPin} disabled={!!noPin} />
          <button className="adm-btn" disabled={busy || noPin} onClick={() => act('api/bot/power', { on: !api?.on }, (r) => (r.on ? 'включено' : 'выключено'))}
            style={{ ...pill(false), background: api?.on ? 'rgba(249,112,102,0.15)' : `${C.full}22`, borderColor: api?.on ? '#f9706688' : `${C.full}88` }}>{api?.on ? 'выключить' : 'включить'}</button>
          <button className="adm-btn" disabled={busy || noPin} onClick={() => act('api/bot/test', {}, () => 'отправлено — проверьте Telegram')} style={pill(false)}>✉ тест</button>
        </div>
        <div style={{ position: 'absolute', left: pad, right: pad, top: 70, height: 22, fontSize: 14, color: msg ? (/неверн|заблок|нет|не /.test(msg) ? '#f97066' : C.full) : C.dim }}>
          {msg ?? (pinState && !pinState.set ? 'PIN не задан — только просмотр (на Mac mini: admin/pin.sh set)' : pinState?.lockedUntil ? pinWhy(pinState) : 'изменения — с PIN')}
        </div>

        <section data-scrollbar style={{ position: 'absolute', left: pad, top: 100, width: colL, bottom: nDirty ? 78 : 20, overflow: 'auto', ...card }}>
          <Title text="что присылать" right="🌙 = и ночью" />
          {KINDS.map((x) => {
            const on = !d.off.includes(x.k)
            const night = d.night_kinds.includes(x.k)
            const cloud = d.defer.includes(x.k)
            return (
              <div key={x.k} data-kind={x.k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 6px', borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: on ? 1 : 0.45 }}>
                <Switch on={on} onClick={() => toggle('off', x.k)} />
                <span style={{ width: 26, fontSize: 18 }}>{x.icon}</span>
                <span style={{ flex: 1, fontSize: 15.5, fontWeight: 600 }}>
                  {x.name}{x.k === 'lvl1' || x.k === 'lvl2' ? ` ${d.rules.levels[x.k === 'lvl1' ? 0 : 1]} %` : ''}
                  {x.k === 'full' ? ' (100 %)' : ''}
                  {cloud ? <span title="сейчас это присылает облачный alert.py; отсюда — нет, чтобы не было двойных" style={{ marginLeft: 8, fontSize: 11.5, color: C.dim, border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '1px 6px' }}>облако</span> : null}
                  {x.k === 'short' && !d.queue ? <span style={{ marginLeft: 8, fontSize: 12, color: '#fdb022' }}>нужна очередь</span> : null}
                </span>
                {x.t.map(([key, unit, lo, hi, step]) => <Stepper key={key} v={getK(d.rules, key)} unit={unit} lo={lo} hi={hi} step={step} onChange={(v) => setRule(key, v)} />)}
                <button className="adm-btn" title={night ? 'приходит и ночью' : 'ночью ждёт до утра'} onClick={() => toggle('night_kinds', x.k)}
                  style={{ width: 34, height: 30, borderRadius: 8, fontSize: 15, cursor: 'pointer', opacity: night ? 1 : 0.3, background: night ? 'rgba(167,139,250,0.2)' : 'transparent', border: '1px solid rgba(255,255,255,0.14)' }}>🌙</button>
              </div>
            )
          })}
        </section>

        <section style={{ position: 'absolute', left: pad + colL + 20, right: pad, top: 100, ...card }}>
          <Title text="ночь" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 16 }}>
            <span style={{ color: C.dim }}>с</span><Hour v={d.night[0]} onChange={(v) => setD({ ...d, night: [v, d.night[1]] })} />
            <span style={{ color: C.dim }}>до</span><Hour v={d.night[1]} onChange={(v) => setD({ ...d, night: [d.night[0], v] })} />
            <span style={{ color: C.dim, fontSize: 13 }}>остальное — одним сообщением утром</span>
          </div>
          <Title text="очередь отключений" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input value={d.region ?? ''} onChange={(e) => setD({ ...d, region: e.target.value.trim().toLowerCase() || null })} placeholder="область, напр. kyivska-oblast"
              style={{ ...sel, width: 230 }} title="код области, как в svitlo.live" />
            <select value={d.queue ?? ''} onChange={(e) => setD({ ...d, queue: e.target.value || null })} style={sel}>
              <option value="">— очередь —</option>
              {QUEUES.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
            <span style={{ color: C.dim, fontSize: 13 }}>график svitlo.live</span>
          </div>
          <Title text="не больше в час" />
          <Stepper v={d.max_per_hour} unit="сообщ." lo={1} hi={60} step={1} onChange={(v) => setD({ ...d, max_per_hour: v })} />
          <Title text="последнее" />
          <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.6 }}>
            {(api?.log ?? []).slice(0, 7).map((e, i) => <div key={i}>{e.t?.slice(5, 16).replace('T', ' ')} · {e.event}{e.kind ? ` · ${e.kind}` : ''}</div>)}
            {!api?.config?.chatSet ? <div style={{ color: '#f97066' }}>чат не задан</div> : null}
          </div>
        </section>

        {nDirty ? (
          <div style={{ position: 'absolute', left: pad, right: pad, bottom: 14, height: 52, display: 'flex', alignItems: 'center', gap: 14, padding: '0 10px 0 18px', borderRadius: 14, background: 'rgba(253,176,34,0.1)', border: '1px solid rgba(253,176,34,0.45)' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: C.battery }}>изменений: {nDirty}</span>
            <span style={{ flex: 1, fontSize: 14, color: C.dim }}>{api?.on ? 'после сохранения бот перезапустится' : ''}</span>
            <button className="adm-btn" onClick={() => setD(structuredClone(base))} style={pill(false)}>сбросить</button>
            <button className="adm-btn" disabled={busy || noPin} onClick={() => act('api/bot/config', { config: dirty }, (r) => (r.restarted ? 'сохранено, бот перезапущен' : 'сохранено'))}
              style={{ ...pill(true), background: C.battery, borderColor: C.battery }}>сохранить с PIN</button>
          </div>
        ) : null}
      </div>
    </Scene>
  )
}

function diff(a, b) {
  const out = {}
  for (const k of ['off', 'night', 'night_kinds', 'max_per_hour', 'region', 'queue']) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = b[k]
  const rules = {}
  for (const k of Object.keys(b.rules)) if (JSON.stringify(a.rules[k]) !== JSON.stringify(b.rules[k])) rules[k] = b.rules[k]
  if (Object.keys(rules).length) out.rules = rules
  return out
}

const card = { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: '6px 16px 14px' }
const sel = { padding: '8px 10px', borderRadius: 10, fontSize: 15, color: C.ink, background: '#121a30', border: '1px solid rgba(255,255,255,0.18)' }
const Title = ({ text, right }) => (
  <div style={{ display: 'flex', margin: '12px 0 8px', fontSize: 12.5, letterSpacing: 2, textTransform: 'uppercase', color: C.dim }}>
    <span style={{ flex: 1 }}>{text}</span>{right ? <span style={{ letterSpacing: 0, textTransform: 'none' }}>{right}</span> : null}
  </div>
)
const Switch = ({ on, onClick }) => (
  <button onClick={onClick} className="adm-btn" aria-pressed={on} style={{ width: 44, height: 24, borderRadius: 12, position: 'relative', cursor: 'pointer', flex: 'none', background: on ? C.full : 'rgba(255,255,255,0.15)', border: 'none' }}>
    <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: 9, background: '#fff', transition: 'left 0.15s' }} />
  </button>
)
function Stepper({ v, unit, lo, hi, step, onChange }) {
  const set = (x) => onChange(Math.min(hi, Math.max(lo, Math.round(x / step) * step)))
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
      <button className="adm-btn" onClick={() => set(v - step)} style={stepBtn}>−</button>
      <span style={{ minWidth: 44, textAlign: 'center', fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
      <button className="adm-btn" onClick={() => set(v + step)} style={stepBtn}>+</button>
      <span style={{ fontSize: 12.5, color: C.dim, marginLeft: 2 }}>{unit}</span>
    </span>
  )
}
const stepBtn = { width: 26, height: 26, borderRadius: 7, fontSize: 15, color: C.ink, cursor: 'pointer', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)' }
const Hour = ({ v, onChange }) => (
  <select value={v} onChange={(e) => onChange(Number(e.target.value))} style={sel}>
    {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>)}
  </select>
)
const pill = (on) => ({
  padding: '8px 14px', borderRadius: 999, fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', textDecoration: 'none', cursor: 'pointer',
  color: on ? C.bg : C.ink, background: on ? C.ink : 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
})
