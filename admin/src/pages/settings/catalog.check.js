import { SETTINGS, valueOf, problems, plan, byId } from './catalog.js'

const now = () => Object.fromEntries(SETTINGS.map((s) => [s.id, valueOf(s)]))

// the words of 23 Oct decode to what the cloud showed on 18 Sep (data/settings-snapshot.txt)
export function readMatchesTheCloud() {
  const v = now()
  return v.cv === 14.1 && v.float === 14.1 && v.lowMains === 12.7 && v.lowOff === 11.7 && v.maxCharge === 50 && v.priority === 0 && v.chargeSrc === 2 && v.eq === false
}

export function todaysSettingsAreAccepted() {
  return problems(now()).every((p) => !p.refuse)
}

export function floatAboveCvIsRefused() {
  return problems({ ...now(), float: 14.3 }).some((p) => p.id === 'float' && p.refuse)
}

export function acAboveTotalIsRefused() {
  return problems({ ...now(), maxAc: 60, maxCharge: 50 }).some((p) => p.id === 'maxAc' && p.refuse)
}

export function outOfRangeIsRefused() {
  return problems({ ...now(), cv: 15.6 }).some((p) => p.id === 'cv' && p.refuse)
}

export function eqAndPvOnlyAreWarned() {
  const p = problems({ ...now(), eq: true, chargeSrc: 3 })
  return p.some((x) => x.id === 'eq') && p.some((x) => x.id === 'chargeSrc')
}

export function planWritesRawWordsAndKeepsTheOldValue() {
  const p = plan([{ id: 'cv', from: 14.1, to: 14.4 }, { id: 'cvTime', from: 10, to: 60 }])
  return p[0].reg === 324 && p[0].to === 144 && p[0].from === 141 && p[0].back === 14.1 && p[1].via === 'облако'
}

export function everySettingHasAGroupAndARisk() {
  return SETTINGS.every((s) => s.group && s.risk && byId[s.id] === s)
}
