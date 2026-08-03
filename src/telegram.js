import { config } from './config.js'

async function callTelegramApi(method, params) {
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/${method}`
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}

// return true kalau beneran kekirim, false kalau gagal - caller
// (index.js) HARUS cuma nge-set cooldown/dedup kalau ini true, biar
// alert yang gagal kirim tetap dicoba ulang di run berikutnya.
export async function sendTelegramAlert(text) {
  if (!config.telegramBotToken || !config.telegramChatId) {
    console.log('[telegram] belum diconfig, skip kirim. Isi ini di .env:\n', text)
    return false
  }
  return sendTelegramMessage(text)
}

export async function sendTelegramMessage(text) {
  const res = await callTelegramApi('sendMessage', {
    chat_id: config.telegramChatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  })
  if (!res.ok) {
    console.error('[telegram] gagal kirim:', res.status, await res.text())
    return false
  }
  return true
}

// short poll (timeout 0) - bot ini gak listener terus-nyala, jadi cukup cek
// pesan baru sekali tiap kali cron jalan, gak perlu long-polling.
export async function getTelegramUpdates(offset) {
  if (!config.telegramBotToken) return []
  const res = await callTelegramApi('getUpdates', { offset, timeout: 0 })
  if (!res.ok) {
    console.error('[telegram] gagal getUpdates:', res.status, await res.text())
    return []
  }
  const data = await res.json()
  return data.result ?? []
}

// daftarin /start /stop /status di menu command Telegram (tombol "/" di app).
// Aman dipanggil berkali-kali, Telegram cuma overwrite daftar yang sama.
export async function setTelegramCommands() {
  if (!config.telegramBotToken) return
  await callTelegramApi('setMyCommands', {
    commands: [
      { command: 'start', description: 'Aktifkan scanning arbit-scanner' },
      { command: 'stop', description: 'Hentikan scanning arbit-scanner' },
      { command: 'status', description: 'Cek status bot lagi jalan atau berhenti' },
    ],
  })
}
