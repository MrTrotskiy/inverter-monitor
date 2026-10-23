// The PIN that every change in the admin needs (inverter settings, the bot). Only a scrypt hash is kept, in
// data/admin/pin.json (mode 600, outside git); the PIN itself is never stored, logged or sent anywhere.
// Wrong PINs: 5 in a row lock changes for 15 minutes; 3 such locks without a right PIN in between lock them until
// `pin.sh unlock` is run on the Mac mini. Every attempt (right or wrong, never the digits) goes to security.jsonl.
//
//   library: pinStatus(), checkPin(pin, ip)
//   command line (admin/pin.sh calls it; the PIN comes on stdin, never as an argument):
//     node pin.mjs set        (stdin: the new PIN)   node pin.mjs unlock   node pin.mjs remove   node pin.mjs status
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, rmSync, renameSync, chmodSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DATA = process.env.INVERTER_DATA || fileURLToPath(new URL('../data', import.meta.url))
const DIR = `${DATA}/admin`
const PIN = `${DIR}/pin.json`
const STATE = `${DIR}/pin-state.json`
const LOG = `${DIR}/security.jsonl`
export const RULES = { fails: 5, lockMin: 15, hardAfter: 3, minLen: 6, maxLen: 12 }
const KDF = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

const read = (p, d) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return d
  }
}
const write = (p, obj) => {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(p + '.tmp', JSON.stringify(obj), { mode: 0o600 })
  renameSync(p + '.tmp', p)
  chmodSync(p, 0o600)
}
const log = (event, extra = {}) => {
  mkdirSync(DIR, { recursive: true })
  appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), event, ...extra }) + '\n', { mode: 0o600 })
}
const hash = (pin, salt) => scryptSync(String(pin), salt, 32, KDF)

export function pinStatus(now = Date.now()) {
  const st = read(STATE, {})
  return { set: !!read(PIN, null)?.hash, lockedUntil: st.hard ? 'hard' : st.lockedUntil && st.lockedUntil > now ? st.lockedUntil : null, fails: st.fails ?? 0 }
}

// -> { ok: true } | { ok: false, why: 'no-pin' | 'locked' | 'wrong', left?, lockedUntil? }
export function checkPin(pin, ip = '?') {
  const now = Date.now()
  const rec = read(PIN, null)
  if (!rec?.hash) return { ok: false, why: 'no-pin' }
  const st = read(STATE, { fails: 0, locks: 0 })
  if (st.hard) return { ok: false, why: 'locked', lockedUntil: 'hard' }
  if (st.lockedUntil && st.lockedUntil > now) return { ok: false, why: 'locked', lockedUntil: st.lockedUntil }
  const good = typeof pin === 'string' && /^\d{1,32}$/.test(pin) && timingSafeEqual(hash(pin, Buffer.from(rec.salt, 'hex')), Buffer.from(rec.hash, 'hex'))
  if (good) {
    write(STATE, { fails: 0, locks: 0 })
    log('pin-ok', { ip })
    return { ok: true }
  }
  const fails = (st.fails ?? 0) + 1
  const next = { fails, locks: st.locks ?? 0 }
  if (fails >= RULES.fails) {
    next.fails = 0
    next.locks += 1
    next.lockedUntil = now + RULES.lockMin * 60_000
    if (next.locks >= RULES.hardAfter) next.hard = true
  }
  write(STATE, next)
  log(next.hard ? 'pin-hard-lock' : next.lockedUntil ? 'pin-locked' : 'pin-wrong', { ip })
  return next.lockedUntil ? { ok: false, why: 'locked', lockedUntil: next.hard ? 'hard' : next.lockedUntil } : { ok: false, why: 'wrong', left: RULES.fails - fails }
}

export function setPin(pin) {
  if (!new RegExp(`^\\d{${RULES.minLen},${RULES.maxLen}}$`).test(pin)) throw new Error(`PIN: от ${RULES.minLen} до ${RULES.maxLen} цифр`)
  if (/^(\d)\1+$/.test(pin) || '0123456789012'.includes(pin) || '9876543210987'.includes(pin)) throw new Error('PIN слишком простой (одинаковые цифры или подряд)')
  const salt = randomBytes(16)
  write(PIN, { algo: 'scrypt', ...KDF, maxmem: undefined, salt: salt.toString('hex'), hash: hash(pin, salt).toString('hex'), setAt: new Date().toISOString() })
  write(STATE, { fails: 0, locks: 0 })
  log('pin-set')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2]
  if (cmd === 'set') {
    let input = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (input += c))
    process.stdin.on('end', () => {
      try {
        setPin(input.trim())
        console.log('PIN задан. Изменения в админке теперь возможны только с ним.')
      } catch (e) {
        console.error(e.message)
        process.exit(1)
      }
    })
  } else if (cmd === 'unlock') {
    write(STATE, { fails: 0, locks: 0 })
    log('pin-unlocked')
    console.log('Блокировка снята.')
  } else if (cmd === 'remove') {
    rmSync(PIN, { force: true })
    write(STATE, { fails: 0, locks: 0 })
    log('pin-removed')
    console.log('PIN удалён: админка только для просмотра, пока не задан новый.')
  } else if (cmd === 'status') {
    const s = pinStatus()
    console.log(s.set ? 'PIN задан.' : 'PIN не задан: админка только для просмотра.', s.lockedUntil === 'hard' ? 'Изменения заблокированы до unlock.' : s.lockedUntil ? `Блок до ${new Date(s.lockedUntil).toLocaleTimeString('ru-RU')}.` : '')
  } else {
    console.error('usage: node pin.mjs set|unlock|remove|status')
    process.exit(1)
  }
}
