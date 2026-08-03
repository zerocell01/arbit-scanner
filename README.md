# Arbit Scanner

Bot pemantau gap harga cross-chain, dibangun buat jalan **100% di free tier**
(gak butuh RPC/websocket sendiri). Dijalankan periodik (cron), bukan
streaming - karena gap harga biasanya bertahan menit-jaman, bukan
milidetik.

## Cara kerja (funnel 4 tahap)

1. **Stage 1 - Screening murah:** 1 call ke CoinGecko `/coins/markets`
   buat nyaring token yang lagi volatile (naik/turun di atas threshold).
2. **Stage 2 - Filter multi-chain:** 1 call per kandidat ke CoinGecko
   `/coins/{id}` buat cek token itu ada di berapa chain. Yang cuma di 1
   chain langsung di-skip (gak bisa arbit).
3. **Stage 3 - Konfirmasi gap:** ambil harga per-chain dari LI.FI
   (`/v1/token`) - lebih akurat dari harga agregat CoinGecko karena
   sumbernya DEX langsung. Chain yang gak dikenal LI.FI otomatis di-skip.
4. **Stage 4 - Alert:** kalau gap di atas threshold dan belum kena
   cooldown, kirim ke Telegram.

Cuma Stage 1 yang nyentuh SEMUA token (dan itu 1-2 call doang). Stage 2-3
cuma jalan ke kandidat yang udah kefilter, jadi kuota API tetap kecil
walau scan-nya "auto" ke semua token trending.

## Setup

```bash
cp .env.example .env
# isi TELEGRAM_BOT_TOKEN (dari @BotFather di Telegram) dan TELEGRAM_CHAT_ID
npm start
```

Tanpa `.env` diisi, bot tetap jalan tapi alert cuma di-log ke console
(gak dikirim ke Telegram) - berguna buat testing.

## Kenapa gak kena limit

- **Polling, bukan WebSocket** - gak ada koneksi yang harus terus nyala,
  cocok buat hosting gratisan yang batesin koneksi persisten.
- **Gak butuh RPC blockchain sendiri** - semua data harga dari API
  CoinGecko (gratis, tanpa key) dan LI.FI (gratis, tanpa key).
- **Watchlist otomatis tapi bertingkat** - funnel di atas mastiin API
  yang "mahal" (Stage 2-3) cuma kepake buat kandidat yang beneran lolos
  filter awal, bukan semua token.
- **State lokal (`state.json`)** buat dedup alert - gak butuh database
  eksternal.

## Deploy di VPS sendiri (cron + .env lokal)

Repo ini gak nyimpen kredensial apa pun - `.env` dan `state.json`
sama-sama di-gitignore, jadi murni tinggal di server kamu, gak pernah
nyentuh GitHub sama sekali.

**Setup sekali di server:**

```bash
git clone https://github.com/zerocell01/arbit-scanner
cd arbit-scanner
cp .env.example .env
nano .env   # isi TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID
node --env-file=.env src/index.js   # tes jalan manual dulu
```

**Jadwalin pakai cron** (`crontab -e`), misal tiap 15 menit:

```cron
*/15 * * * * cd /path/ke/arbit-scanner && /usr/bin/node --env-file=.env src/index.js >> scanner.log 2>&1
```

`state.json` bakal otomatis dibikin/di-update di folder itu tiap run -
gak perlu setup database atau commit apa pun balik ke git.

**Update kode nanti:** tinggal `git pull` di server - `.env` dan
`state.json` gak kesentuh karena udah di-gitignore.

## Catatan

- Threshold default (`GAINER_LOSER_THRESHOLD=15`, `MIN_GAP_PERCENT=3`)
  ada di `.env.example` - sesuaikan sendiri.
- Chain yang didukung ada di `CHAIN_MAP` (`src/config.js`) - baru
  nge-cover chain mainstream yang dikenal LI.FI. Chain baru banget
  (Plasma, Hemi, dll) bakal ke-skip otomatis di Stage 3.
- Ini alat **screening**, bukan eksekusi otomatis - tetap wajib cek
  manual likuiditas, jalur bridge, dan risiko protokol (DVN/Attestation/
  Governor, dst - lihat catatan Arbitrage From Zero di Ananta Notes)
  sebelum eksekusi beneran.
