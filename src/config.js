export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
  gainerLoserThreshold: Number(process.env.GAINER_LOSER_THRESHOLD ?? 15),
  minGapPercent: Number(process.env.MIN_GAP_PERCENT ?? 3),
  coingeckoPages: Number(process.env.COINGECKO_PAGES ?? 1),
  alertCooldownHours: Number(process.env.ALERT_COOLDOWN_HOURS ?? 6),
  scanIntervalMinutes: Number(process.env.SCAN_INTERVAL_MINUTES ?? 15),
  // Stage 5: modal notional (USD) buat simulasi bridge & hitung profit bersih
  tradeSizeUsd: Number(process.env.TRADE_SIZE_USD ?? 500),
  // skip alert kalau profit bersih (setelah fee+gas bridge) di bawah ini
  minNetProfitPercent: Number(process.env.MIN_NET_PROFIT_PERCENT ?? 0),
  // Stage keamanan: sell tax di atas ini (dari GoPlus) dianggap gak wajar
  // buat token normal - kemungkinan honeypot/scam, skip alert
  maxSellTaxPercent: Number(process.env.MAX_SELL_TAX_PERCENT ?? 15),
}

// Mapping CoinGecko "platform" id -> LI.FI chain key.
// Cuma chain yang umum & didukung LI.FI yang dimasukin - kandidat di chain
// lain (mis. Plasma, Hemi yang baru banget) otomatis di-skip di Stage 3.
export const CHAIN_MAP = {
  ethereum: 'eth',
  'binance-smart-chain': 'bsc',
  'polygon-pos': 'pol',
  'arbitrum-one': 'arb',
  'optimistic-ethereum': 'opt',
  base: 'base',
  avalanche: 'ava',
  solana: 'sol',
  fantom: 'ftm',
  'xdai': 'dai',
}
