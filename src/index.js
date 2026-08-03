import { config, CHAIN_MAP } from './config.js'
import { fetchVolatileCandidates, fetchPlatforms } from './coingecko.js'
import { fetchTokenInfo } from './lifi.js'
import { estimateArbitrage } from './profit.js'
import { checkArbitrageSafety } from './security.js'
import { checkCcipRoute } from './ccip.js'
import { sendTelegramAlert } from './telegram.js'
import { loadState, saveState, isOnCooldown, markAlerted } from './state.js'
import { startCommandListener, isEnabled } from './commands.js'
import { wakeEmitter } from './wake.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Berapa kandidat terakhir yang disimpen buat tombol "Jalur Terakhir" -
// bukan cuma 1, biar gak ke-overwrite abis tiap ada kandidat baru lolos
// gap filter (makin gampang kejadian sejak pool-nya diperlebar).
const MAX_ROUTE_HISTORY = 5

// Kayak sleep(), tapi bisa diinterupsi lebih awal lewat wakeEmitter (dipicu
// tombol "Scan Sekarang" di Telegram). Resolve dengan payload event-nya
// (mis. `{ forced: true }`), atau `undefined` kalau abis karena timeout biasa.
function waitForNextCycle(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wakeEmitter.off('wake', onWake)
      resolve(undefined)
    }, ms)
    function onWake(payload) {
      clearTimeout(timer)
      resolve(payload)
    }
    wakeEmitter.once('wake', onWake)
  })
}

async function scanOnce(state) {
  console.log('[stage1] scanning gainers/losers...')
  const candidates = await fetchVolatileCandidates()
  console.log(`[stage1] ${candidates.length} kandidat volatile ditemukan`)

  let alertsSent = 0

  for (const candidate of candidates) {
    // jaga-jaga biar gak nabrak rate limit free tier CoinGecko
    await sleep(4000)

    let platforms
    try {
      platforms = await fetchPlatforms(candidate.id)
    } catch (err) {
      console.warn(`[stage2] skip ${candidate.id}: ${err.message}`)
      continue
    }

    const supportedChains = Object.entries(platforms).filter(([platform]) => CHAIN_MAP[platform])
    if (supportedChains.length < 2) continue // butuh minimal 2 chain buat arbit

    console.log(`[stage2] ${candidate.symbol} ada di ${supportedChains.length} chain yang dikenal`)

    // Stage 3: ambil harga per-chain dari LI.FI, cari pair dengan gap terbesar
    const prices = []
    for (const [platform, address] of supportedChains) {
      await sleep(300)
      const chainKey = CHAIN_MAP[platform]
      try {
        const info = await fetchTokenInfo(chainKey, address)
        if (info) prices.push({ platform, chainKey, address, price: info.price, decimals: info.decimals })
      } catch (err) {
        console.warn(`[stage3] skip ${candidate.symbol}/${platform}: ${err.message}`)
      }
    }

    if (prices.length < 2) continue

    prices.sort((a, b) => a.price - b.price)
    const cheapest = prices[0]
    const priciest = prices[prices.length - 1]
    const gapPercent = ((priciest.price - cheapest.price) / cheapest.price) * 100

    if (gapPercent < config.minGapPercent) continue

    const key = `${candidate.id}:${cheapest.platform}:${priciest.platform}`
    const onCooldown = isOnCooldown(state, key)

    // Stage 5: simulasi bridge beneran - dapetin jalur (bridge/tool) dan
    // profit bersih setelah fee, sekaligus cek liquiditas real (bukan cuma
    // selisih harga di atas kertas). Dijalanin WALAU lagi cooldown, biar
    // tombol "Jalur Terakhir" di Telegram tetap ke-update sama data
    // terbaru (cuma alert-nya doang yang di-skip pas cooldown).
    let arb
    try {
      arb = await estimateArbitrage(cheapest, priciest)
    } catch (err) {
      console.warn(`[stage5] skip ${candidate.symbol}: ${err.message}`)
      continue
    }

    // Dicatet buat tombol "Jalur Terakhir" - selalu diisi tiap ada kandidat
    // yang lolos gap filter, MASUK kasus rute gak ketemu (routeFound:false),
    // biar user tetep bisa liat kenapa suatu token gak jadi alert. Simpen
    // beberapa terakhir (bukan cuma 1), biar kandidat yang ke-overwrite gara
    // gara pool makin luas (COINGECKO_PAGES) gak ilang semua.
    const routeEntry = {
      symbol: candidate.symbol.toUpperCase(),
      fromPlatform: cheapest.platform,
      toPlatform: priciest.platform,
      fromAddress: cheapest.address,
      toAddress: priciest.address,
      gapPercent,
      routeFound: arb.routeFound,
      bridgeName: arb.routeFound ? arb.bridgeName : null,
      netProfitUsd: arb.routeFound ? arb.netProfitUsd : null,
      netProfitPercent: arb.routeFound ? arb.netProfitPercent : null,
      time: Date.now(),
      alerted: false,
    }
    state.lastRoutes = [routeEntry, ...(state.lastRoutes ?? [])].slice(0, MAX_ROUTE_HISTORY)

    if (!arb.routeFound) {
      // Fallback: LI.FI gak nge-cover Chainlink CCIP sama sekali (dicek di
      // /v1/tools) - token yang jalur SATU-SATUNYA lewat CCIP bakal selalu
      // "no route" di sini walau peluangnya beneran ada. Cek directory CCIP
      // (gratis) sebelum nyerah total.
      let ccipFound = false
      try {
        ccipFound = await checkCcipRoute(candidate.symbol, cheapest.chainKey, priciest.chainKey)
      } catch (err) {
        console.warn(`[ccip] skip cek ${candidate.symbol}: ${err.message}`)
      }

      if (!ccipFound) {
        console.log(`[stage5] ${candidate.symbol} gap ${gapPercent.toFixed(2)}% tapi gak ada rute bridge yang lolos (liquiditas tipis ATAU honeypot/tax jual ekstrim), skip alert`)
        continue
      }

      routeEntry.ccipFallback = true
      console.log(`[ccip] ${candidate.symbol} gak ada rute LI.FI, TAPI ada lane CCIP terdaftar - kirim info (tanpa angka profit, CCIP directory gak kasih data quote)`)

      if (onCooldown) {
        console.log(`[ccip] ${candidate.symbol} lane CCIP ketemu tapi masih cooldown, skip info`)
        continue
      }

      const infoText = [
        `*Kemungkinan gap: ${candidate.symbol.toUpperCase()}*`,
        `24h change: ${candidate.change24h.toFixed(1)}%`,
        `${cheapest.platform} → ${priciest.platform}, gap harga *${gapPercent.toFixed(2)}%*`,
        '',
        '⚠️ LI.FI gak nemu rute buat token ini, TAPI Chainlink CCIP Directory nunjukin ada lane bridge terdaftar di kedua chain (LI.FI gak cover CCIP sama sekali).',
        'Belum ada estimasi fee/profit - directory ini cuma nunjukin lane-nya ADA, bukan quote. Cek manual di transporter.io atau CCIP Explorer buat liat cost & simulasi beneran sebelum eksekusi.',
        '',
        `CA (${cheapest.platform}): \`${cheapest.address}\``,
        `CA (${priciest.platform}): \`${priciest.address}\``,
      ].join('\n')

      const infoSent = await sendTelegramAlert(infoText)
      if (infoSent) {
        markAlerted(state, key)
        routeEntry.alerted = true
      }
      continue
    }

    if (onCooldown) {
      console.log(`[stage4] ${candidate.symbol} rute ketemu (${arb.bridgeName}) tapi masih cooldown, skip alert`)
      continue
    }

    if (arb.netProfitPercent < config.minNetProfitPercent) {
      console.log(
        `[stage5] ${candidate.symbol} rute ketemu (${arb.bridgeName}) tapi profit bersih cuma ${arb.netProfitPercent.toFixed(2)}% (fee+gas ~$${arb.totalFeeUsd.toFixed(2)}), skip alert`,
      )
      continue
    }

    // Cek honeypot/tax jual ekstrim (GoPlus) SEBELUM alert beneran dikirim -
    // lapisan tambahan di luar Stage 5, buat nangkep token yang LOLOS quote
    // LI.FI tapi ternyata gak bisa dijual di dunia nyata (LI.FI gak selalu
    // simulasi logic tax/blacklist kontrak yang aneh-aneh).
    let safety
    try {
      safety = await checkArbitrageSafety(cheapest, priciest)
    } catch (err) {
      console.warn(`[security] skip cek ${candidate.symbol}: ${err.message}`)
      safety = { safe: true, reason: null } // fail-open - API down jangan sampai matiin fungsi alert
    }

    if (!safety.safe) {
      console.log(`[security] ${candidate.symbol} rute+profit lolos tapi kedeteksi ${safety.reason} - skip alert`)
      routeEntry.securityFlag = safety.reason
      continue
    }

    const text = [
      `*Gap harga: ${candidate.symbol.toUpperCase()}*`,
      `24h change: ${candidate.change24h.toFixed(1)}%`,
      `Beli di *${cheapest.platform}*: $${cheapest.price.toPrecision(6)}`,
      `Jual di *${priciest.platform}*: $${priciest.price.toPrecision(6)}`,
      `Gap harga: *${gapPercent.toFixed(2)}%*`,
      '',
      `Jalur bridge: *${arb.bridgeName}*`,
      `Modal simulasi: $${config.tradeSizeUsd}`,
      `Estimasi profit bersih: *$${arb.netProfitUsd.toFixed(2)} (${arb.netProfitPercent.toFixed(2)}%)*`,
      `Total fee+gas bridge: ~$${arb.totalFeeUsd.toFixed(2)}`,
      '',
      `CA (${cheapest.platform}): \`${cheapest.address}\``,
      `CA (${priciest.platform}): \`${priciest.address}\``,
      '',
      '_Profit di atas simulasi rute bridge doang - belum termasuk slippage beli/jual di DEX. Udah lolos cek honeypot GoPlus, TAPI itu bukan jaminan mutlak (GoPlus gak selalu lengkap datanya) - cek ulang manual sebelum eksekusi._',
    ].join('\n')

    const sent = await sendTelegramAlert(text)
    if (sent) {
      // cooldown cuma di-set kalau beneran kekirim, biar yang gagal
      // (mis. token salah) tetap dicoba ulang di run berikutnya
      markAlerted(state, key)
      routeEntry.alerted = true
      alertsSent += 1
    }
  }

  await saveState(state)
  console.log(`[done] ${alertsSent} alert terkirim`)
}

// Proses long-running (bukan sekali-jalan-lalu-exit) - dipasang di pm2,
// bukan cron. Command listener (`/start` `/stop` `/status`, tombol menu)
// jalan paralel terus-terusan lewat long-polling, jadi kerasa instan. Loop
// scan di bawah jalan tiap `SCAN_INTERVAL_MINUTES` (default 15 menit), atau
// langsung kalau tombol "Scan Sekarang" di-tap (lewat wakeEmitter).
async function main() {
  const state = await loadState()

  startCommandListener(state).catch((err) => {
    console.error('[fatal] command listener berhenti:', err)
  })

  let forceNext = false
  while (true) {
    if (isEnabled(state) || forceNext) {
      forceNext = false
      try {
        await scanOnce(state)
      } catch (err) {
        console.error('[scan] error:', err)
      }
    } else {
      console.log('[bot] status: stopped, skip scan')
    }
    const wake = await waitForNextCycle(config.scanIntervalMinutes * 60 * 1000)
    if (wake?.forced) forceNext = true
  }
}

main().catch((err) => {
  console.error('[fatal]', err)
  process.exit(1)
})
