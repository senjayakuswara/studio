# Server Notifikasi AbTrack - SERVER B

Server ini menggunakan pustaka Baileys untuk terhubung ke WhatsApp dan mengirimkan notifikasi absensi. Ini adalah **Server B** dari arsitektur dua server.

## Arsitektur Dua Server

Sistem ini dirancang untuk berjalan dengan dua server notifikasi (Server A dan Server B) secara bersamaan untuk meningkatkan keandalan. Keduanya memantau antrean yang sama, dan secara otomatis mendistribusikan beban kerja.

- **Server A:** Folder `WhatsappServer-local`.
- **Server B:** Folder `WhatsappServer-local-B` (folder ini).

Pastikan Anda menjalankan kedua server menggunakan nomor WhatsApp yang berbeda.

## Setup Awal

1.  Pastikan Anda memiliki Node.js terinstal.
2.  Buka terminal (CMD atau PowerShell) di dalam folder ini.
3.  Jalankan perintah `npm install` untuk mengunduh semua komponen yang diperlukan.

## Menjalankan Server B

1.  Dobel-klik file `start.bat`.
2.  Sebuah terminal akan muncul dan menampilkan QR code.
3.  Pindai QR code tersebut menggunakan HP dengan **Nomor WhatsApp Kedua Anda**.
4.  Setelah terhubung, terminal akan menampilkan pesan "WhatsApp Terhubung!". Biarkan terminal ini tetap berjalan.
