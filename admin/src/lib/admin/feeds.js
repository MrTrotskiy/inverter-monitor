// The admin's sources, from the server (server.mjs, feed.mjs).
import { useEffect, useState } from 'react'
import { asset, busy } from '@/space'

// The collector's own feed (/api/collector), polled every 10 s: a feed, real time.
// `on: false` asks for nothing (a hook cannot be skipped): the admin's second feed, the newest day with readings,
// is only needed while today has none.
export function useCollector(step = 15, day = null, on = true) {
  const [d, setD] = useState(null)
  useEffect(() => {
    if (!on) return setD(null)
    let alive = true
    setD((p) => (p && (p.day === day || !day) ? p : null))
    const pull = () =>
      fetch(asset(`api/collector?step=${step}${day ? `&day=${day}` : ''}`), { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((j) => alive && setD({ ...j, got: Date.now() }))
        .catch(() => alive && setD((p) => p ?? { error: true }))
    busy(pull())
    const id = setInterval(pull, 10_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [step, day, on])
  return d
}

// The bank: its measured calibration (data/calibration.json, if the test has been made) and the test mode.
export function useBank() {
  const [d, setD] = useState(null)
  useEffect(() => {
    let alive = true
    const pull = () => fetch(asset('api/bank'), { cache: 'no-store' }).then((r) => r.json()).then((j) => alive && setD(j)).catch(() => {})
    pull()
    const id = setInterval(pull, 15_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return d
}

// Every day with readings (/api/days), refreshed every 5 minutes.
export function useDays() {
  const [d, setD] = useState(null)
  useEffect(() => {
    let alive = true
    const pull = () =>
      fetch(asset('api/days'), { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((j) => alive && setD(j.days))
        .catch(() => alive && setD((p) => p ?? []))
    busy(pull())
    const id = setInterval(pull, 300_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return d
}

// Optional public/data/balance.json: one evening's extra readings (2026-10-23 on the unit this was built on).
export function useBalance() {
  const [d, setD] = useState(null)
  useEffect(() => {
    // a local file of one evening's extra readings; absent in a fresh install, which is fine
    busy(fetch(asset('data/balance.json')).then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null)))
  }, [])
  return d
}
