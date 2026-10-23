// This home's settings for the admin: config.json at the repository's root (ignored by git; see
// config.example.json). get('admin.port', 8080) answers the value or the default.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PATH = process.env.INVERTER_CONFIG || fileURLToPath(new URL('../config.json', import.meta.url))

export function load() {
  try {
    return JSON.parse(readFileSync(PATH, 'utf8'))
  } catch {
    return {}
  }
}

export function get(key, fallback = null) {
  let v = load()
  for (const k of key.split('.')) {
    if (v == null || typeof v !== 'object' || !(k in v)) return fallback
    v = v[k]
  }
  return v === null || v === '' ? fallback : v
}
