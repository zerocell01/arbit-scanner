# arbit-scanner

Bot pemantau gap harga arbitrage cross-chain, dibangun buat pemilik
akun **@Uyar121-style arbitrage workflow** (lihat catatan "Arbitrage
From Zero" seri #1-#5 + studi kasus "$80 -> $118" di repo
`zerocell01/anantanotes` buat konteks strategi manual yang jadi dasar
bot ini). Tujuannya: otomasiin bagian **screening** (nemuin gap harga),
BUKAN eksekusi otomatis.

## Kenapa dibangun begini (konteks keputusan)

- User eksplisit minta **semua free tier**, dan bot lain milik user
  selalu jalan dengan pola: **VPS sendiri + `.env` lokal + cron**,
  BUKAN platform CI/CD seperti GitHub Actions.
- **JANGAN** pakai GitHub Actions / GitHub Secrets buat project ini -
  itu sempat dicoba dan berhasil secara teknis (workflow `scan.yml`
  udah pernah jalan sukses di Actions), tapi user secara eksplisit
  minta dihapus dan diganti VPS+cron biar konsisten sama bot-bot lain
  dia. Jangan tawarin balik ke GitHub Actions kecuali user minta lagi.
- `.env` dan `state.json` **selalu** di `.gitignore` - kredensial dan
  state runtime gak pernah boleh masuk git history, baik repo private
  maupun public. Ini prinsip tetap, bukan cuma buat setup awal.
- Kalau user kasih token/secret apa pun langsung di chat (pernah
  terjadi 2x - GitHub PAT dan Telegram bot token), itu diperlakukan
  sebagai udah "terekspos" begitu masuk transcript. Baik-baik aja buat
  dipakai sekali ke tugas yang diminta, tapi selalu saranin user buat
  regenerate/revoke kalau mereka khawatir soal itu - jangan diem aja.

## Arsitektur (funnel 4 tahap)

1. **Stage 1** (`src/coingecko.js: fetchVolatileCandidates`) - 1-2 call
   ke CoinGecko `/coins/markets`, nyaring token yang lagi volatile
   (default: |perubahan 24h| >= 15%).
2. **Stage 2** (`src/coingecko.js: fetchPlatforms`) - 1 call per
   kandidat, cek token itu ada di berapa chain. Auto-retry pakai
   backoff kalau kena 429 (free tier CoinGecko gampang limit kalau
   IP-nya shared - ini pernah kejadian di test run pertama).
3. **Stage 3** (`src/lifi.js: fetchChainPriceUsd`) - harga per-chain
   dari LI.FI `/v1/token` (gratis, no key), bukan cuma harga agregat
   CoinGecko. Chain yang gak dikenal LI.FI (`CHAIN_MAP` di
   `src/config.js`) otomatis di-skip, gak dianggap error.
4. **Stage 4** (`src/telegram.js`) - kirim alert ke Telegram kalau gap
   di atas threshold DAN belum kena cooldown (`src/state.js`).

**Kontrol on/off** (`src/commands.js`, ditambah 2026-08-03): tiap run,
SEBELUM Stage 1, `pollCommands()` short-poll `getUpdates` Telegram buat
cek command `/start` `/stop` `/status` yang masuk sejak run terakhir
(offset disimpen di `state.telegramUpdateOffset`). `/stop` set
`state.enabled = false` - run berikutnya skip semua stage (gak ada API
call CoinGecko/LI.FI sama sekali). Command dari chat ID selain
`TELEGRAM_CHAT_ID` di `.env` diabaikan. Ini BUKAN listener realtime -
karena bot jalan per-cron, command baru efeknya baru kebaca di run
cron berikutnya (default 15 menit), bukan instan. Kalau user minta
respons instan ke /stop, itu butuh ubah arsitektur ke long-polling
proses yang jalan terus (pm2), bukan cron - jangan diam-diam diubah,
tanya dulu karena itu keluar dari prinsip "cron, bukan streaming"
di atas.

**Bug yang udah pernah kefix, jangan diulang:** `sendTelegramAlert()`
harus return boolean sukses/gagal, dan `index.js` cuma boleh
`markAlerted()` (set cooldown) kalau kirimnya BENERAN sukses. Awalnya
ini salah - alert yang gagal kirim (mis. token salah) tetap kena
cooldown, jadi gak pernah nyoba lagi.

**Bug lain yang udah kefix (2026-08-03, deploy pertama di VPS):**
`config.js` baca `process.env` langsung tapi gak ada apa pun yang
nge-load file `.env` ke situ (gak ada `dotenv`, gak ada flag). Efeknya
token/chat ID di `.env` diisi tapi tetap dianggap kosong ("belum
diconfig"). Fix: pakai flag native Node 24 `--env-file=.env` di
`package.json` (`npm start`) DAN di command cron - jangan jalanin
`node src/index.js` polos lagi, harus
`node --env-file=.env src/index.js`.

## Status deploy

- [x] Kode & funnel logic - selesai, udah dites (mock test lokal +
      live run sukses di GitHub Actions sebelum dipindah ke VPS).
- [x] Bot Telegram connected - chat ID user udah dikonfirmasi jalan.
- [x] **Deploy ke VPS (79.143.181.30) selesai 2026-08-03.** Repo di
      `/root/arbit-scanner`, `.env` udah keisi, test run manual sukses
      (nemu gap 3.66% token UB, alert kekirim ke Telegram). Cron
      `*/15 menit` udah dipasang (lihat crontab -l).
- [ ] Threshold (`GAINER_LOSER_THRESHOLD`, `MIN_GAP_PERCENT`, dst)
      masih default - user belum request perubahan spesifik.

## Batasan yang perlu diinget

- Sandbox/session non-VPS (kayak sesi awal yang bikin project ini)
  sering diblokir egress ke `api.coingecko.com` / `api.telegram.org`
  oleh network policy environment-nya - itu bukan bug kode, cuma gak
  bisa dites live dari situ. Tes beneran cuma valid dari VPS/mesin
  yang internetnya kebuka.
- Ini alat **screening**, bukan eksekusi. Selalu ingetin user buat cek
  manual likuiditas & jalur bridge sebelum eksekusi beneran - jangan
  develop fitur auto-execute kecuali diminta eksplisit (ada
  pertimbangan custody/keamanan hot wallet yang belum dibahas).
