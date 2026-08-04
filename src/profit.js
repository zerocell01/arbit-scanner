import { config } from './config.js'
import { fetchBridgeQuote } from './lifi.js'

// alamat dummy cuma buat dapetin quote (LI.FI gak cek saldo buat /quote,
// jadi gak perlu wallet beneran) - beda format per tipe chain.
const EVM_DUMMY_ADDRESS = '0x000000000000000000000000000000000000dEaD'
const SOLANA_DUMMY_ADDRESS = '11111111111111111111111111111111'

function dummyAddressFor(chainKey) {
  return chainKey === 'sol' ? SOLANA_DUMMY_ADDRESS : EVM_DUMMY_ADDRESS
}

// `Math.floor(amount * 10 ** decimals)` gampang lewat dari
// Number.MAX_SAFE_INTEGER dan ke-serialize jadi notasi eksponensial
// (mis. "2.789e+21") pas di-`String()`-kan - LI.FI nolak format itu (400).
// Manipulasi string desimal + BigInt di sini biar hasilnya integer polos.
function toSmallestUnitString(amount, decimals) {
  const [whole, frac = ''] = amount.toFixed(decimals).split('.')
  return BigInt(whole + frac.padEnd(decimals, '0')).toString()
}

// Stage 5: simulasi bridge beneran buat modal sebesar TRADE_SIZE_USD, dari
// chain termurah ke chain termahal. Ini sekaligus jadi cek liquiditas real -
// kalau LI.FI gak nemu rute (price impact kegedean / liquiditas tipis),
// `routeFound` bakal false, artinya gap yang kedetect Stage 1-3 kemungkinan
// gak beneran bisa dieksekusi.
export async function estimateArbitrage(cheapest, priciest) {
  const tokensNeeded = config.tradeSizeUsd / cheapest.price
  const fromAmount = toSmallestUnitString(tokensNeeded, cheapest.decimals)

  const quote = await fetchBridgeQuote({
    fromChain: cheapest.chainKey,
    toChain: priciest.chainKey,
    fromToken: cheapest.address,
    toToken: priciest.address,
    fromAmount,
    fromAddress: dummyAddressFor(cheapest.chainKey),
  })

  if (!quote) return { routeFound: false }

  const toAmount = Number(quote.estimate.toAmount) / 10 ** quote.action.toToken.decimals
  const sellValueUsd = toAmount * priciest.price
  const netProfitUsd = sellValueUsd - config.tradeSizeUsd
  const netProfitPercent = (netProfitUsd / config.tradeSizeUsd) * 100

  const totalFeeUsd = [...(quote.estimate.feeCosts ?? []), ...(quote.estimate.gasCosts ?? [])].reduce(
    (sum, cost) => sum + Number(cost.amountUSD ?? 0),
    0,
  )

  return {
    routeFound: true,
    bridgeName: quote.toolDetails?.name ?? quote.tool,
    bridgeKey: quote.tool, // key mentah (mis. "stargateV2", "glacis") - dipakai buat lookup link resmi
    netProfitUsd,
    netProfitPercent,
    totalFeeUsd,
  }
}
