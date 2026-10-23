import { useEffect, useRef, useState } from 'react'
import { C } from '../../../lib/admin/theme.js'

// The PIN field: digits only, never kept beyond the dialog that holds it.
export function PinField({ value, onChange, disabled, autoFocus }) {
  return (
    <input type="password" inputMode="numeric" autoComplete="off" name="admin-pin" maxLength={12} value={value} disabled={disabled} autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="PIN"
      style={{ width: 150, padding: '11px 14px', borderRadius: 12, fontSize: 20, letterSpacing: 6, color: C.ink, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.22)', outline: 'none' }} />
  )
}

// A button that acts on a click, or only after being held for `holdMs` (the dangerous settings): the fill shows it.
export function HoldButton({ holdMs = 0, disabled, onFire, children, color = C.battery }) {
  const [p, setP] = useState(0)
  const t0 = useRef(null)
  const raf = useRef(null)
  const stop = () => {
    cancelAnimationFrame(raf.current)
    t0.current = null
    setP(0)
  }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  const start = () => {
    if (disabled) return
    if (!holdMs) return onFire()
    t0.current = performance.now() // the machine's own time: a hold is a person's gesture, not the page's clock
    const step = () => {
      const k = Math.min(1, (performance.now() - t0.current) / holdMs)
      setP(k)
      if (k >= 1) {
        stop()
        onFire()
      } else raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
  }
  return (
    <button disabled={disabled} onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onKeyDown={(e) => e.key === 'Enter' && !holdMs && onFire()}
      style={{ position: 'relative', overflow: 'hidden', whiteSpace: 'nowrap', padding: '12px 22px', borderRadius: 12, fontSize: 16, fontWeight: 750, cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? C.dim : C.bg, background: disabled ? 'rgba(255,255,255,0.06)' : color, border: disabled ? '1px dashed rgba(255,255,255,0.25)' : `1px solid ${color}`, userSelect: 'none', touchAction: 'none' }}>
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${p * 100}%`, background: 'rgba(255,255,255,0.45)' }} />
      <span style={{ position: 'relative' }}>{children}</span>
    </button>
  )
}
