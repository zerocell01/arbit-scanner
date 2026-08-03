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

// `extra` buat nempelin reply_markup (inline keyboard button) ke pesan.
export async function sendTelegramMessage(text, extra = {}) {
  const res = await callTelegramApi('sendMessage', {
    chat_id: config.telegramChatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    ...extra,
  })
  if (!res.ok) {
    console.error('[telegram] gagal kirim:', res.status, await res.text())
    return false
  }
  return true
}

// timeout dalam detik - dipakai buat Telegram long-polling (server nahan
// koneksi sampai ada pesan baru atau timeout abis), bukan cuma cek sekilas.
export async function getTelegramUpdates(offset, timeout = 0) {
  if (!config.telegramBotToken) return []
  const res = await callTelegramApi('getUpdates', { offset, timeout })
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
      { command: 'menu', description: 'Tampilin menu tombol Start/Stop/Status' },
    ],
  })
}
