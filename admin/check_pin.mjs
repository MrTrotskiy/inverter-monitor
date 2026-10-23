// node check_pin.mjs — the PIN rules in a temp data folder: 4–12 digits, the obvious ones refused, the lock after 5
// wrong ones, the hard lock after 3 locks in a row, unlock, and the digits nowhere on disk.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(`${tmpdir()}/inv-pin-`)
process.env.INVERTER_DATA = dir
const { setPin, checkPin, pinStatus } = await import('./pin.mjs')
const results = []
const check = (name, ok, note = '') => {
  results.push(!!ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${note ? ' — ' + note : ''}`)
}
const refuses = (p) => {
  try {
    setPin(p)
    return false
  } catch {
    return true
  }
}

check('a 4-digit PIN is accepted', !refuses('4829') && pinStatus().set)
check('12 digits accepted, 3 and 13 refused, letters refused', !refuses('482916370514') && refuses('482') && refuses('4829163705142') && refuses('48a9'))
const obvious = ['1111', '0000', '1234', '4321', '0123', '9876', '1212', '6969', '2580', '123456', '111111']
check('the obvious ones are refused', obvious.every(refuses), obvious.filter((p) => !refuses(p)).join(','))
setPin('4829')
check('the right PIN passes', checkPin('4829').ok)
let r
for (let i = 0; i < 4; i++) r = checkPin('0001')
check('4 wrong: still open, 1 left', r.why === 'wrong' && r.left === 1)
r = checkPin('0002')
check('the 5th wrong locks for 15 min', r.why === 'locked' && r.lockedUntil > Date.now() + 14 * 60_000)
check('the right PIN while locked is refused', !checkPin('4829').ok)
// two more locks in a row (the 15 minutes are skipped by moving the lock's end into the past)
const st = `${dir}/admin/pin-state.json`
for (let k = 0; k < 2; k++) {
  writeFileSync(st, JSON.stringify({ ...JSON.parse(readFileSync(st, 'utf8')), lockedUntil: Date.now() - 1 }))
  for (let i = 0; i < 5; i++) r = checkPin('0003')
}
check('after 3 locks in a row: locked until unlock on the Mac', r.lockedUntil === 'hard' && pinStatus().lockedUntil === 'hard')
writeFileSync(st, JSON.stringify({ ...JSON.parse(readFileSync(st, 'utf8')), lockedUntil: Date.now() - 1 }))
check('…and time alone does not lift it', !checkPin('4829').ok)
writeFileSync(st, JSON.stringify({ fails: 0, locks: 0 })) // what `pin.sh unlock` writes
check('after unlock the right PIN passes', checkPin('4829').ok)
const files = readdirSync(`${dir}/admin`).map((f) => readFileSync(`${dir}/admin/${f}`, 'utf8'))
check('the digits are nowhere on disk', !files.some((t) => t.includes('4829')))
rmSync(dir, { recursive: true, force: true })
console.log(`${results.filter(Boolean).length}/${results.length}`)
process.exit(results.every(Boolean) ? 0 : 1)
