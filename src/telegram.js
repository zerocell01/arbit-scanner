import { config } from './config.js'

export async function sendTelegramAlert(text) {
  if (!config.telegramBotToken || !config.telegramChatId) {
    console.log('[telegram] belum diconfig, skip kirim. Isi ini di .env:\n', text)
    return
  }

  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.telegramChatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  })
  if (!res.ok) {
    console.error('[telegram] gagal kirim:', res.status, await res.text())
  }
}
