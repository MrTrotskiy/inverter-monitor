// <Scene mode="app" tone="dark">: the whole window, nothing pans or zooms, the dark tone's colours as CSS variables
// (the Drawer reads them).
const DARK = {
  '--sk-ground': '#0d0f14', '--sk-dot': '#252a36', '--sk-dock-bg': '#151821', '--sk-dock-ink': '#e6e7ea',
  '--sk-dock-rule': '#272c3a', '--sk-dock-title': '#9aa0ab', '--sk-lit-bg': '#272c3a', '--sk-lit-ink': '#ffffff',
  '--sk-soft': '#c4c8d0', '--sk-muted': '#8a90a0', '--sk-chrome-bg': 'rgba(21,24,33,0.92)', '--sk-chrome-rule': '#272c3a',
  '--sk-chrome-ink': '#c4c8d0', '--sk-chart-ink': '#8a90a0', '--sk-chart-line': '#e6e7ea', color: '#e6e7ea',
}

export function Scene({ tone = 'dark', children }) {
  return (
    <div data-app="" data-tone={tone} style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#0d0f14', ...(tone === 'dark' ? DARK : {}) }}>
      {children}
    </div>
  )
}
