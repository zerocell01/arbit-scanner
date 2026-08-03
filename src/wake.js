import { EventEmitter } from 'node:events'

// Dipakai buat interrupt sleep antar-siklus scan (mis. tombol "Scan
// Sekarang" di Telegram) tanpa perlu restart proses atau nunggu interval
// abis. Satu emitter di-share antara index.js (loop scan) dan
// commands.js (listener Telegram).
export const wakeEmitter = new EventEmitter()
