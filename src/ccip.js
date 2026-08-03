// Fallback check pas LI.FI (Stage 5) bilang gak ada rute. Chainlink CCIP
// SENGAJA gak di-cover LI.FI - dicek langsung ke `/v1/tools`, CCIP gak ada
// sama sekali di 35 bridge yang di-aggregate LI.FI. Jadi token yang jalur
// SATU-SATUNYA lewat CCIP bakal SELALU keliatan "no route" di Stage 5,
// walau peluangnya beneran ada (lihat studi kasus token FLUID di seri
// "Arbitrage From Zero" @Uyar121 - gap ATM harian yang cuma bisa dieksekusi
// lewat Transporter/CCIP, LI.FI gak bakal pernah nemu ini).
//
// Ini CUMA cek "ada lane CCIP terdaftar atau kagak" lewat Chainlink CCIP
// Directory API (gratis, no key) - BUKAN quote/simulasi kayak LI.FI, karena
// directory ini gak kasih data fee/price-impact. Hasilnya informational
// doang - JANGAN dipakai buat ngitung/nampilin angka profit palsu.
const CCIP_CHAIN_IDS = {
  eth: 1,
  bsc: 56,
  pol: 137,
  arb: 42161,
  opt: 10,
  base: 8453,
  ava: 43114,
  ftm: 250,
  dai: 100,
  // solana sengaja gak dimasukin - CCIP directory pakai identifier non-numerik
  // buat chain non-EVM, belum diintegrasiin di sini.
}

export async function checkCcipRoute(symbol, fromChainKey, toChainKey) {
  const fromId = CCIP_CHAIN_IDS[fromChainKey]
  const toId = CCIP_CHAIN_IDS[toChainKey]
  if (!fromId || !toId) return false // chain gak ke-cover (mis. solana)

  const tokenId = symbol.toUpperCase()
  const url = `https://docs.chain.link/api/ccip/v1/tokens?environment=mainnet&token_id=${tokenId}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`CCIP directory ${tokenId} ${res.status}`)

  const data = await res.json()
  const chains = data.data?.[tokenId]
  const fromEntry = chains?.[String(fromId)]
  return fromEntry?.destinations?.includes(String(toId)) ?? false
}
