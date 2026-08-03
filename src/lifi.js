// Stage 3: harga token per-chain langsung dari sumber DEX (via LI.FI),
// bukan cuma harga agregat CoinGecko - biar gap-nya lebih valid.
const BASE = 'https://li.quest/v1'

export async function fetchChainPriceUsd(chainKey, tokenAddress) {
  const url = new URL(`${BASE}/token`)
  url.searchParams.set('chain', chainKey)
  url.searchParams.set('token', tokenAddress)

  const res = await fetch(url)
  if (!res.ok) {
    if (res.status === 404) return null // token gak dikenal LI.FI di chain ini
    throw new Error(`LI.FI token ${chainKey}:${tokenAddress} ${res.status}`)
  }
  const data = await res.json()
  const price = Number(data.priceUSD)
  return Number.isFinite(price) && price > 0 ? price : null
}
