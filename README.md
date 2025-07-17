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
2.  Buka Command Prompt atau Terminal.
3.  Masuk ke direktori server: `cd WhatsappServer-local`
4.  Install dependencies: `npm install`

### Alur Kerja Harian

1.  **Jalankan Server WhatsApp:** Buka direktori `WhatsappServer-local` dan jalankan file `start_server.bat` (atau `node server.js` di terminal).
    -   *Saat pertama kali menjalankan, Anda perlu memindai QR code yang muncul dengan aplikasi WhatsApp di ponsel Anda.*
2.  **Jalankan Ngrok:** Jalankan file `start_ngrok.bat` untuk membuat "jembatan" dari internet ke server lokal Anda.
3.  **Salin URL Ngrok:** Salin URL yang diberikan oleh Ngrok (contoh: `https://xxxx-xxxx.ngrok-free.app`).
4.  **Perbarui di Aplikasi:**
    -   Buka aplikasi web Anda.
    -   Navigasikan ke `Pengaturan` -> `Aplikasi`.
    -   Tempel URL Ngrok yang baru ke dalam kolom **"URL Webhook Notifikasi"**.
    -   Lakukan tes pengiriman pesan untuk memastikan semuanya berfungsi.
    -   Klik **"Simpan Semua Pengaturan"**.

Server lokal dan Ngrok harus tetap berjalan selama Anda ingin notifikasi berfungsi.
