// One animation loop for everything that moves on the page. clock.now() is seconds since the page started (a hidden
// tab does not jump: a frame carries at most 1/4 s). subscribe(fn, { phase }) calls fn(t, dt) every frame; 'step'
// listeners run before 'draw' ones, so a view always draws the state just stepped.
let t = 0
let last = null
let raf = null
const steps = new Set()
const draws = new Set()

function frame(ms) {
  raf = null
  const dt = last === null ? 0 : Math.min(0.25, (ms - last) / 1000)
  last = ms
  if (dt > 0) {
    t += dt
    for (const fn of [...steps]) run(fn, dt)
    for (const fn of [...draws]) run(fn, dt)
  }
  kick()
}

function run(fn, dt) {
  try {
    fn(t, dt)
  } catch (e) {
    console.error(e)
  }
}

function kick() {
  if (raf === null && steps.size + draws.size > 0 && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame)
}

export const clock = {
  now: () => t,
  paused: false,
  subscribe(fn, { phase = 'step' } = {}) {
    const set = phase === 'draw' ? draws : steps
    set.add(fn)
    kick()
    return () => set.delete(fn)
  },
}
