import { config } from './config.js'
import { getTelegramUpdates, sendTelegramMessage, setTelegramCommands } from './telegram.js'
import { saveState } from './state.js'
import { wakeEmitter } from './wake.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function isEnabled(state) {
  return state.enabled !== false
}

const BTN_SCAN = '📡 Scan Sekarang'
const BTN_ROUTE = '🔀 Jalur Terakhir'
const BTN_STOP = '⏸ Stop'
const BTN_START = '▶️ Start'
const BTN_STATUS = '📊 Status'

// Reply keyboard PERMANEN nempel di bawah kotak chat (beda sama inline
// keyboard yang nempel di satu pesan doang) - sekali kekirim, tetep
// keliatan di app Telegram user sampai di-remove_keyboard eksplisit.
// Kita gak pernah remove, jadi cukup nempel sekali di pesan pertama.
function menuKeyboard(state) {
  const startStop = isEnabled(state) ? BTN_STOP : BTN_START
  return {
    reply_markup: {
      keyboard: [
        [BTN_SCAN, BTN_ROUTE],
        [startStop, BTN_STATUS],
      ],
      resize_keyboard: true,
    },
  }
}

function formatLastRoute(state) {
  const r = state.lastRoute
  if (!r) return 'Belum ada token yang lolos filter gap harga sejak bot ini jalan.'

  const agoMin = Math.round((Date.now() - r.time) / 60000)
  const lines = [
    `*Kandidat arbitrase terakhir* (${agoMin} menit lalu)`,
    `Token: *${r.symbol}*`,
    `Beli di *${r.fromPlatform}* → Jual di *${r.toPlatform}*`,
    `Gap harga: ${r.gapPercent.toFixed(2)}%`,
  ]

  if (!r.routeFound) {
    lines.push('', '_Gak ada rute bridge yang lolos di LI.FI (liquiditas kemungkinan tipis) - gap ini kemungkinan gak beneran bisa dieksekusi._')
    return lines.join('\n')
  }

  lines.push(
    `Jalur bridge: *${r.bridgeName}*`,
    `Estimasi profit bersih: $${r.netProfitUsd.toFixed(2)} (${r.netProfitPercent.toFixed(2)}%)`,
    '',
    r.alerted
      ? '_(sempat dikirim sebagai alert)_'
      : '_(di bawah threshold profit, gak dikirim sebagai alert)_',
  )
  return lines.join('\n')
}

// Semua aksi teks (command "/x" MAUPUN tap tombol reply-keyboard, dua-duanya
// masuk sebagai update.message biasa di Telegram) dipusatin di sini.
async function handleText(state, text) {
  switch (text) {
    case '/start':
    case BTN_START:
      state.enabled = true
      return 'Bot diaktifkan. Scan jalan lagi.'
    case '/stop':
    case BTN_STOP:
      state.enabled = false
      return 'Bot dihentikan. Scan di-skip sampai kamu tap Start lagi.'
    case '/status':
    case BTN_STATUS:
      return `Status bot: *${isEnabled(state) ? 'jalan' : 'berhenti'}*`
    case '/menu':
      return 'Menu kontrol arbit-scanner:'
    case BTN_SCAN:
      // forced: true biar scan tetep jalan sekali walau lagi status stopped
      wakeEmitter.emit('wake', { forced: true })
      return 'Oke, scan dimulai sekarang (di luar jadwal biasa). Kalau lagi ada scan yang jalan, ini nunggu itu selesai dulu.'
    case BTN_ROUTE:
      return formatLastRoute(state)
    default:
      return null
  }
}

async function processUpdates(state, updates) {
  for (const update of updates) {
    state.telegramUpdateOffset = update.update_id + 1

    const msg = update.message
    if (!msg?.text) continue
    // cuma respon dari chat yang udah diconfig di .env, biar orang lain
    // gak bisa kontrol bot ini
    if (String(msg.chat.id) !== String(config.telegramChatId)) continue

    const reply = await handleText(state, msg.text.trim())
    if (reply) await sendTelegramMessage(reply, menuKeyboard(state))
  }
}

// Listener terus-nyala pakai Telegram long-polling (getUpdates nahan koneksi
// sampai 30 detik nunggu pesan/tap baru) - jadi command & tombol menu kerasa
// hampir instan, gak nunggu jadwal scan. Proses ini jalan paralel sama loop
// scan di index.js, dua-duanya berbagi objek `state` yang sama.
export async function startCommandListener(state) {
  if (!config.telegramBotToken || !config.telegramChatId) return
  await setTelegramCommands()
  await sendTelegramMessage('arbit-scanner online. Menu kontrol:', menuKeyboard(state))

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
