import { config } from './config.js'

// Cek honeypot/tax jual ekstrim via GoPlus Security API (gratis, no key).
// Ini lapisan TAMBAHAN di luar Stage 5 (LI.FI quote) - LI.FI ngecek apakah
// rute bridge/swap-nya kewujud (price impact, liquidity), tapi gak selalu
// simulasi logic tax/blacklist kontrak yang aneh-aneh. Token honeypot
// kadang tetep bisa dapet "quote" dari LI.FI walau di dunia nyata gak bisa
// dijual - makanya perlu dicek lagi sebelum alert beneran dikirim.
const GOPLUS_CHAIN_IDS = {
  eth: '1',
  bsc: '56',
  pol: '137',
  arb: '42161',
  opt: '10',
  base: '8453',
  ava: '43114',
  ftm: '250',
  dai: '100',
  // solana sengaja gak dimasukin - GoPlus punya endpoint beda buat non-EVM,
  // belum diintegrasiin. checkTokenSecurity return null (inconclusive).
}


// null = "gak bisa dipastikan" (chain gak didukung, atau GoPlus gak punya
// data DEX buat token ini) - PENTING: null BUKAN berarti aman, cuma berarti
// gak ada sinyal apa-apa dari sumber ini.
async function checkTokenSecurity(chainKey, address) {
  const chainId = GOPLUS_CHAIN_IDS[chainKey]
  if (!chainId) return null

  const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GoPlus ${chainKey}:${address} ${res.status}`)

  const data = await res.json()
  const info = data.result?.[address.toLowerCase()]
  // is_in_dex:0 -> GoPlus gak nemu pool buat disimulasiin, hasil tax/honeypot
  // di response defaultnya 0 tapi itu BUKAN konfirmasi aman - treat sebagai
  // inconclusive, bukan "safe".
  if (!info || info.is_in_dex === '0') return null

  const isHoneypot = info.is_honeypot === '1'
  const cannotSellAll = info.cannot_sell_all === '1'
  const sellTax = Number(info.sell_tax ?? 0) * 100 // GoPlus kasih fraction (0.15), config-nya persen
  const maxSellTax = config.maxSellTaxPercent

  // Liquiditas total DEX (USD) - kalau jauh lebih kecil dari modal simulasi
  // (TRADE_SIZE_USD), quote LI.FI-nya gak bisa dipercaya biar pun "route
  // ketemu". Trigger: token WMTX lolos Stage 5 dengan profit $357 (71%) di
  // atas kertas, padahal total liquiditas DEX-nya cuma ~$588 buat modal
  // $500 - price impact real bakal jauh lebih parah dari yang kesimulasi.
  //
  // PENTING: `info.dex` bisa `null` (bukan array kosong) buat token besar
  // kayak WETH - GoPlus gak nge-list pool detailnya buat token "base pair"
  // gitu walau liquiditasnya jelas gede. Kalau `dex` gak ada, itu inconclusive
  // (skip cek ini), BUKAN otomatis dianggap $0/gak aman - awalnya salah,
  // WETH sempet ke-flag palsu gara-gara ini.
  const hasLiquidityData = Array.isArray(info.dex) && info.dex.length > 0
  const totalLiquidityUsd = hasLiquidityData ? info.dex.reduce((sum, pool) => sum + Number(pool.liquidity ?? 0), 0) : null
  const minLiquidityUsd = config.tradeSizeUsd * config.minLiquidityMultiplier
  const liquidityTooThin = hasLiquidityData && totalLiquidityUsd < minLiquidityUsd

  const unsafe = isHoneypot || cannotSellAll || sellTax > maxSellTax || liquidityTooThin
  if (!unsafe) return { unsafe: false }

  const reasons = []
  if (isHoneypot) reasons.push('honeypot')
  if (cannotSellAll) reasons.push('gak bisa dijual semua')
  if (sellTax > maxSellTax) reasons.push(`sell tax ${sellTax.toFixed(0)}%`)
  if (liquidityTooThin) reasons.push(`liquiditas DEX cuma $${totalLiquidityUsd.toFixed(0)} (butuh minimal $${minLiquidityUsd.toFixed(0)} buat modal $${config.tradeSizeUsd})`)
  return { unsafe: true, reason: reasons.join(', ') }
}

// Cek DUA sisi (chain beli & chain jual) - token perlu aman dibeli DAN
// dijual. Kalau salah satu API call gagal (network/rate limit), fail-open
// per-sisi (skip cek itu doang, jangan sampai satu error bikin proses
// alert berhenti total).
export async function checkArbitrageSafety(cheapest, priciest) {
  const [fromCheck, toCheck] = await Promise.all([
    checkTokenSecurity(cheapest.chainKey, cheapest.address).catch((err) => {
      console.warn(`[security] gagal cek ${cheapest.platform}: ${err.message}`)
      return null
    }),
    checkTokenSecurity(priciest.chainKey, priciest.address).catch((err) => {
      console.warn(`[security] gagal cek ${priciest.platform}: ${err.message}`)
      return null
    }),
  ])

  const flagged = [fromCheck, toCheck].filter((c) => c?.unsafe)
  if (flagged.length > 0) {
    return { safe: false, reason: flagged.map((c) => c.reason).join(' & ') }
  }
  return { safe: true, reason: null }
}
