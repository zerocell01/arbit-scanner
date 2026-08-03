# arbit-scanner

Bot pemantau gap harga arbitrage cross-chain, dibangun berdasarkan
workflow manual di seri **"Arbitrage From Zero" #1-#5 + studi kasus
"$80 -> $118"** oleh **@Uyar121** (bukan cuma "style" - itu sumber
konkret, ada di repo `zerocell01/anantanotes`, `src/pages/ArbitrageUyar121*.jsx`
+ `ArbitrageUyar121Breakdown.jsx`. Sempet ke-skip pas riset awal karena
clone lokal di VPS ketinggalan 10+ commit dari GitHub - kalau butuh baca
lagi, **`git pull` dulu**, jangan asumsi clone lokal up to date). Isi
seri itu: #1 dasar LayerZero/Stargate + DVN safety, #2 workflow
screening (CoinGecko top gainer/loser -> ini yang jadi cetak biru Stage
1-2 bot ini), #3 Wormhole (Portal Bridge, Token Verifier/Attestation,
Governor/Value Limit Bridge), #4 Chainlink CCIP (+ studi kasus token
FLUID - gap "ATM harian" yang JALURNYA CUMA LEWAT CCIP), #5 cara reverse-
engineer bridge apa yang dipakai suatu token dari on-chain data. Tujuan
bot: otomasiin bagian **screening** (nemuin gap harga), BUKAN eksekusi
otomatis.

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

## Arsitektur (funnel 6 tahap)

1. **Stage 1** (`src/coingecko.js: fetchVolatileCandidates`) - 1-2 call
   ke CoinGecko `/coins/markets`, nyaring token yang lagi volatile
   (default: |perubahan 24h| >= 15%).
2. **Stage 2** (`src/coingecko.js: fetchPlatforms`) - 1 call per
   kandidat, cek token itu ada di berapa chain. Auto-retry pakai
   backoff kalau kena 429 (free tier CoinGecko gampang limit kalau
   IP-nya shared - ini pernah kejadian di test run pertama).
3. **Stage 3** (`src/lifi.js: fetchTokenInfo`) - harga + decimals
   per-chain dari LI.FI `/v1/token` (gratis, no key), bukan cuma harga
   agregat CoinGecko. Chain yang gak dikenal LI.FI (`CHAIN_MAP` di
   `src/config.js`) otomatis di-skip, gak dianggap error. `decimals`
   dari response ini dipakai lagi di Stage 5 (gak perlu fetch ulang).
4. **Stage 4** - cooldown check (`src/state.js`), skip kalau pair ini
   udah pernah kealert dalam `ALERT_COOLDOWN_HOURS` terakhir.
5. **Stage 5** (`src/profit.js: estimateArbitrage`, ditambah
   2026-08-03) - quote bridge SUNGGUHAN lewat LI.FI `/v1/quote` (bukan
   `/v1/token` lagi) buat modal `TRADE_SIZE_USD` (default $500), dari
   chain termurah ke chain termahal. Ini ngasih dua hal: (a) nama
   bridge/tool yang dipakai (`toolDetails.name`) buat ditampilin
   sebagai "jalur arbit", dan (b) profit bersih setelah
   `feeCosts`+`gasCosts` (`netProfitUsd`/`netProfitPercent`). Kalau LI.FI
   404 (gak ada rute yang lolos price-impact/liquidity threshold-nya),
   `routeFound: false` - alert DI-SKIP TOTAL, bukan dikirim dengan
   warning. Ini penting: waktu deploy pertama, token UB (gap 3.66%
   secara harga) ternyata gak punya rute bridge yang lolos sama sekali
   (price impact 24%+, liquiditas kepompong) - berarti alert versi lama
   (sebelum Stage 5 ada) itu **false positive**. Kalau `netProfitPercent`
   di bawah `MIN_NET_PROFIT_PERCENT` (default 0%), alert juga di-skip -
   fee bridge kadang makan abis gap-nya buat token yang chain-nya jauh.

   **Fallback CCIP** (`src/ccip.js: checkCcipRoute`, ditambah 2026-08-04):
   dicek langsung ke LI.FI `/v1/tools` - dari 35 bridge yang di-aggregate,
   **Chainlink CCIP gak ada SAMA SEKALI**. Artinya token yang jalur
   satu-satunya lewat CCIP bakal SELALU `routeFound:false` di Stage 5,
   walau peluangnya beneran ada (persis studi kasus token FLUID di seri
   Uyar121 #4 - gap "ATM harian" yang cuma bisa dieksekusi lewat
   Transporter/CCIP). Fix: kalau LI.FI 404, cek lagi ke [Chainlink CCIP
   Directory API](https://docs.chain.link/api/ccip/v1/tokens) (gratis,
   query by `token_id` = symbol UPPERCASE, BUKAN contract address kayak
   LI.FI) - kalau ada lane terdaftar antar kedua chain, kirim info
   TERPISAH (`routeEntry.ccipFallback = true`, cek `commands.js:
   formatRouteEntry()`) TANPA angka profit, karena directory ini cuma
   nunjukin lane-nya ADA, gak ngasih data fee/price-impact kayak LI.FI
   `/quote`. Chain ID CCIP beda numbering-nya per non-EVM chain (Solana
   direpresentasiin string base58, bukan numerik) - `CCIP_CHAIN_IDS` di
   `src/ccip.js` sengaja cuma cover chain EVM di `CHAIN_MAP`, Solana
   di-skip (return false, bukan error).
6. **Stage 6** (`src/security.js: checkArbitrageSafety`, ditambah
   2026-08-04) - cek honeypot/tax jual ekstrim via GoPlus Security API
   (gratis, no key) di KEDUA chain (beli & jual), CUMA buat kandidat yang
   udah lolos Stage 5 (rute+profit oke di atas kertas) - taruh di sini,
   bukan lebih awal, biar hemat API call (jarang ada kandidat yang sampe
   sejauh ini). Alasan kenapa perlu, terpisah dari Stage 5: LI.FI ngecek
   KELAYAKAN RUTE (price impact, liquidity), bukan simulasi logic
   tax/blacklist kontrak - token honeypot kadang tetep dapet quote valid
   dari LI.FI. Trigger: user share screenshot token UB (yang emang selalu
   `routeFound:false` di Stage 5) yang ditandai "Unsafe" honeypot 99.55%
   tax sama scanner lain. **PENTING - null dari GoPlus itu inconclusive,
   BUKAN aman**: pas dicoba manual buat UB, GoPlus (`is_in_dex:'0'`) dan
   honeypot.is (404 "pair not found") SAMA-SAMA gak punya data DEX buat
   token itu di Ethereum - kontradiksi sama screenshot user (kemungkinan
   screenshot itu baca pool yang lebih baru/kecil yang belum keindeks).
   `checkTokenSecurity()` di `src/security.js` sengaja return `null`
   (bukan `{unsafe:false}`) kalau `is_in_dex==='0'` - JANGAN diubah jadi
   default aman, itu bakal kasih false sense of security. Threshold sell
   tax (`config.maxSellTaxPercent`, default 15%) - di atas ini dianggap
   gak wajar buat token normal (token legit kadang emang ada tax kecil
   buat burn/reflection, jangan set ke 0%). User juga tanya soal nambah
   aggregator kedua (Rango/Socket) buat cross-check LI.FI "no route" -
   DITOLAK, karena LI.FI kebukti (liat `filteredOut` reasons di respons
   quote-nya) udah nyoba banyak bridge underlying sekaligus (stargateV2,
   across, cbridge, mayan, glacis, relaydepository) - "no route" dari
   LI.FI udah representasi luas, bukan cuma satu jalur.

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

**Menu tombol permanen (ditambah 2026-08-03, revisi hari yang sama):**
user nunjukin contoh bot lain (liat `/root/charon/src/telegram/menus.js`
di VPS) yang pakai keyboard bawah persisten, bukan tombol yang nempel di
satu pesan doang. Percobaan pertama pakai `reply_markup.inline_keyboard`
(tombol nempel per-pesan, perlu `answerCallbackQuery`) - DIGANTI total ke
`reply_markup.keyboard` (`resize_keyboard: true`) di `menuKeyboard()`
(`commands.js`), yang begitu dikirim SEKALI (pas `startCommandListener()`
start) langsung nempel permanen di bawah kotak chat app Telegram user,
gak perlu di-resend tiap balesan. Konsekuensinya: tap tombol reply-keyboard
masuk sebagai `update.message` biasa (teks-nya = label tombol persis,
termasuk emoji-nya) - BUKAN `update.callback_query` kayak inline keyboard,
jadi gak butuh `answerCallbackQuery` sama sekali. `handleText()` di
`commands.js` nangani command teks (`/start`) dan tap tombol
(`'▶️ Start'`) lewat `switch` yang sama.

4 tombolnya: **📡 Scan Sekarang** (trigger scan di luar jadwal, lewat
`wakeEmitter` di `src/wake.js` - `EventEmitter` yang di-share ke
`index.js` buat interupsi `waitForNextCycle()`; scan tetep jalan sekali
walau status lagi stopped, pakai flag `forceNext` di loop `main()`),
**🔀 Jalur Terakhir** (baca `state.lastRoutes`, array), **⏸/▶️
Stop/Start**, **📊 Status**. Command `/menu` tetep ada buat manggil ulang
keyboard-nya kalau user pernah nge-remove secara manual dari app-nya.

**`state.lastRoutes` - kapan & gimana diisi (revisi 2x di 2026-08-04):**

1. Awalnya cuma diisi kalau Stage 5 NEMU rute bridge (`routeFound:
   true`). User komplain "ub dan btw kok gk muncul" di Jalur Terakhir -
   padahal dua-duanya rutin lolos gap filter (kelihatan di log).
   Penyebabnya: UB/BTW SELALU `routeFound: false` (liquiditas
   cross-chain-nya tipis di LI.FI, gap-nya emang gak beneran bisa
   dieksekusi - konfirmasi lagi temuan Stage 5 sebelumnya, BUKAN bug),
   jadi gak pernah ke-record sama sekali. Fix: diisi begitu kandidat
   lolos gap filter (`gapPercent >= config.minGapPercent`), APAPUN hasil
   Stage 5-nya - field `routeFound` (boolean) nentuin `commands.js:
   formatRouteEntry()` nampilin jalur+profit (kalau true) atau pesan
   "gak ada rute, liquiditas tipis" (kalau false). Konsekuensi: Stage 5
   (`estimateArbitrage`, 1 call LI.FI `/quote`) sekarang jalan WALAU
   kandidatnya lagi cooldown - order di `scanOnce()`: gap filter ->
   Stage 5 -> record ke `lastRoutes` -> (baru) cooldown/profit-threshold
   check buat mutusin kirim alert atau kagak. Trade-off sengaja diambil
   biar tombol selalu ke-update, bukan oversight.
2. Field sempet singular (`state.lastRoute`, 1 objek doang, ke-overwrite
   abis tiap siklus). User tanya lagi "yg ub gimana" pas ternyata
   ke-overwrite sama token laen (BICO) - wajar karena `COINGECKO_PAGES`
   udah dinaikin jadi lebih banyak kandidat lolos gap filter per siklus.
   Fix: diganti jadi `state.lastRoutes` (array, `unshift` + `slice(0,
   MAX_ROUTE_HISTORY)` di `index.js`, `MAX_ROUTE_HISTORY = 5`). Kalau
   nemu state.json lama yang masih punya key `lastRoute` (singular),
   itu peninggalan format lama - gak dipakai lagi, aman diabaikan/dihapus
   manual, gak ada migrasi otomatis.

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

**Bug lain yang udah kefix (2026-08-03, pas nambah Stage 5):**
`fromAmount` buat LI.FI `/v1/quote` awalnya dihitung
`Math.floor((usd / price) * 10 ** decimals)` - buat token 18-decimal,
hasilnya gampang lewat `1e21` dan `String()`-nya jadi notasi
eksponensial (`"2.789e+21"`), yang ditolak LI.FI (400 Bad Request,
bukan 404 "no route"). Fix: `toSmallestUnitString()` di
`src/profit.js` - manipulasi string desimal + `BigInt`, JANGAN balik
ke perkalian float lurus buat ngitung raw token amount.

**Bug lain yang udah kefix (2026-08-04, abis `COINGECKO_PAGES` dinaikin
ke 4):** `fetchVolatileCandidates()` (Stage 1, `src/coingecko.js`) gak
punya retry-on-429 - beda sama `fetchPlatforms()` (Stage 2) yang emang
udah ada dari awal. Pas `COINGECKO_PAGES` masih 1 gak kerasa masalahnya
(cuma 1 call), tapi begitu naik ke 4 (call beruntun ke `/coins/markets`),
429 dari CoinGecko bikin `fetchVolatileCandidates` throw dan
NGEGAGALIN SATU SIKLUS SCAN PENUH (ke-catch di `main()` sebagai
`[scan] error`, skip ke siklus berikutnya - bukan crash proses). Fix:
`fetchMarketsPage()` sekarang retry-on-429 sama persis kayak
`fetchPlatforms`, plus jeda 1 detik antar-halaman. Pelajaran: kalau nambah
lagi pemanggilan API beruntun ke endpoint yang sama (naikin
`COINGECKO_PAGES` lebih lanjut, atau nambah paginasi di tempat lain),
CEK DULU ada retry logic-nya - jangan asumsi default fetch tanpa retry
itu aman di free tier.

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
- [x] **Stage 5 (jalur bridge + profit bersih) ditambah 2026-08-03**,
      dites live pakai pasangan liquid (WETH eth<->arb, route ketemu,
      profit dihitung benar) dan pasangan thin-liquidity (UB eth<->bsc,
      `routeFound:false` sesuai ekspektasi).
- [x] **`COINGECKO_PAGES` dinaikin 1 -> 4 di `.env` VPS (2026-08-04)**,
      threshold lain (`GAINER_LOSER_THRESHOLD=15`, `MIN_GAP_PERCENT=3`,
      dst) TETAP default - user eksplisit minta cuma perlebar jangkauan,
      bukan turunin threshold. Ini fix buat masalah nyata: 26 siklus
      pertama pasca-deploy CUMA PERNAH nemu 2 token (UB, BTW) berulang -
      karena `COINGECKO_PAGES=1` cuma nyisir top-250 market-cap CoinGecko,
      dan token segede itu biasanya udah "diarbitrase" bot lain sampai
      gap-nya nyaris nutup sendiri (BTW misalnya gap-nya cuma ~0.96%, di
      bawah `MIN_GAP_PERCENT`). Abis dinaikin ke 4 (scan top-1000), siklus
      berikutnya langsung nemu 26 kandidat (naik dari 6) - lihat log pm2
      buat konfirmasi tren lanjutannya. **Perubahan ini cuma di `.env`
      VPS, BUKAN di `.env.example`/git** - kalau ada yang clone ulang
      repo ini, defaultnya balik ke `COINGECKO_PAGES=1`.
- [ ] Threshold lain (`GAINER_LOSER_THRESHOLD`, `MIN_GAP_PERCENT`,
      `TRADE_SIZE_USD`, `MIN_NET_PROFIT_PERCENT`, dst) masih default -
      user belum request perubahan spesifik buat ini.

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
