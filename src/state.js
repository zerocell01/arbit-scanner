import { readFile, writeFile } from 'node:fs/promises'
import { config } from './config.js'

const STATE_PATH = new URL('../state.json', import.meta.url)

export async function loadState() {
  try {
    const raw = await readFile(STATE_PATH, 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export async function saveState(state) {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2))
}

// true kalau token+pair ini masih dalam cooldown (jangan alert lagi dulu)
export function isOnCooldown(state, key) {
  const last = state[key]
  if (!last) return false
  const hoursSince = (Date.now() - last) / (1000 * 60 * 60)
  return hoursSince < config.alertCooldownHours
}

export function markAlerted(state, key) {
  state[key] = Date.now()
}
