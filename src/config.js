export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
  gainerLoserThreshold: Number(process.env.GAINER_LOSER_THRESHOLD ?? 15),
  minGapPercent: Number(process.env.MIN_GAP_PERCENT ?? 3),
  coingeckoPages: Number(process.env.COINGECKO_PAGES ?? 1),
  alertCooldownHours: Number(process.env.ALERT_COOLDOWN_HOURS ?? 6),
  scanIntervalMinutes: Number(process.env.SCAN_INTERVAL_MINUTES ?? 15),
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
