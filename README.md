# AbTrack - Aplikasi Absensi Cerdas

Ini adalah aplikasi absensi cerdas yang dibangun dengan Next.js, Firebase, dan ShadCN. Aplikasi ini memungkinkan manajemen absensi siswa secara real-time dengan notifikasi WhatsApp.

## Fitur Utama

-   **E-Absensi:** Halaman khusus untuk scan QR/barcode siswa masuk dan pulang.
-   **Manajemen Data:** CRUD (Create, Read, Update, Delete) untuk data siswa dan kelas.
-   **Laporan & Rekapitulasi:** Cetak laporan harian dan bulanan dalam format PDF.
-   **Notifikasi WhatsApp:** Mengirim notifikasi absensi real-time dan rekap bulanan ke orang tua dan grup wali kelas.
-   **Pengaturan Fleksibel:** Sesuaikan jam sekolah, hari libur, desain laporan, dan tema aplikasi.

## Pengaturan Server Notifikasi Lokal (Penting!)

Aplikasi ini menggunakan server lokal untuk mengirim notifikasi WhatsApp. Ini harus dijalankan di komputer Anda agar notifikasi berfungsi.

### Persiapan (Lakukan Sekali Saja)

1.  Pastikan Anda memiliki Node.js terinstal di komputer Anda.
2.  Unduh Ngrok dari [https://ngrok.com/download](https://ngrok.com/download). Unzip file tersebut dan letakkan file `ngrok.exe` di dalam folder `WhatsappServer-local`.
3.  Buka Command Prompt atau Terminal di dalam folder `WhatsappServer-local`.
4.  Jalankan perintah: `npm install`. Tunggu hingga prosesnya selesai.

### Alur Kerja Harian (Setiap Kali Ingin Menggunakan Notifikasi)

1.  **Jalankan Server WhatsApp:**
    *   Buka Command Prompt/Terminal di dalam folder `WhatsappServer-local`.
    *   Jalankan perintah: `node server.js`.
    *   Biarkan jendela ini berjalan. Saat pertama kali, buka browser Anda ke `http://localhost:3000` untuk memindai QR code.

2.  **Jalankan Ngrok:**
    *   Buka folder `WhatsappServer-local` di File Explorer.
    *   Klik dua kali file `start_ngrok.bat`.
    *   Biarkan jendela kedua ini berjalan.

3.  **Salin URL Ngrok:**
    *   Dari jendela Ngrok yang baru muncul, salin URL yang diberikan (contoh: `https://xxxx-xxxx.ngrok-free.app`).

4.  **Perbarui di Aplikasi Web:**
    *   Buka aplikasi web AbTrack Anda.
    *   Navigasikan ke `Pengaturan` -> `Aplikasi`.
    *   Tempel URL Ngrok yang baru ke dalam kolom **"URL Webhook Notifikasi"**.
    *   Lakukan tes pengiriman pesan untuk memastikan semuanya berfungsi.
    *   Klik **"Simpan Semua Pengaturan"**.

Kedua jendela (server WhatsApp dan Ngrok) harus tetap berjalan selama Anda ingin notifikasi berfungsi.
