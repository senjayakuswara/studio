# AbTrack - Server Notifikasi WhatsApp (Mode Firestore)

Ini adalah panduan untuk menjalankan server notifikasi WhatsApp yang terintegrasi dengan database Firestore aplikasi Anda.

## Konsep Dasar

Server ini bekerja dengan cara yang lebih cerdas dan andal:
1.  **Aplikasi Web Menambah Tugas:** Ketika notifikasi perlu dikirim (misalnya, saat siswa absen), aplikasi web Anda tidak langsung mencoba mengirim WA. Sebaliknya, ia hanya menulis "tugas" baru ke dalam koleksi `notification_queue` di database Firestore Anda dengan status `pending`.
2.  **Server Lokal Menarik Tugas:** Server lokal ini secara terus-menerus memantau koleksi `notification_queue`. Ketika ia melihat ada tugas baru dengan status `pending`, ia akan mengambilnya.
3.  **Mengirim & Melaporkan:** Server akan mencoba mengirim pesan WhatsApp. Setelah selesai, ia akan memperbarui status tugas di Firestore menjadi `success` atau `failed`.
4.  **Kontrol Penuh:** Anda bisa memantau seluruh proses ini secara *real-time* melalui menu **Pengaturan > Notifikasi** di aplikasi web Anda.

**Keuntungan:**
-   **Tidak Ada Pesan Hilang:** Jika server ini mati, tugas akan aman menunggu di database.
-   **Tidak Perlu `ngrok`:** Server ini bekerja secara mandiri tanpa memerlukan `ngrok`.
-   **Tangguh:** Jika pengiriman gagal, statusnya akan diperbarui, dan Anda bisa mencoba mengirim ulang dari aplikasi web.

## Setup Awal (Hanya Dilakukan Sekali)

Sebelum menjalankan server untuk pertama kalinya, Anda perlu mengunduh semua "bahan" atau dependensi yang dibutuhkannya.

1.  **Buka Terminal:**
    *   Buka Command Prompt, PowerShell, atau Terminal di komputer Anda.

2.  **Masuk ke Folder Server:**
    *   Gunakan perintah `cd` untuk menavigasi ke dalam folder `WhatsappServer-local` di dalam proyek Anda.
    *   Contoh: `cd C:\path\to\your\project\WhatsappServer-local`

3.  **Jalankan Instalasi:**
    *   Setelah berada di dalam folder yang benar, jalankan perintah ini:
        ```
        npm install
        ```
    *   Tunggu hingga proses selesai. Perintah ini akan membuat folder baru bernama `node_modules` di dalam `WhatsappServer-local`.

Setelah langkah ini selesai, Anda tidak perlu melakukannya lagi kecuali ada pembaruan di masa depan. Sekarang Anda siap untuk menjalankan server setiap hari.

## Alur Kerja Harian (Setelah Setup Awal)

Sangat sederhana. Anda hanya perlu melakukan ini setiap hari sekolah:

1.  **Buka Terminal & Masuk ke Folder Server:**
    *   Seperti pada langkah setup, buka terminal dan `cd` ke folder `WhatsappServer-local`.

2.  **Jalankan Server:**
    *   Jalankan perintah sederhana ini:
        ```
        node server.js
        ```

3.  **Pindai QR Code (Jika Diperlukan):**
    *   **Saat pertama kali** menjalankan, atau jika sesi Anda berakhir, sebuah QR code akan muncul di terminal.
    *   Buka aplikasi WhatsApp di HP Anda, masuk ke **Setelan > Perangkat Tertaut > Tautkan Perangkat**, lalu pindai QR code tersebut.
    *   Setelah berhasil, terminal akan menampilkan: `[FIREBASE] Berhasil terhubung...` diikuti dengan `WhatsApp Terhubung!`. Server Anda sekarang aktif dan siap bekerja.

4.  **Biarkan Tetap Berjalan:**
    *   **PENTING:** Biarkan jendela terminal ini tetap terbuka selama jam sekolah. Jangan ditutup. Anda bisa me-minimize jendela tersebut. Server ini harus tetap berjalan untuk bisa mengirimkan notifikasi.

Selesai! Server akan secara otomatis memproses semua notifikasi yang dibuat dari aplikasi web Anda. Anda bisa memantau log pengiriman langsung di jendela terminal tersebut.

## Pemecahan Masalah (WAJIB DIBACA JIKA NOTIFIKASI GAGAL)

### Error: `Gagal mengirim pesan... markedUnread` atau Error Tidak Dikenal Lainnya

Ini adalah error yang paling umum dari pustaka `whatsapp-web.js`. Ini biasanya berarti sesi login Anda di server telah **rusak (corrupt)**. Tidak ada perubahan kode yang bisa memperbaikinya, solusinya adalah **mereset sesi login**.

**Solusi Cepat dan Paling Andal (Wajib Dilakukan Sekarang):**

1.  **Hentikan Server:** Tutup jendela terminal tempat `node server.js` berjalan.
2.  **Hapus Folder Sesi:** Di dalam folder `WhatsappServer-local` Anda, cari dan **HAPUS** seluruh folder yang bernama `.wwebjs_auth`. Jangan khawatir, ini 100% aman. Folder ini akan dibuat ulang secara otomatis.
3.  **Jalankan Ulang Server:** Buka kembali terminal, masuk ke folder `WhatsappServer-local`, dan jalankan lagi `node server.js`.
4.  **Pindai Ulang QR Code:** Anda akan diminta untuk memindai QR code baru. Ini akan membuat sesi yang baru dan bersih.

Setelah langkah-langkah ini, error `markedUnread` seharusnya hilang dan notifikasi akan terkirim.
