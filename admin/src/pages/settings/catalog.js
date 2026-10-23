// The inverter's settings: what each one is, where it lives (Modbus register, panel program), what the inverter
// allows, what is safe for this bank, and the values read. No JSX, no writes: a description and checks only.
//
// Sources: the inverter maker's manual for this model (12 V version, edition of 2026-07-03): programs, ranges,
// defaults;
// the SMG-II Modbus map (github.com/syssi/esphome-smg-ii): registers and enum values; ha-eybond-local smg.py
// (341–343); the DessMonitor cloud's controls; Ritar's spec (charge 14.2–14.6 V, end of discharge 11.2 V, 50 A
// recommended).

// what was read: the dongle, 2026-10-23 16:35:15 (Modbus function 3, slave 1), and the cloud, 2026-09-18
export const READ = {
  at: '2026-10-23T16:35:15+03:00',
  words: {
    300: [0, 0, 1, 3, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 65535, 60927, 0, 0, 0, 0, 2300, 5000, 8, 160, 141, 141],
    327: [127, 0, 117, 0, 2, 500, 500, 146, 60, 120, 30, 1, 1, 0, 20, 30, 10],
  },
}
export const CLOUD = { at: '2026-09-18', values: { cvTime: 10 } } // "Time from C.V to Floating Charge 10"

// the passport: what is the same for every unit of this kind; the model's name, this unit's serial, firmware, PN and
// the dongle's address come from config.json (inverter.*, dongle.ip) through /api/settings and are added on the page
export const IDENTITY = [
  ['тип', 'гибридный инвертор 12 В / 230 В, MPPT'],
  ['мощность', '1500 Вт (рег. 643), пик 3000 ВА'],
  ['Modbus', 'адрес 1 (П25), протокол 1, тип 0x3A00'],
]

// `read`: READ's blocks, or { flat: { reg: word } } as the writer's current.json keeps them
export function word(addr, read = READ) {
  if (read.flat) return read.flat[addr] ?? read.flat[String(addr)] ?? null
  for (const [start, ws] of Object.entries(read.words)) {
    const i = addr - Number(start)
    if (i >= 0 && i < ws.length) return ws[i]
  }
  return null
}

// risk: safe (only comfort), care (changes how it charges or switches), danger (can harm the bank or cut the house),
// locked (not offered: unknown meaning, forbidden for LiFePO4, or a fact rather than a setting)
export const RISK = {
  safe: { label: 'безопасно', color: '#32d583' },
  care: { label: 'осторожно', color: '#fdb022' },
  danger: { label: 'опасно', color: '#f97066' },
  locked: { label: 'не трогаем', color: '#667085' },
}

const V = (x) => ({ scale: 0.1, unit: 'В', digits: 1, step: 0.1, ...x })
const A = (x) => ({ scale: 0.1, unit: 'А', digits: 0, step: 1, ...x })

// kind: num (min..max, step; ok = the band good for this bank), enum (options), bool
export const SETTINGS = [
  // ── charging ──
  { id: 'type', group: 'charge', reg: 322, prog: 5, name: 'Тип батареи', kind: 'enum', risk: 'danger',
    options: [], unknownCode: 'код 8 — не описан в карте; вероятно LIB (LiFePO4 без связи): поплавок 14,1 задан вручную',
    why: 'напряжения заряда (П26, 27, 29) меняются только для «своего» типа и LIB' },
  V({ id: 'cv', group: 'charge', reg: 324, prog: 26, name: 'Напряжение заряда (C.V.)', kind: 'num', risk: 'danger', min: 12, max: 15.5, ok: [14.2, 14.6], def: 14.1,
    why: 'выше 14,6 — перезаряд, BMS отключит банк; ниже 14,2 банк не добирает (Ritar 14,2–14,6)' }),
  V({ id: 'float', group: 'charge', reg: 325, prog: 27, name: 'Поддержка (float)', kind: 'num', risk: 'danger', min: 12, max: 15.5, ok: [13.5, 14.6], def: 13.5,
    why: 'для LiFePO4 инструкция советует float = C.V.; не выше C.V.' }),
  { id: 'cvTime', group: 'charge', reg: null, prog: 32, name: 'Время C.V. → float', kind: 'num', risk: 'care', unit: 'мин', digits: 0, step: 5, min: 5, max: 900, ok: [30, 120],
    source: 'cloud', why: '10 мин мало: при падении 0,7 В в проводах банк не успевает дозарядиться. Регистр не найден — только через облако' },
  A({ id: 'maxCharge', group: 'charge', reg: 332, prog: 2, name: 'Ток заряда, всего', kind: 'num', risk: 'care', min: 10, max: 100, ok: [20, 50], def: 60,
    why: 'Ritar: рекомендовано 50 А на банк; не меньше тока от сети (П11)' }),
  A({ id: 'maxAc', group: 'charge', reg: 333, prog: 11, name: 'Ток заряда от сети', kind: 'num', risk: 'care', min: 2, max: 60, ok: [20, 50], def: 30,
    why: 'больше — быстрее заряд после отключения, сильнее греются провода (16,7 мОм)' }),
  { id: 'chargeSrc', group: 'charge', reg: 331, prog: 16, name: 'Чем заряжать', kind: 'enum', risk: 'care',
    options: [{ v: 0, label: 'сеть' }, { v: 1, label: 'сначала PV' }, { v: 2, label: 'PV и сеть' }, { v: 3, label: 'только PV', bad: 'панелей нет — банк перестанет заряжаться' }],
    why: 'панелей нет, заряжает только сеть' },
  { id: 'eq', group: 'charge', reg: 313, prog: 33, name: 'Выравнивание (EQ)', kind: 'bool', risk: 'locked', why: 'для LiFePO4 запрещено (инструкция инвертора)' },

  // ── protection ──
  V({ id: 'lowOff', group: 'protect', reg: 329, prog: 29, name: 'Отключение от батареи', kind: 'num', risk: 'danger', min: 10, max: 13.5, ok: [11.5, 12.2], def: 10.5,
    why: 'ниже 11,2 — глубокий разряд (конец разряда Ritar); выше — дом отключится раньше, с запасом в банке' }),
  V({ id: 'lowMains', group: 'protect', reg: 327, prog: null, name: 'Порог батареи при сети', kind: 'num', risk: 'care', min: 10, max: 14, ok: [12.2, 13], def: null,
    why: 'при сети ниже этого напряжения инвертор не берёт из банка' }),
  V({ id: 'over', group: 'protect', reg: 323, prog: null, name: 'Защита от перенапряжения', kind: 'num', risk: 'locked', min: 14, max: 17,
    why: 'заводская граница, не настройка' }),
  { id: 'socGrid', group: 'protect', reg: 341, name: 'SOC → сеть / батарея / отсечка', kind: 'triple', risk: 'locked', regs: [341, 342, 343], unit: '%',
    why: 'проценты нужны только при связи с BMS; у Ritar связи нет, инвертор считает по напряжению' },

  // ── output & mains ──
  { id: 'priority', group: 'output', reg: 301, prog: 1, name: 'Кто питает дом', kind: 'enum', risk: 'care',
    options: [{ v: 0, label: 'сеть (UTI)' }, { v: 1, label: 'PV (SOL)' }, { v: 2, label: 'SBU', bad: 'без панелей дом сидит на банке при живой сети' }, { v: 3, label: 'SUB' }],
    why: 'UTI: при свете дом от сети, банк в запасе' },
  { id: 'input', group: 'output', reg: 302, prog: 3, name: 'Какую сеть принимать', kind: 'enum', risk: 'care',
    options: [{ v: 0, label: 'широко 90–280 В' }, { v: 1, label: 'UPS 170–280 В' }],
    why: 'UPS быстрее переключает, но плохую сеть считает отключением' },
  { id: 'outV', group: 'output', reg: 320, prog: 8, name: 'Напряжение на выходе', kind: 'enum', risk: 'danger', scale: 0.1,
    options: [{ v: 2200, label: '220 В' }, { v: 2300, label: '230 В' }, { v: 2400, label: '240 В' }], why: 'на нём вся техника дома' },
  { id: 'outHz', group: 'output', reg: 321, prog: 9, name: 'Частота на выходе', kind: 'enum', risk: 'danger',
    options: [{ v: 5000, label: '50 Гц' }, { v: 6000, label: '60 Гц', bad: 'в Украине сеть 50 Гц' }], why: 'на ней вся техника дома' },
  { id: 'bypass', group: 'output', reg: 310, prog: 23, name: 'Перегрузка → на сеть', kind: 'bool', risk: 'care', why: 'при перегрузке на батарее перейти на сеть (в отключение бесполезно)' },
  { id: 'reOver', group: 'output', reg: 308, prog: 6, name: 'Перезапуск после перегрузки', kind: 'bool', risk: 'care', why: 'выкл. — после перегрузки дом без питания до ручного включения' },
  { id: 'reHot', group: 'output', reg: 309, prog: 7, name: 'Перезапуск после перегрева', kind: 'bool', risk: 'care', why: 'выкл. — после перегрева дом без питания до ручного включения' },

  // ── the device ──
  { id: 'buzzer', group: 'device', reg: 303, prog: 18, name: 'Пищалка', kind: 'enum', risk: 'safe',
    options: [{ v: 0, label: 'тихо' }, { v: 1, label: 'сеть и ошибки' }, { v: 2, label: 'предупр.' }, { v: 3, label: 'только авария' }], why: '' },
  { id: 'light', group: 'device', reg: 305, prog: 20, name: 'Подсветка экрана', kind: 'enum', risk: 'safe', options: [{ v: 0, label: 'гаснет' }, { v: 1, label: 'всегда' }], why: '' },
  { id: 'home', group: 'device', reg: 306, prog: 19, name: 'Экран к главному', kind: 'enum', risk: 'safe', options: [{ v: 0, label: 'остаётся' }, { v: 1, label: 'через 1 мин' }], why: '' },
  { id: 'eco', group: 'device', reg: 307, prog: null, name: 'Энергосбережение', kind: 'bool', risk: 'care', why: 'без нагрузки инвертор засыпает; роутер и Mac мелкие — может «уснуть» под ними' },
  { id: 'mode', group: 'device', reg: 300, prog: null, name: 'Режим работы', kind: 'enum', risk: 'locked', options: [{ v: 0, label: 'один' }, { v: 1, label: 'параллель' }], why: 'инвертор один' },
]

export const GROUPS = [
  { id: 'charge', icon: '↯', title: 'Заряд банка', color: '#22d3ee' },
  { id: 'protect', icon: '⛨', title: 'Защита банка', color: '#fdb022' },
  { id: 'output', icon: '⌂', title: 'Дом и сеть', color: '#a78bfa' },
  { id: 'device', icon: '⚙', title: 'Сам инвертор', color: '#8b95a7' },
]

// the value as the screen shows it (a number in its unit, an enum's code, a bool)
export function valueOf(s, read = READ) {
  if (s.source === 'cloud') return CLOUD.values[s.id] ?? null
  if (s.kind === 'triple') return s.regs.map((r) => word(r, read))
  const w = word(s.reg, read)
  if (w == null) return null
  if (s.kind === 'num') return Math.round(w * s.scale * 100) / 100
  if (s.kind === 'bool') return w === 1
  return w
}
export const byId = Object.fromEntries(SETTINGS.map((s) => [s.id, s]))

// What the inverter would refuse (its own rules, from the manual), and what we would warn about. `vals` maps id → value.
const n = (x) => String(x).replace('.', ',')
export function problems(vals) {
  const out = []
  const v = (id) => vals[id]
  for (const s of SETTINGS) {
    if (s.kind !== 'num' || v(s.id) == null || s.risk === 'locked') continue
    if (v(s.id) < s.min || v(s.id) > s.max) out.push({ id: s.id, refuse: true, text: `${s.name}: вне ${n(s.min)}–${n(s.max)} ${s.unit}` })
  }
  if (v('float') > v('cv')) out.push({ id: 'float', refuse: true, text: 'поддержка выше C.V. (П27 ≤ П26)' })
  if (v('maxAc') > v('maxCharge')) out.push({ id: 'maxAc', refuse: true, text: 'ток от сети больше общего (П11 ≤ П02)' })
  if (v('eq')) out.push({ id: 'eq', refuse: false, text: 'выравнивание для LiFePO4 запрещено' })
  if (v('lowOff') >= v('lowMains')) out.push({ id: 'lowOff', refuse: false, text: 'отключение от батареи не ниже порога при сети' })
  for (const s of SETTINGS) {
    if (s.kind === 'enum' && s.options?.length) {
      const o = s.options.find((x) => x.v === v(s.id))
      if (o?.bad) out.push({ id: s.id, refuse: false, text: `${s.name}: ${o.bad}` })
    }
    if (s.kind === 'num' && s.ok && v(s.id) != null && (v(s.id) < s.ok[0] || v(s.id) > s.ok[1]) && s.risk === 'danger')
      out.push({ id: s.id, refuse: false, text: `${s.name}: вне хорошей полосы ${n(s.ok[0])}–${n(s.ok[1])} ${s.unit}` })
  }
  return out
}

// The conditions under which a write would be allowed, from the admin's live state.
export function conditions({ liveOk, phase, a }) {
  return [
    { ok: !!liveOk, text: 'инвертор на связи' },
    { ok: liveOk && phase !== 'battery', text: 'дом от сети, не во время отключения' },
    { ok: liveOk && !(phase === 'charging' && a > 40), text: 'не идёт сильный заряд (> 40 А)' },
  ]
}

// The plan for a list of changes: one register at a time, each read back; the old value kept for the way back.
export function plan(changes) {
  return changes.map((c) => {
    const s = byId[c.id]
    const raw = (x) => (s.kind === 'num' ? Math.round(x / (s.scale ?? 1)) : s.kind === 'bool' ? (x ? 1 : 0) : x)
    return s.reg == null
      ? { id: c.id, via: 'облако', text: `облако: ${s.name} ← ${c.to}`, back: c.from }
      : { id: c.id, via: 'Modbus', reg: s.reg, from: raw(c.from), to: raw(c.to), text: `рег. ${s.reg} ← ${raw(c.to)}, прочитать, сверить`, back: c.from }
  })
}
