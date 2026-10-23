// Small helpers the screens share: an animation clock, a re-render tick, number format, a drawer, a canvas, a
// full-window dark frame, its size, an address helper.
import { useEffect, useSyncExternalStore } from 'react'

export { clock } from './lab/clock.js'
export { useTick } from './lab/use-tick.js'
export { fmt } from './lab/fmt.js'
export { Drawer } from './components/Drawer.jsx'
export { Canvas2D } from './components/Canvas2D.jsx'
export { Scene } from './components/Scene.jsx'

// a file of public/ or a server route, wherever the app is served
export const asset = (file) => `${import.meta.env.BASE_URL}${String(file).replace(/^\/+/, '')}`

// a promise the page waits on (kept as a hook point for tests)
export const busy = (p) => p

// each screen's handle on window.inverter.<name> (admin, history, settings…), for devtools and the browser checks
export function useExpose(name, api) {
  useEffect(() => {
    window.inverter = window.inverter || {}
    window.inverter[name] = api
  })
}

// the window's size, followed on resize
let size = { width: 0, height: 0 }
const read = () => {
  if (typeof window === 'undefined') return size
  if (size.width !== window.innerWidth || size.height !== window.innerHeight) size = { width: window.innerWidth, height: window.innerHeight }
  return size
}
const listen = (fn) => {
  window.addEventListener('resize', fn)
  return () => window.removeEventListener('resize', fn)
}
export const useFrameSize = () => useSyncExternalStore(listen, read, read)
