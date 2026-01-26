# AbTrack - Server Notifikasi WhatsApp (v5.0 - Arsitektur Express.js)

Ini adalah panduan untuk menjalankan server notifikasi WhatsApp yang telah dirombak total untuk keandalan maksimum, dengan integrasi Express.js, Socket.IO, dan logging ke Google Sheets.

## Konsep Arsitektur Baru

Server ini sekarang bukan lagi skrip sederhana, melainkan aplikasi Node.js yang lebih tangguh:
1.  **Basis Express.js & Socket.IO:** Server berjalan di atas Express.js dan membuka koneksi Socket.IO. Ini memungkinkan pemantauan status *real-time* dari aplikasi web di masa depan (misalnya, melihat apakah WA terhubung langsung dari dasbor).
2.  **Antrean Firestore Fail-Safe:** Aplikasi web tetap hanya menulis "tugas" ke koleksi `notification_queue`. Server lokal akan mengambilnya satu per satu, dengan mekanisme anti-macet dan pemulihan otomatis jika terjadi *timeout*.
3.  **Logging ke Google Sheets (Opsional):** Setiap notifikasi yang **berhasil** terkirim dapat secara otomatis dicatat dalam baris baru di Google Sheet, memberikan jejak audit yang kuat. Jika Anda tidak melakukan setup ini, server akan tetap berjalan normal.
4.  **Keandalan Maksimum:** Dengan "pemanasan" chat dan timeout pengiriman, error `markedUnread` dan server "terdiam" telah diatasi secara fundamental.

## Setup Awal (Hanya Dilakukan Sekali)

1.  **Instalasi Dependensi:**
    *   Buka Terminal (CMD/PowerShell).
    *   Navigasi ke folder `WhatsappServer-local` (`cd path/to/WhatsappServer-local`).
    *   Jalankan: `npm install`.

2.  **Siapkan Kredensial Firebase:**
    *   Pastikan file `credentials.json` dari Firebase Console Anda sudah ada di dalam folder ini.

3.  **Siapkan Kredensial Google Sheets (OPSIONAL untuk Logging):**
    *   **Anda bisa melewati langkah ini jika tidak memerlukan log di Google Sheets. Server akan berfungsi normal.**
    *   Buka Google Cloud Console.
    *   Pastikan Anda berada di proyek yang sama dengan Firebase Anda.
    *   Navigasi ke **APIs & Services > Library**. Cari dan **aktifkan "Google Sheets API"**.
    *   Navigasi ke **APIs & Services > Credentials**.
    *   Klik **Create Credentials > Service Account**.
    *   Beri nama (misal: "whatsapp-sheets-logger"), klik **Create and Continue**, lalu **Done**.
    *   Temukan service account yang baru dibuat, klik ikon pensil (Edit).
    *   Pergi ke tab **Keys > Add Key > Create new key**. Pilih **JSON** dan klik **Create**.
    *   Sebuah file JSON akan terunduh. **Ganti namanya menjadi `sheets-credentials.json`** dan letakkan di dalam folder `WhatsappServer-local` ini.
    *   Buka Google Sheet yang ingin Anda gunakan untuk log. Klik **Share**, dan bagikan akses "Editor" ke alamat email service account yang baru Anda buat (terlihat di detail service account).

4.  **Konfigurasi Spreadsheet (Hanya jika menggunakan Google Sheets):**
    *   Buka file `config.json`.
    *   Ganti `"YOUR_SPREADSHEET_ID_HERE"` dengan ID spreadsheet Anda (dari URL Google Sheet).

## Alur Kerja Harian

1.  Buka Terminal & masuk ke folder `WhatsappServer-local`.
2.  Jalankan server: `node server.js`
3.  **Pindai QR Code:** Saat pertama kali, pindai QR code yang muncul menggunakan WhatsApp di HP Anda.
4.  Biarkan terminal tetap berjalan. Terminal akan menampilkan log pengiriman secara *real-time*.

## Pemecahan Masalah (WAJIB DIBACA JIKA NOTIFIKASI GAGAL)

### Error Paling Umum: `Gagal mengirim pesan... markedUnread` atau Server Macet

Ini hampir selalu berarti **sesi login Anda di server telah rusak (corrupt)**. Solusinya adalah **mereset sesi login secara manual**.

**Solusi Cepat dan Paling Andal:**

1.  **Hentikan Server:** Tutup jendela terminal.
2.  **Hapus Folder Sesi:** Di dalam folder `WhatsappServer-local`, cari dan **HAPUS** seluruh folder yang bernama `.wwebjs_auth`. Ini 100% aman.
3.  **Jalankan Ulang Server:** Buka kembali terminal dan jalankan `node server.js`.
4.  **Pindai Ulang QR Code:** Anda akan diminta untuk memindai QR code baru.

Lakukan langkah ini setiap kali Anda menghadapi masalah pengiriman yang tidak bisa dijelaskan.
