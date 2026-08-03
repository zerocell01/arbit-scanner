import { config } from './config.js'

const BASE = 'https://api.coingecko.com/api/v3'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Satu halaman /coins/markets, sama retry-on-429 kayak fetchPlatforms -
// makin kepake pas COINGECKO_PAGES > 1 (beberapa call beruntun ke endpoint
// yang sama gampang numpuk kena limit di free tier).
async function fetchMarketsPage(page, attempt = 1) {
  const url = new URL(`${BASE}/coins/markets`)
  url.searchParams.set('vs_currency', 'usd')
  url.searchParams.set('order', 'market_cap_desc')
  url.searchParams.set('per_page', '250')
  url.searchParams.set('page', String(page))
  url.searchParams.set('price_change_percentage', '24h')

  const res = await fetch(url)

  if (res.status === 429) {
    if (attempt >= 3) throw new Error('RATE_LIMITED')
    const retryAfter = Number(res.headers.get('retry-after')) || attempt * 15
    console.warn(`[stage1] rate limited (page ${page}), nunggu ${retryAfter}s (percobaan ${attempt})`)
    await sleep(retryAfter * 1000)
    return fetchMarketsPage(page, attempt + 1)
  }
  if (!res.ok) throw new Error(`CoinGecko markets ${res.status}: ${await res.text()}`)

  return res.json()
}

// Stage 1: satu (atau beberapa) call ini nutupin SEMUA token sekaligus -
// bagian paling murah dari funnel-nya.
export async function fetchVolatileCandidates() {
  const candidates = []

  for (let page = 1; page <= config.coingeckoPages; page++) {
    if (page > 1) await sleep(1000) // jeda dikit antar-halaman, hindarin burst

    const rows = await fetchMarketsPage(page)

    for (const row of rows) {
      const change = row.price_change_percentage_24h
      if (typeof change === 'number' && Math.abs(change) >= config.gainerLoserThreshold) {
        candidates.push({ id: row.id, symbol: row.symbol, change24h: change })
      }
    }
  }

  return candidates
}

// Stage 2: 1 call per kandidat yang lolos Stage 1 - cek token itu ada di
// berapa chain (platform). Cuma yang muncul di 2+ chain yang lanjut.
// Retry otomatis kalau kena 429, biar gak asal skip kandidat gara-gara
// numpuk request ke free tier.
export async function fetchPlatforms(coinId, attempt = 1) {
  const url = `${BASE}/coins/${coinId}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`
  const res = await fetch(url)

  if (res.status === 429) {
    if (attempt >= 3) throw new Error('RATE_LIMITED')
    const retryAfter = Number(res.headers.get('retry-after')) || attempt * 15
    console.warn(`[stage2] rate limited, nunggu ${retryAfter}s (percobaan ${attempt})`)
    await sleep(retryAfter * 1000)
    return fetchPlatforms(coinId, attempt + 1)
  }
  if (!res.ok) {
    throw new Error(`CoinGecko coin ${coinId} ${res.status}`)
  }

  const data = await res.json()
  const platforms = data.platforms ?? {}

  // buang entry kosong ("" biasanya buat native chain-nya sendiri)
  return Object.fromEntries(Object.entries(platforms).filter(([, addr]) => addr))
}
