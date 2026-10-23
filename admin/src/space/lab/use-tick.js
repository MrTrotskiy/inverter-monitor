import { useEffect, useRef, useState } from 'react'
import { clock } from './clock'

// Re-renders its component on the clock, at most `fps` times a second; returns the seconds it has been running.
export function useTick({ fps = 60 } = {}) {
  const [t, setT] = useState(0)
  const acc = useRef(0)
  const shown = useRef(-Infinity)
  useEffect(
    () =>
      clock.subscribe((_, dt) => {
        acc.current += dt
        const now = performance.now()
        if (now - shown.current >= 1000 / fps) {
          shown.current = now
          setT(acc.current)
        }
      }, { phase: 'draw' }),
    [fps],
  )
  return t
}
