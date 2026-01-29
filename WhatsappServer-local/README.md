# AbTrack - Server Notifikasi WhatsApp (v5.0 - Arsitektur Express.js)

Ini adalah panduan untuk menjalankan server notifikasi WhatsApp yang telah dirombak total untuk keandalan maksimum, dengan integrasi Express.js dan Socket.IO.

## Arsitektur Server

1.  **Basis Express.js:** Server berjalan di atas Express.js dan membuka koneksi Socket.IO untuk pemantauan status *real-time*.
2.  **Antrean Fail-Safe:** Aplikasi web hanya menulis "tugas" notifikasi ke Firestore. Server ini akan mengambilnya satu per satu secara berurutan, dengan mekanisme anti-macet dan pemulihan otomatis jika terjadi *timeout*.
3.  **Logging Opsional:** Server bisa mencatat notifikasi yang terkirim ke Google Sheets jika Anda melakukan konfigurasinya. Jika tidak, server tetap berjalan normal.
4.  **Keandalan Maksimum:** Dengan logika antrean yang tangguh dan *timeout* pengiriman, masalah server "terdiam" atau "melewatkan" notifikasi telah diatasi.

## Setup Awal (Hanya Dilakukan Sekali)

1.  **Instalasi Dependensi:**
    *   Buka Terminal (CMD/PowerShell) di dalam folder `WhatsappServer-local`.
    *   Jalankan: `npm install`.

2.  **Siapkan Kredensial Firebase:**
    *   Pastikan file `credentials.json` dari Firebase Console Anda sudah ada di dalam folder ini.

3.  **Siapkan Kredensial Google Sheets (OPSIONAL):**
    *   Jika Anda tidak butuh logging ke Google Sheets, lewati langkah ini.
    *   Aktifkan "Google Sheets API" di Google Cloud Console.
    *   Buat sebuah *Service Account*, unduh kunci JSON-nya, ganti nama menjadi `sheets-credentials.json`, dan letakkan di folder ini.
    *   Bagikan akses "Editor" Google Sheet Anda ke email *service account* tersebut.
    *   Salin ID Spreadsheet Anda (dari URL) ke dalam file `config.json`.

## Cara Menjalankan Server (Harian)

Ini adalah satu-satunya hal yang perlu Anda lakukan setiap hari.

1.  Masuk ke folder `WhatsappServer-local`.
2.  Jalankan file `start.bat` dengan mengkliknya dua kali.
3.  **Pindai QR Code:** Jika diminta, pindai QR code yang muncul di terminal menggunakan WhatsApp di HP Anda.
4.  **Selesai.** Biarkan jendela terminal tetap berjalan. Server akan menangani semuanya secara otomatis.

## Pemecahan Masalah

### Masalah Paling Umum: WhatsApp Tidak Terhubung atau Pesan Gagal Terkirim

Ini hampir selalu berarti sesi login WhatsApp di server telah rusak. Solusinya adalah **menghapus sesi secara manual**.

1.  **Hentikan Server:** Tutup jendela terminal.
2.  **Hapus Folder Sesi:** Di dalam folder `WhatsappServer-local`, cari dan **HAPUS** seluruh folder yang bernama `.wwebjs_auth`. Ini 100% aman.
3.  **Jalankan Ulang Server:** Jalankan kembali `start.bat`.
4.  **Pindai Ulang QR Code:** Anda akan diminta untuk memindai QR code yang baru.

Lakukan langkah ini setiap kali Anda menghadapi masalah koneksi atau pengiriman yang tidak bisa dijelaskan. Ini akan menyelesaikan 99% masalah.
