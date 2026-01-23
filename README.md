# AbTrack - Aplikasi Absensi Cerdas

Ini adalah aplikasi web lengkap untuk manajemen absensi siswa, dibangun dengan Next.js, Firebase, dan ShadCN UI.

## Fitur Utama

-   **Dashboard Real-time:** Pantau statistik kehadiran harian dan mingguan.
-   **E-Absensi dengan QR Code:** Siswa dapat melakukan absensi masuk dan pulang dengan memindai QR code unik mereka.
-   **Manajemen Data Terpusat:** Kelola data siswa, kelas, jam sekolah, dan hari libur dari satu tempat.
-   **Sistem Notifikasi WhatsApp:** Kirim notifikasi absensi ke orang tua secara *real-time* atau terjadwal.
-   **Laporan Komprehensif:** Cetak laporan absensi harian, rekapitulasi bulanan, hingga surat peringatan secara otomatis.

## Arsitektur Notifikasi WhatsApp

Sistem ini menggunakan server notifikasi lokal yang berjalan di komputer Anda untuk mengirim pesan WhatsApp.

-   **Basis:** Menggunakan pustaka `whatsapp-web.js` untuk mengotomatiskan WhatsApp Web.
-   **Integrasi Firestore:** Aplikasi web tidak langsung mengirim pesan. Ia membuat "tugas notifikasi" di database Firestore. Server lokal akan mengambil tugas ini dari database, mengirim pesannya, lalu memperbarui statusnya.
-   **Keandalan:** Arsitektur ini memastikan tidak ada notifikasi yang hilang, bahkan jika server lokal sedang tidak aktif.

Untuk menjalankan server notifikasi, lihat panduan di dalam folder `WhatsappServer-local/README.md`.
