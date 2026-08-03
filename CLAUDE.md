# arbit-scanner

Bot pemantau gap harga arbitrage cross-chain, dibangun buat pemilik
akun **@Uyar121-style arbitrage workflow** (lihat catatan "Arbitrage
From Zero" seri #1-#5 + studi kasus "$80 -> $118" di repo
`zerocell01/anantanotes` buat konteks strategi manual yang jadi dasar
bot ini). Tujuannya: otomasiin bagian **screening** (nemuin gap harga),
BUKAN eksekusi otomatis.

## Kenapa dibangun begini (konteks keputusan)

- User eksplisit minta **semua free tier**, dan bot lain milik user
  selalu jalan dengan pola: **VPS sendiri + `.env` lokal**, BUKAN
  platform CI/CD seperti GitHub Actions.
- **JANGAN** pakai GitHub Actions / GitHub Secrets buat project ini -
  itu sempat dicoba dan berhasil secara teknis (workflow `scan.yml`
  udah pernah jalan sukses di Actions), tapi user secara eksplisit
  minta dihapus dan diganti jalan di VPS sendiri biar konsisten sama
  bot-bot lain dia. Jangan tawarin balik ke GitHub Actions kecuali
  user minta lagi.
- **Penjadwalan: pm2 (long-running), BUKAN cron** (diubah 2026-08-03).
  Awalnya dipasang lewat cron `*/15 menit`, tapi user minta pindah ke
  proses yang jalan terus supaya command `/start` `/stop` Telegram
  (lihat bawah) kerasa instan, bukan nunggu jadwal cron berikutnya.
  Tetap 100% free karena masih di VPS milik user sendiri (pm2 gratis,
  cuma process manager) - bukan pindah ke hosting berbayar. Kalau
  nemu sisa crontab entry lama buat project ini pas kerja di VPS,
  itu peninggalan, boleh dihapus.
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

**Kontrol on/off** (`src/commands.js`, ditambah 2026-08-03, diubah ke
long-polling di hari yang sama): `index.js` sekarang proses long-running
- `main()` start `startCommandListener(state)` (jalan paralel, gak
di-`await`) BARENGAN sama loop `while(true) { scanOnce(); sleep(interval) }`.
`startCommandListener` long-poll `getUpdates` Telegram (`timeout=30`
detik per call) terus-terusan, jadi command `/start` `/stop` `/status`
kerasa hampir instan - BUKAN nunggu siklus scan berikutnya. Kedua loop
berbagi satu objek `state` yang sama (referensi, bukan copy), offset
`getUpdates` disimpen di `state.telegramUpdateOffset`. `/stop` set
`state.enabled = false` - siklus scan berikutnya skip semua stage (gak
ada API call CoinGecko/LI.FI). Command dari chat ID selain
`TELEGRAM_CHAT_ID` di `.env` diabaikan.

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
`package.json` (`npm start`) DAN di command pm2
(`--node-args="--env-file=.env"`) - jangan jalanin
`node src/index.js` polos lagi, harus
`node --env-file=.env src/index.js`.

## Status deploy

- [x] Kode & funnel logic - selesai, udah dites (mock test lokal +
      live run sukses di GitHub Actions sebelum dipindah ke VPS).
- [x] Bot Telegram connected - chat ID user udah dikonfirmasi jalan.
- [x] **Deploy ke VPS (79.143.181.30) selesai 2026-08-03.** Repo di
      `/root/arbit-scanner`, `.env` udah keisi, test run manual sukses
      (nemu gap 3.66% token UB, alert kekirim ke Telegram).
- [x] **Jalan permanen via pm2** (`pm2 start src/index.js --name
      arbit-scanner --interpreter node --node-args="--env-file=.env"`,
      `pm2 save` + `pm2 startup` udah dijalanin biar auto-start pas
      reboot). Bukan cron lagi - lihat "Kenapa dibangun begini" di atas.
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
