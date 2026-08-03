// Stage 3: harga token per-chain langsung dari sumber DEX (via LI.FI),
// bukan cuma harga agregat CoinGecko - biar gap-nya lebih valid.
// Stage 5: quote bridge beneran (LI.FI /quote) buat jalur & profit riil.
const BASE = 'https://li.quest/v1'

export async function fetchTokenInfo(chainKey, tokenAddress) {
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
  if (!Number.isFinite(price) || price <= 0) return null
  return { price, decimals: data.decimals }
}

// Quote bridge sungguhan buat token yang sama dari chain A ke chain B.
// Ini simulasi rute nyata (lewat DEX+bridge yang LI.FI tau), bukan cuma
// selisih harga - jadi kalau liquiditas-nya tipis, request ini bakal
// ke-filter (404) walau harga di kedua chain keliatan beda jauh.
export async function fetchBridgeQuote({ fromChain, toChain, fromToken, toToken, fromAmount, fromAddress }) {
  const url = new URL(`${BASE}/quote`)
  url.searchParams.set('fromChain', fromChain)
  url.searchParams.set('toChain', toChain)
  url.searchParams.set('fromToken', fromToken)
  url.searchParams.set('toToken', toToken)
  url.searchParams.set('fromAddress', fromAddress)
  url.searchParams.set('toAddress', fromAddress)
  url.searchParams.set('fromAmount', fromAmount)

  const res = await fetch(url)
  if (!res.ok) {
    if (res.status === 404) return null // gak ada rute yang lolos (liquiditas/price-impact)
    throw new Error(`LI.FI quote ${fromChain}->${toChain} ${res.status}`)
  }
  return res.json()
}
