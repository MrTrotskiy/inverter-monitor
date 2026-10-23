// The settings page's link to the server: its state (polled), and the actions behind the PIN.
import { useEffect, useState } from 'react'
import { asset } from '@/space'

export function usePoll(path, everyMs, deps = []) {
  const [d, setD] = useState(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!path) return setD(null) // nothing to ask yet
    let alive = true
    const pull = () =>
      fetch(asset(path), { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => alive && setD(j))
        .catch(() => {})
    pull()
    const id = setInterval(pull, everyMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [path, everyMs, tick, ...deps])
  return [d, () => setTick((x) => x + 1)]
}

export async function post(path, body) {
  try {
    const r = await fetch(asset(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    return { status: r.status, ...j }
  } catch {
    return { status: 0, ok: false, why: 'сервер не ответил' }
  }
}

export const pinWhy = (r) =>
  r.lockedUntil === 'hard' ? 'PIN заблокирован: снять на Mac mini (pin.sh unlock)'
    : r.lockedUntil ? `PIN заблокирован до ${new Date(r.lockedUntil).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
      : r.left != null ? `неверный PIN, осталось попыток: ${r.left}` : r.why
