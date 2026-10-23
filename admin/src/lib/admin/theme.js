import { fmt } from '@/space'

export const C = {
  bg: '#060912',
  ink: '#f2f4f7',
  dim: '#8b95a7',
  faint: 'rgba(255,255,255,0.08)',
  battery: '#fdb022',
  low: '#f97066',
  charging: '#22d3ee',
  full: '#32d583',
  grid: '#32d583',
  offline: '#667085',
  load: '#a78bfa',
}
export const MONO = 'JetBrains Mono, ui-monospace, monospace'
export const SANS = 'Inter, system-ui, sans-serif'
export const nf = (x, d = 0) => fmt(x, d, 'ru')
export const clockOf = (t) => new Date(t).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' })
export const dayOf = (t) => new Date(t).toLocaleDateString('ru-RU', { timeZone: 'Europe/Kyiv', weekday: 'short' })
export const phaseColor = (v, offline) => (offline ? C.offline : v?.phase === 'battery' && v.soc < 25 ? C.low : C[v?.phase] ?? C.full)
