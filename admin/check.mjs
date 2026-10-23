// node check.mjs — the admin model's checks (src/lib/admin/model.check.js) and the
// feed against the real data files: every day in the list has a window, and a page address is served.
import * as modelChecks from './src/lib/admin/model.check.js'
import * as settingsChecks from './src/pages/settings/catalog.check.js'
import { days, collector } from './feed.mjs'

let ok = 0
let all = 0
const run = (name, fn) => {
  all++
  let pass = false
  try {
    pass = fn() === true
  } catch (e) {
    console.log(`  ${name}: ${e.message}`)
  }
  if (pass) ok++
  else console.log(`FAIL ${name}`)
}
for (const [name, fn] of Object.entries({ ...modelChecks, ...settingsChecks })) if (typeof fn === 'function') run(name, fn)

// the writer's own list of registers (writer/allowed.json) and the page's catalog say the same
const { SETTINGS } = await import('./src/pages/settings/catalog.js')
const { readFileSync } = await import('node:fs')
const allowed = JSON.parse(readFileSync(new URL('../writer/allowed.json', import.meta.url), 'utf8'))
const writable = SETTINGS.filter((s) => s.reg && s.risk !== 'locked' && ['num', 'enum', 'bool'].includes(s.kind) && (s.kind !== 'enum' || s.options.length))
run('writerListMatchesTheCatalog', () => {
  const regs = Object.keys(allowed).filter((k) => /^\d+$/.test(k)).map(Number).sort()
  if (JSON.stringify(regs) !== JSON.stringify(writable.map((s) => s.reg).sort())) return false
  return writable.every((s) => {
    const a = allowed[s.reg]
    if (s.kind === 'num') return a.lo === Math.round(s.min / s.scale) && a.hi === Math.round(s.max / s.scale)
    if (s.kind === 'bool') return a.lo === 0 && a.hi === 1
    return s.options.every((o) => o.v >= a.lo && o.v <= a.hi && (!a.only || a.only.includes(o.v)))
  })
})

const list = days()
if (list.length) {
  run('feedListsDaysWithReadings', () => list.every((d) => /^\d{4}-\d\d-\d\d$/.test(d.day) && d.first != null))
  run('feedGivesEachDayItsPoints', () => list.every((d) => collector(d.day, 60).points.length > 0))
} else console.log('  (no readings in data/ yet: the feed checks on real data are skipped)')
run('feedRefusesABadDay', () => collector('../../etc/passwd', 15).day === collector(null, 15).today)
console.log(`${ok}/${all}`)
process.exit(ok === all ? 0 : 1)
