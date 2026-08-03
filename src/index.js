import { config, CHAIN_MAP } from './config.js'
import { fetchVolatileCandidates, fetchPlatforms } from './coingecko.js'
import { fetchChainPriceUsd } from './lifi.js'
import { sendTelegramAlert } from './telegram.js'
import { loadState, saveState, isOnCooldown, markAlerted } from './state.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log('[stage1] scanning gainers/losers...')
  const candidates = await fetchVolatileCandidates()
  console.log(`[stage1] ${candidates.length} kandidat volatile ditemukan`)

  const state = await loadState()
  let alertsSent = 0

  for (const candidate of candidates) {
    // jaga-jaga biar gak nabrak rate limit free tier CoinGecko
    // (runner GitHub Actions sering share IP, jadi delay-nya dilebihin)
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
      try {
        const price = await fetchChainPriceUsd(CHAIN_MAP[platform], address)
        if (price) prices.push({ platform, address, price })
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
    if (isOnCooldown(state, key)) {
      console.log(`[stage4] ${candidate.symbol} gap ada tapi masih cooldown, skip`)
      continue
    }

    const text = [
      `*Gap harga: ${candidate.symbol.toUpperCase()}*`,
      `24h change: ${candidate.change24h.toFixed(1)}%`,
      `Beli di *${cheapest.platform}*: $${cheapest.price.toPrecision(6)}`,
      `Jual di *${priciest.platform}*: $${priciest.price.toPrecision(6)}`,
      `Gap: *${gapPercent.toFixed(2)}%*`,
      '',
      `CA (${cheapest.platform}): \`${cheapest.address}\``,
      `CA (${priciest.platform}): \`${priciest.address}\``,
      '',
      '_Cek ulang likuiditas & jalur bridge manual sebelum eksekusi._',
    ].join('\n')

    const sent = await sendTelegramAlert(text)
    if (sent) {
      // cooldown cuma di-set kalau beneran kekirim, biar yang gagal
      // (mis. token salah) tetap dicoba ulang di run berikutnya
      markAlerted(state, key)
      alertsSent += 1
    }
  }

  await saveState(state)
  console.log(`[done] ${alertsSent} alert terkirim`)
}

main().catch((err) => {
  console.error('[fatal]', err)
  process.exit(1)
})
