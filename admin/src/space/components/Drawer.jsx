import { useEffect, useState } from 'react'

// An explanation that slides over the app from the right (or left): a tab at the edge opens it, the tab or Esc
// closes it. Colours from the Scene's dark tone variables.
export function Drawer({ title, side = 'right', w = 380, tab, children }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('[aria-modal="true"]')) return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])
  const left = side === 'left'
  const ink = { background: 'var(--sk-dock-bg, #151821)', color: 'var(--sk-dock-ink, #e6e7ea)', border: '1px solid var(--sk-dock-rule, #272c3a)' }
  return (
    <>
      <button type="button" onClick={() => setOpen(!open)}
        style={{ position: 'absolute', top: 72, zIndex: 31, [left ? 'left' : 'right']: open ? w : 0, writingMode: 'vertical-rl', transform: left ? 'rotate(180deg)' : 'none',
          padding: '12px 6px', font: '600 12px system-ui', letterSpacing: '0.04em', cursor: 'pointer', borderRadius: left ? '0 6px 6px 0' : '6px 0 0 6px', transition: 'left 180ms, right 180ms', ...ink }}>
        {tab ?? title}
      </button>
      <aside aria-hidden={!open}
        style={{ position: 'absolute', top: 0, bottom: 0, [left ? 'left' : 'right']: 0, zIndex: 30, width: w, maxWidth: '92%', overflow: 'auto',
          transform: open ? 'none' : `translateX(${left ? '-100%' : '100%'})`, visibility: open ? 'visible' : 'hidden',
          transition: open ? 'transform 180ms' : 'transform 180ms, visibility 0s linear 180ms', boxShadow: open ? '0 0 32px rgba(0,0,0,0.35)' : 'none',
          padding: '18px 20px', font: '14px/1.55 system-ui', ...ink }}>
        {title ? <h2 style={{ font: '600 16px system-ui', margin: '0 0 12px' }}>{title}</h2> : null}
        {children}
      </aside>
    </>
  )
}
