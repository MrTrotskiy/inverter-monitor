// fmt(x, digits, locale): a number as the page's language writes it — fmt(-1234.5, 1, 'ru') is "−1 234,5"
// (a decimal comma, a non-breaking space between thousands, a true minus); null and NaN are "—".
const cache = new Map()
export function fmt(x, digits, locale = 'en') {
  if (x === null || x === undefined || Number.isNaN(x)) return '—'
  const key = `${locale}|${digits}`
  if (!cache.has(key)) cache.set(key, new Intl.NumberFormat(locale, digits === undefined ? { maximumFractionDigits: 3 } : { minimumFractionDigits: digits, maximumFractionDigits: digits }))
  const s = cache.get(key).format(Math.abs(x)).replace(/\s/g, ' ')
  return `${x < 0 && /[1-9]/.test(s) ? '−' : ''}${s}`
}
