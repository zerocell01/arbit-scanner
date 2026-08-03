import { config } from './config.js'
import { getTelegramUpdates, sendTelegramMessage, setTelegramCommands } from './telegram.js'
import { saveState } from './state.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function processUpdates(state, updates) {
  for (const update of updates) {
    state.telegramUpdateOffset = update.update_id + 1

    const msg = update.message
    if (!msg?.text) continue
    // cuma respon command dari chat yang udah diconfig di .env, biar orang
    // lain gak bisa stop/start bot ini
    if (String(msg.chat.id) !== String(config.telegramChatId)) continue

    const text = msg.text.trim().toLowerCase()
    if (text === '/stop') {
      state.enabled = false
      await sendTelegramMessage('Bot dihentikan. Scan di-skip sampai kamu kirim /start lagi.')
    } else if (text === '/start') {
      state.enabled = true
      await sendTelegramMessage('Bot diaktifkan. Scan jalan lagi.')
    } else if (text === '/status') {
      const status = state.enabled === false ? 'berhenti (kirim /start buat lanjut)' : 'jalan'
      await sendTelegramMessage(`Status bot: *${status}*`)
    }
  }
}

// Listener terus-nyala pakai Telegram long-polling (getUpdates nahan koneksi
// sampai 30 detik nunggu pesan baru) - jadi /start /stop /status kerasa
// hampir instan, gak nunggu jadwal cron. Proses ini jalan paralel sama loop
// scan di index.js, dua-duanya berbagi objek `state` yang sama.
export async function startCommandListener(state) {
  if (!config.telegramBotToken || !config.telegramChatId) return
  await setTelegramCommands()

  while (true) {
    try {
      const offset = state.telegramUpdateOffset ?? 0
      const updates = await getTelegramUpdates(offset, 30)
      if (updates.length > 0) {
        await processUpdates(state, updates)
        await saveState(state)
      }
    } catch (err) {
      console.error('[commands] error polling telegram:', err.message)
      await sleep(5000) // backoff dikit kalau ada error jaringan
    }
  }
}

export function isEnabled(state) {
  return state.enabled !== false
}
