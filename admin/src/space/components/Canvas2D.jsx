import { useEffect, useRef } from 'react'
import { clock } from '../lab/clock.js'

// A <canvas> drawn in CSS pixels at the screen's density. `live`: drawn every frame of the clock (the 'draw' phase);
// otherwise when it mounts and whenever `draw` changes.
export function Canvas2D({ w, h, draw, live = false, clear = true, ...rest }) {
  const el = useRef(null)
  const drawRef = useRef(draw)
  drawRef.current = draw
  const scale = typeof window === 'undefined' ? 1 : Math.min(3, window.devicePixelRatio || 1)

  const paint = (t, dt) => {
    const c = el.current
    if (!c) return
    const ctx = c.getContext('2d')
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    if (clear) ctx.clearRect(0, 0, w, h)
    drawRef.current?.(ctx, { w, h, t, dt, scale })
  }

  useEffect(() => {
    const c = el.current
    if (!c) return
    c.width = Math.round(w * scale)
    c.height = Math.round(h * scale)
    paint(clock.now(), 0)
  }, [w, h, scale])

  useEffect(() => {
    if (!live) paint(clock.now(), 0)
  }, [draw, live])

  useEffect(() => {
    if (!live) return
    return clock.subscribe((t, dt) => paint(t, dt), { phase: 'draw' })
  }, [live, scale, w, h, clear])

  return <canvas {...rest} ref={el} style={{ width: w, height: h, display: 'block', ...rest.style }} />
}
