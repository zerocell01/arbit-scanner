import { config } from './config.js'
import { getTelegramUpdates, sendTelegramMessage, setTelegramCommands } from './telegram.js'

// Cek pesan /start /stop /status yang masuk sejak run terakhir. Short-poll
// doang (bukan listener terus-nyala) karena bot ini jalan per-cron 15
// menitan - command baru paling lambat kebaca di run cron berikutnya.
export async function pollCommands(state) {
  if (!config.telegramBotToken || !config.telegramChatId) return

  await setTelegramCommands()

  const offset = state.telegramUpdateOffset ?? 0
  const updates = await getTelegramUpdates(offset)

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
      await sendTelegramMessage('Bot diaktifkan. Scan jalan lagi mulai run berikutnya.')
    } else if (text === '/status') {
      const status = state.enabled === false ? 'berhenti (kirim /start buat lanjut)' : 'jalan'
      await sendTelegramMessage(`Status bot: *${status}*`)
    }
  }
}

export function isEnabled(state) {
  return state.enabled !== false
}
