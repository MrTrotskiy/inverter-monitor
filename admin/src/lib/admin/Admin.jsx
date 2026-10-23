import { useEffect, useMemo, useRef, useState } from 'react'
import { useTick, clock, useExpose, asset } from '@/space'
import { useCollector, useBalance, useDays, useBank } from './feeds.js'
import { dayPoints, seriesPoints, replayDay, screen, track, dayTotals, isHole, limitOf, outagesOf, mergePoints, drawW, kyivDay, calibrate, discharge, CAL } from './model.js'
import { TestPanel, stopGlow } from './TestPanel.jsx'
import { Orb } from './Orb.jsx'
import { Flow } from './Flow.jsx'
import { Strip } from './Strip.jsx'
import { Timeline } from './Timeline.jsx'
import { DayPicker } from './DayPicker.jsx'
import { C, SANS, MONO, clockOf, phaseColor, nf } from './theme.js'
import './admin.css'

const EVENING = '2026-10-23'
const at23 = (hms) => Date.parse(`${EVENING}T${hms}+03:00`)
const STALE_MS = 90_000

// The admin: the bank now, where its power goes, and what comes next. Live from the collector on the Mac mini;
// any day with readings from the picker, any moment of it by dragging the strip at the bottom. Sized by its box.
export function Admin({ w, h, keys = false, initialDay = null }) {
  const [day, setDay] = useState(initialDay) // null: today
  const col = useCollector(15, day)
  const bal = useBalance()
  const days = useDays()
  // the bank as the owner's test measured it (until then the datasheet's): set before anything is counted
  const bank = useBank()
  const calKey = bank?.calibration?.measuredAt ?? 'datasheet'
  useMemo(() => calibrate(bank?.calibration), [calKey])
  useTick({ fps: 12 })
  const now = clock.now()
  const wall = Date.now() // the real time: the admin always says what time it is now
  const viewDay = col?.day ?? day
  const isToday = !!col && col.day === col.today
  // today with no reading at all (the inverter off since an earlier day): the newest day that has some gives the
  // last state; today stays on the screen
  const lastDay = days?.length ? days.at(-1).day : null
  const needOld = isToday && !!col?.points && !col.points.length && !!lastDay && lastDay !== col.day
  const old = useCollector(60, lastDay, needOld)

  // the day's points: the server's merge of the collector and the cloud; for 23 Oct the evening's file adds the
  // dongle checks of 16:35–16:47 and the unseen switch to mains
  const points = useMemo(() => {
    if (!col?.points) return []
    if (viewDay === EVENING && bal) {
      const ser = seriesPoints(col.series)
      const first = ser[0]?.t ?? Infinity
      return mergePoints([...dayPoints(bal, { switchT: at23('17:30:00'), localFrom: at23('17:34:40') }).filter((p) => p.t < first), ...ser], col.points.filter((p) => p.t < at23('15:20:00')))
    }
    return col.points
  }, [col?.points, col?.series, viewDay, bal])
  const base = points.length ? points : needOld && old?.points ? old.points : points // where the last state comes from
  const replay = useMemo(() => (base.length ? replayDay(base, { start: base[0].t }) : null), [base, calKey])
  const inDay = useMemo(() => points.filter((p) => p.t >= (col?.from ?? 0)), [points, col?.from])
  const lastT = base.at(-1)?.t ?? 0
  const st = col?.status
  const liveOk = isToday && !!(st?.connected && st?.last && wall - Date.parse(st.last.t) < STALE_MS)

  // back on the line: said large for a minute, with how long it was away
  const wasOk = useRef(null)
  const lostSince = useRef(null)
  const [back, setBack] = useState(null)
  useEffect(() => {
    if (!col || !isToday) return
    if (!liveOk && lastT) lostSince.current = lastT
    if (wasOk.current === false && liveOk) setBack({ at: Date.now(), gap: lostSince.current ? Date.now() - lostSince.current : null })
    wasOk.current = liveOk
  }, [liveOk, col, isToday, lastT])

  // the cursor: "live" follows the newest reading; "past" runs on from a chosen moment at 1× (or faster)
  const [cur, setCur] = useState({ mode: 'live', t0: 0, c0: 0, speed: 1 })
  const placed = useRef(null) // the day the cursor was placed for
  const go = (tt, speed = cur.speed) => {
    placed.current = viewDay
    setCur({ mode: 'past', t0: tt, c0: clock.now(), speed })
  }
  const toLive = () => {
    placed.current = viewDay
    setDay(null)
    setCur({ mode: 'live', t0: 0, c0: 0, speed: 1 })
  }
  // today always opens now: live when the inverter answers, its last reading when it does not; a past day opens on
  // its first outage (23 Oct: 17:40)
  useEffect(() => {
    if (!col || placed.current === viewDay) return
    if (isToday) {
      placed.current = viewDay
      return setCur({ mode: 'live', t0: 0, c0: 0, speed: 1 })
    }
    if (!points.length || (viewDay === EVENING && !bal)) return
    placed.current = viewDay
    const o = outagesOf(inDay)[0]
    const t0 = viewDay === EVENING ? at23('17:40:00') : o ? Math.min(o.end, o.start + 15 * 60_000) : inDay[0]?.t ?? lastT
    setCur({ mode: 'past', t0, c0: clock.now(), speed: 1 })
  }, [col, points, viewDay, isToday, bal])

  const anchor = useRef({ data: 0, clk: 0 })
  if (liveOk && anchor.current.data !== lastT) anchor.current = { data: lastT, clk: now }
  const tLive = liveOk ? anchor.current.data + (now - anchor.current.clk) * 1000 : wall
  let t = cur.mode === 'live' ? tLive : cur.t0 + (now - cur.c0) * 1000 * cur.speed
  const end = isToday ? (liveOk ? lastT : wall) : lastT // how far a look back runs: today up to now, then live
  if (cur.mode === 'past' && t > end && !isToday) t = end
  useEffect(() => {
    if (cur.mode === 'past' && isToday && t >= end) toLive()
  })
  const before = nearestBefore(base, t)
  const offline = cur.mode === 'live' ? !liveOk : !before || t - before.t > limitOf(before)
  // without the link nothing is guessed: the state is the last reading's, and how long ago it was
  const lost = offline && before ? { at: before.t, s: ((cur.mode === 'live' ? wall : t) - before.t) / 1000, why: cur.mode === 'live' ? linkReason(st, wall) : 'в это время ничего не прочитано' } : null

  const s = replay ? replay(lost ? lost.at : t) : null
  const v = s ? screen(s, { loadW: s.phase === 'battery' && !lost ? meanLoad(base, t) : null }) : null
  if (v) {
    // every reading the moment has: the collector's last one live, the point in force when looking back
    const raw = s.raw ?? {}
    const L = cur.mode === 'live' && liveOk ? st.last : null
    Object.assign(v, {
      gridV: s.phase === 'battery' ? 0 : L?.grid_v ?? raw.gridV ?? null,
      gridHz: L?.grid_hz ?? raw.gridHz ?? null,
      gridW: L?.grid_w ?? raw.gridW ?? null,
      outV: L?.out_v ?? raw.outV ?? null,
      outHz: L?.out_hz ?? raw.outHz ?? null,
      va: L?.out_va ?? raw.va ?? null,
      temp: L?.temp_c ?? raw.temp ?? null,
    })
  }

  const dayFrom = col?.from ?? 0
  const dayTo = col?.to ?? 0
  const from = inDay.length ? Math.max(dayFrom, inDay[0].t - 15 * 60_000) : isToday ? dayFrom : t - 3600_000
  const to = isToday ? Math.min(dayTo, Math.max(lastT, wall) + 5 * 60_000) : inDay.length ? Math.min(dayTo, lastT + 15 * 60_000) : t + 60_000
  const samples = useMemo(() => (replay && inDay.length ? track(replay, from, lastT, Math.max(30_000, (lastT - from) / 900)) : []), [replay, from, lastT, inDay.length])
  // every stretch with no link is grey on the timeline: the holes between readings, and today from the last one to now
  const holes = useMemo(() => {
    const out = []
    for (let i = 1; i < points.length; i++) if (isHole(points[i - 1], points[i]) && points[i].t > from) out.push([Math.max(from, points[i - 1].t), points[i].t])
    return out
  }, [points, from])
  const gaps = isToday && !liveOk ? [...holes, [Math.max(from, inDay.length ? lastT : from), wall]] : holes
  const past = useMemo(() => (replay && v ? track(replay, Math.max(from, t - 3 * 3600_000), t, 30_000) : []), [replay, from, Math.floor(t / 30_000)])
  const totals = useMemo(() => (inDay.length ? { ...dayTotals(points, Math.min(dayTo, isToday ? Date.now() : dayTo), { from: dayFrom }), outages: outagesOf(points, dayFrom, dayTo) } : null),
    [points, dayFrom, dayTo, isToday, Math.floor(Date.now() / 60_000)])

  useExpose('admin', {
    go: (hms, d = viewDay) => go(Date.parse(`${d}T${hms}+03:00`), 1),
    day: (d) => setDay(d),
    live: toLive,
    view: () => (v ? { day: viewDay, mode: cur.mode, phase: v.phase, kind: v.kind, soc: v.soc, a: v.a, w: v.w, count: v.count, eta: v.eta, cutoffAt: v.cutoffAt, t, wall, offline, liveOk, lost, gaps, totals } : null),
  })

  useEffect(() => {
    if (!keys) return
    const onKey = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') go(t + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1) * 60_000)
      else if (e.key === ' ') { e.preventDefault(); go(t, cur.speed === 1 ? 60 : 1) }
      else if (e.key === 'l' || e.key === 'L' || e.key === 'Home') toLive()
      else if ((e.key === '[' || e.key === ']') && days?.length) {
        const i = days.findIndex((d) => d.day === viewDay)
        const j = Math.min(days.length - 1, Math.max(0, (i < 0 ? days.length : i) + (e.key === '[' ? -1 : 1)))
        setDay(days[j].day)
      } else return
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const top = (
    <TopBar cur={cur} t={t} wall={wall} liveOk={liveOk} lastSeen={Math.max(lastT, st?.last?.t ? Date.parse(st.last.t) : 0)} onLive={toLive}
      onSpeed={() => go(t, cur.speed === 1 ? 60 : 1)} hasPast={cur.mode === 'past'}>
      <DayPicker days={days} day={viewDay} today={col?.today} onPick={(d) => setDay(d === col?.today ? null : d)} />
      <a href={asset('history')} className="adm-btn" title="все дни за месяц-два" data-pan="none"
        style={{ padding: '8px 14px', borderRadius: 12, fontSize: 16, fontWeight: 650, color: C.ink, textDecoration: 'none', whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)' }}>
        ▦ месяцы
      </a>
      <a href={asset('settings')} className="adm-btn" title="настройки инвертора" data-pan="none"
        style={{ padding: '8px 12px', borderRadius: 12, fontSize: 16, fontWeight: 650, color: C.ink, textDecoration: 'none', whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)' }}>
        ⚙
      </a>
      <a href={asset('bank')} className="adm-btn" title={`банк: ${CAL.source === 'measured' ? 'измерен' : 'по паспорту'}; тест разряда`} data-pan="none"
        style={{ padding: '8px 12px', borderRadius: 12, fontSize: 16, fontWeight: 650, color: C.ink, textDecoration: 'none', whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)' }}>
        🔋
      </a>
      <a href={asset('bot')} className="adm-btn" title="уведомления в Telegram" data-pan="none"
        style={{ padding: '8px 12px', borderRadius: 12, fontSize: 16, fontWeight: 650, color: C.ink, textDecoration: 'none', whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)' }}>
        🔔
      </a>
      {totals ? <DayFacts totals={totals} n={w >= 1350 ? 3 : w >= 1050 ? 2 : 0} /> : null}
    </TopBar>
  )

  if (!base.length || !v) {
    // nothing read yet (the feeds are on their way, or failed): a quiet screen, nothing drawn from t = 0
    return (
      <div style={{ position: 'relative', width: w, height: h, color: C.dim, fontFamily: SANS, fontSize: 20,
        background: `radial-gradient(1400px 900px at 50% 0%, #0d1530 0%, ${C.bg} 65%)` }}>
        {col ? top : null}
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          {col?.error ? 'нет ответа от коллектора' : col ? 'за этот день ничего не прочитано' : 'загружаю…'}
        </div>
      </div>
    )
  }

  const color = phaseColor(v, offline)
  const tlH = 92
  const tlTop = h - tlH - 26
  const stripH = 118
  const stripTop = tlTop - stripH - 26
  const R = Math.max(120, Math.min((stripTop - 84) / 2 - 56, w * 0.16))
  const oy = 84 + (stripTop - 84) / 2 + 6
  const g = { W: w, H: h, ox: w / 2, oy, R, gx: w * 0.15, hx: w * 0.85, nr: Math.max(40, Math.min(64, R * 0.26)) }
  const elapsed = v.outageFrom ? hmsText((t - v.outageFrom) / 1000) : ''
  const stripW = Math.min(780, w * 0.48)
  const stripL = (w - stripW) / 2
  const sideW = Math.min(300, stripL - 60)

  const testOn = !!bank?.test?.on && isToday
  const test = testOn && !lost ? discharge(base, t) : null
  return (
    <div style={{ position: 'relative', width: w, height: h, overflow: 'hidden', color: C.ink, fontFamily: SANS, ...stopGlow(test),
      background: `radial-gradient(900px 600px at 50% 42%, ${color}14 0%, transparent 70%), radial-gradient(1400px 900px at 50% 0%, #0d1530 0%, ${C.bg} 65%)` }}>
      {top}
      <Flow v={v} g={g} offline={offline} elapsed={elapsed} />
      <div style={{ position: 'absolute', left: g.ox - (2 * R + 96) / 2, top: oy - (2 * R + 96) / 2 }}>
        <Orb v={v} r={R} color={color} offline={offline} lost={lost} />
      </div>
      <div style={{ position: 'absolute', left: stripL - sideW - 40, top: stripTop - 4 }}>
        <BatteryCurrent v={v} offline={offline} w={sideW} />
      </div>
      <div style={{ position: 'absolute', left: stripL, top: stripTop }}>
        {lost ? <LinkLost lost={lost} w={stripW} h={stripH} wall={wall} /> : testOn ? <TestPanel d={test} v={v} w={stripW} h={stripH} /> : <Strip v={v} past={past} w={stripW} h={stripH} offline={offline} />}
      </div>
      {back && wall - back.at < 60_000 && liveOk ? <BackOnLine back={back} w={w} /> : null}
      {totals ? (
        <div style={{ position: 'absolute', left: stripL + stripW + 40, top: stripTop - 4 }}>
          <Energy totals={totals} day={viewDay} isToday={isToday} w={sideW} />
        </div>
      ) : null}
      <div style={{ position: 'absolute', left: 24, top: tlTop }}>
        <Timeline samples={samples} holes={gaps} outages={totals?.outages ?? []} from={from} to={to} t={Math.min(to, Math.max(from, t))} w={w - 48} h={tlH}
          onScrub={(tt) => go(tt, 1)} liveEnd={liveOk ? lastT : null} />
      </div>
    </div>
  )
}

// The link, always about now (whatever moment is on the screen): green "на связи", or grey "нет связи с 18:18".
// On the right, the time now; while looking back, the moment looked at beside it in amber.
function TopBar({ cur, t, wall, liveOk, lastSeen, onLive, onSpeed, hasPast, children }) {
  const live = cur.mode === 'live'
  return (
    <div style={{ position: 'absolute', left: 28, right: 28, top: 18, display: 'flex', alignItems: 'center', gap: 16 }}>
      <span title={liveOk ? 'коллектор читает инвертор каждые 5 с' : 'последнее чтение'} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 999, whiteSpace: 'nowrap', fontSize: 15, fontWeight: 700,
        color: liveOk ? C.full : C.ink, background: liveOk ? `${C.full}1f` : 'rgba(255,255,255,0.07)', border: `1px solid ${liveOk ? `${C.full}88` : 'rgba(255,255,255,0.16)'}` }}>
        <span style={{ width: 10, height: 10, borderRadius: 5, flex: 'none', background: liveOk ? C.full : C.offline, boxShadow: liveOk ? `0 0 12px ${C.full}` : 'none' }} className={liveOk ? 'adm-pulse' : ''} />
        {liveOk ? 'на связи' : `нет связи${lastSeen ? ` с ${whenText(lastSeen, wall)}` : ''}`}
      </span>
      {children}
      <span style={{ flex: 1 }} />
      {!live ? (
        <span title="момент на экране" style={{ fontFamily: MONO, fontSize: 15, color: C.battery, whiteSpace: 'nowrap' }}>
          ↶ {kyivDay(t) !== kyivDay(wall) ? `${new Date(t).toLocaleDateString('ru-RU', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'short' })} ` : ''}{clockFull(t)}
        </span>
      ) : null}
      <span title="сейчас" style={{ fontFamily: MONO, fontSize: 18, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap' }}>
        {clockFull(wall)}
      </span>
      {hasPast ? (
        <Btn on={cur.speed !== 1} onClick={onSpeed} title="перемотка (пробел)">{cur.speed === 1 ? '▶▶ ×60' : '▶ ×1'}</Btn>
      ) : null}
      <Btn on={live && liveOk} onClick={onLive} title="к живым данным (L)">● сейчас</Btn>
    </div>
  )
}

const clockFull = (t) => new Date(t).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', second: '2-digit' })
// "18:18" today, "23 окт. 18:18" on another day
const whenText = (t, wall) => `${kyivDay(t) !== kyivDay(wall) ? `${new Date(t).toLocaleDateString('ru-RU', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'short' })} ` : ''}${clockOf(t)}`
// "3 ч 21 мин", "12 мин", "40 с"; days past a day
function durText(sec) {
  const s = Math.max(0, Math.floor(sec))
  if (s < 60) return `${s} с`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} ч ${m % 60} мин`
  return `${Math.floor(h / 24)} дн ${h % 24} ч`
}

// Why there is no link, from what the collector says about itself and the cloud
function linkReason(st, wall) {
  const written = st?.written ? Date.parse(st.written) : 0
  if (!written || wall - written > 3 * 60_000) return `коллектор на Mac mini молчит${written ? ` с ${whenText(written, wall)}` : ''}`
  const cloud = st.cloud_last_packet ? Date.parse(st.cloud_last_packet) : 0
  if (cloud && wall - cloud > 20 * 60_000) return `облако тоже молчит с ${whenText(cloud, wall)}: инвертор (или его Wi-Fi) выключен`
  if (cloud) return 'облако пакеты получает: не отвечает только донгл Mac mini'
  return 'Mac mini ждёт донгл'
}

// In the strip's place while there is no link: since when, how long, and why
function LinkLost({ lost, w, h, wall }) {
  return (
    <div style={{ width: w, height: h, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 6, textAlign: 'center' }}>
      <div style={{ fontSize: 13, color: C.dim, letterSpacing: 2, textTransform: 'uppercase' }}>нет связи с инвертором</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 34, fontWeight: 750, color: C.ink, fontVariantNumeric: 'tabular-nums' }}>{durText(lost.s)}</span>
        <span style={{ fontSize: 18, color: C.dim }}>с {whenText(lost.at, wall)}</span>
      </div>
      <div style={{ fontSize: 15, color: C.dim }}>{lost.why}</div>
    </div>
  )
}

// For a minute after the link comes back: a green banner under the top bar
function BackOnLine({ back, w }) {
  return (
    <div style={{ position: 'absolute', top: 76, left: 0, width: w, display: 'flex', justifyContent: 'center', zIndex: 5, pointerEvents: 'none' }}>
      <div className="adm-digit" style={{ padding: '10px 22px', borderRadius: 14, whiteSpace: 'nowrap', fontSize: 18, fontWeight: 700, color: C.bg, background: C.full, boxShadow: `0 0 32px ${C.full}66` }}>
        ● инвертор снова на связи{back.gap ? ` · без связи было ${durText(back.gap / 1000)}` : ''}
      </div>
    </div>
  )
}

// The chosen day in three numbers beside the picker: outages, time on battery, what the house used.
function DayFacts({ totals, n: shown = 3 }) {
  const n = totals.outages.length
  const items = [
    { icon: '⚡', v: `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'отключение' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'отключения' : 'отключений'}`, c: C.battery },
    { icon: '◷', v: `${hmsText(totals.batS).slice(0, -3)} от батарей`, c: C.battery },
    { icon: '⌂', v: `${nf(totals.loadWh)} Вт·ч дом`, c: C.load },
  ]
  return (
    <div style={{ display: 'flex', gap: 22, minWidth: 0, overflow: 'hidden' }}>
      {items.slice(0, shown).map((x) => (
        <span key={x.icon} style={{ fontSize: 16, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ color: x.c, marginRight: 6 }}>{x.icon}</span>{x.v}
        </span>
      ))}
    </div>
  )
}

// The battery's current both ways: a bar from "gives" (left, amber) to "takes" (right, cyan), the amps large.
// On battery the inverter's own reading is cut to 2.8 A steps and runs ~one step low: the large number is the
// countdown's count (load × 1.02 + 20 W at the bank's voltage), the meter's reading beside it.
function BatteryCurrent({ v, offline, w }) {
  const bat = v.phase === 'battery'
  const vb = v.v || (bat ? 12.9 : 13.6)
  const a = offline ? 0 : bat ? -drawW(v.w) / vb : Math.max(0, v.a) // no link: no current is claimed
  const watts = Math.abs(a) * vb
  const c = offline ? C.offline : a > 0.5 ? C.charging : a < -0.5 ? (v.soc < 25 ? C.low : C.battery) : C.dim
  const MAX = 60
  const half = (w - 8) / 2
  const len = Math.min(half, (Math.abs(a) / MAX) * half)
  return (
    <div style={{ width: w, opacity: offline ? 0.45 : 1 }}>
      <div style={{ fontSize: 13, color: C.dim, letterSpacing: 2, textTransform: 'uppercase' }}>ток батареи</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
        <span style={{ fontSize: Math.min(44, w * 0.15), fontWeight: 750, color: c, letterSpacing: -1.2, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', textShadow: `0 0 20px ${c}55` }}>
          {offline ? '— А' : `${a > 0.05 ? '+' : a < -0.05 ? '−' : ''}${nf(Math.abs(a), 1)} А`}
        </span>
        <span style={{ fontSize: 17, color: C.dim, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{offline ? 'не читается' : `${nf(watts)} Вт`}</span>
      </div>
      <svg width={w} height={26} style={{ display: 'block', marginTop: 4 }}>
        <rect x={0} y={9} width={w} height={8} rx={4} fill="rgba(255,255,255,0.07)" />
        {a < 0 ? <rect x={w / 2 - len} y={9} width={len} height={8} rx={4} fill={c} /> : null}
        {a > 0 ? <rect x={w / 2} y={9} width={len} height={8} rx={4} fill={c} /> : null}
        <line x1={w / 2} x2={w / 2} y1={3} y2={23} stroke="rgba(255,255,255,0.5)" strokeWidth={2} />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.dim }}>
        <span style={{ color: a < -0.5 ? c : C.dim }}>← отдаёт</span>
        <span>{!offline && bat && v.a != null && Math.abs(v.a - a) > 1 ? `прибор ${nf(v.a, 1)} А` : ''}</span>
        <span style={{ color: a > 0.5 ? c : C.dim }}>берёт →</span>
      </div>
    </div>
  )
}

// Energy into and out of the bank over the chosen day.
function Energy({ totals, day, isToday, w }) {
  const max = Math.max(50, totals.inWh, totals.outWh)
  const row = (label, wh, c, icon) => (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ color: c, fontSize: 20, fontWeight: 700 }}>{icon}</span>
        <span style={{ fontSize: 30, fontWeight: 750, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.8 }}>{nf(wh)}</span>
        <span style={{ fontSize: 15, color: C.dim }}>Вт·ч {label}</span>
      </div>
      <svg width={w} height={8} style={{ display: 'block', marginTop: 2 }}>
        <rect x={0} y={0} width={w} height={8} rx={4} fill="rgba(255,255,255,0.07)" />
        <rect x={0} y={0} width={Math.max(2, (wh / max) * w)} height={8} rx={4} fill={c} />
      </svg>
    </div>
  )
  return (
    <div style={{ width: w }}>
      <div style={{ fontSize: 13, color: C.dim, letterSpacing: 2, textTransform: 'uppercase' }}>
        энергия {isToday ? 'за сегодня' : `за ${new Date(day + 'T12:00:00+03:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`}
      </div>
      {row('в банк', totals.inWh, C.charging, '↑')}
      {row('из банка', totals.outWh, C.battery, '↓')}
    </div>
  )
}

function Btn({ on, onClick, title, disabled, children }) {
  return (
    <button className="adm-btn" onClick={onClick} title={title} disabled={disabled} data-pan="none"
      style={{ padding: '8px 16px', borderRadius: 999, fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', color: on ? C.bg : C.ink, background: on ? C.ink : 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', opacity: disabled ? 0.45 : 1 }}>
      {children}
    </button>
  )
}

function nearestBefore(points, t) {
  let lo = 0
  let hi = points.length - 1
  if (hi < 0 || points[0].t > t) return null
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (points[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return points[lo]
}

// mean load over the last 10 minutes on battery: the countdown should not jump with every kettle click
function meanLoad(points, t) {
  let sum = 0
  let n = 0
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]
    if (p.t > t) continue
    if (p.t < t - 10 * 60_000) break
    if (p.mode === 3) { sum += p.w; n++ }
  }
  return n ? sum / n : points[Math.max(0, points.findIndex((p) => p.t > t) - 1)]?.w ?? 0
}

function hmsText(sec) {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
