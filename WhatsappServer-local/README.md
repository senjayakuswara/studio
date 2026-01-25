# AbTrack - Server Notifikasi WhatsApp (Mode Firestore)

Ini adalah panduan untuk menjalankan server notifikasi WhatsApp yang terintegrasi dengan database Firestore aplikasi Anda.

## Konsep Dasar

Server ini bekerja dengan cara yang lebih cerdas dan andal:
1.  **Aplikasi Web Menambah Tugas:** Ketika notifikasi perlu dikirim (misalnya, saat siswa absen), aplikasi web Anda tidak langsung mencoba mengirim WA. Sebaliknya, ia hanya menulis "tugas" baru ke dalam koleksi `notification_queue` di database Firestore Anda dengan status `pending`.
2.  **Server Lokal Menarik Tugas:** Server lokal ini secara terus-menerus memantau koleksi `notification_queue`. Ketika ia melihat ada tugas baru, ia akan mengambilnya.
3.  **Mengirim & Melaporkan:** Server akan mencoba mengirim pesan WhatsApp. Setelah selesai, ia akan memperbarui status tugas di Firestore menjadi `success` atau `failed`.
4.  **Kontrol Penuh:** Anda bisa memantau seluruh proses ini secara *real-time* melalui menu **Pengaturan > Notifikasi** di aplikasi web Anda.

**Keuntungan:**
-   **Tidak Ada Pesan Hilang:** Jika server ini mati, tugas akan aman menunggu di database.
-   **Tangguh:** Server dirancang untuk tidak macet. Jika pengiriman gagal, statusnya akan diperbarui, dan Anda bisa mencoba mengirim ulang dari aplikasi web.
-   **Tidak Perlu `ngrok`:** Server ini bekerja secara mandiri.

## Setup Awal (Hanya Dilakukan Sekali)

1.  **Buka Terminal:** Buka Command Prompt, PowerShell, atau Terminal.
2.  **Masuk ke Folder Server:** Gunakan perintah `cd` untuk menavigasi ke dalam folder `WhatsappServer-local` di proyek Anda.
3.  **Jalankan Instalasi:** Jalankan perintah ini:
    ```
    npm install
    ```
    Tunggu hingga proses selesai.

## Alur Kerja Harian

1.  **Buka Terminal & Masuk ke Folder Server.**
2.  **Jalankan Server:**
    ```
    node server.js
    ```
3.  **Pindai QR Code (Jika Diperlukan):**
    *   Saat pertama kali, atau jika sesi berakhir, sebuah QR code akan muncul.
    *   Buka WhatsApp di HP Anda > **Setelan > Perangkat Tertaut > Tautkan Perangkat**, lalu pindai QR code tersebut.
    *   Setelah berhasil, terminal akan menampilkan: `WhatsApp Terhubung!`.

4.  **Biarkan Tetap Berjalan:** Jendela terminal ini harus tetap terbuka selama jam sekolah.

## Pemecahan Masalah (WAJIB DIBACA JIKA NOTIFIKASI GAGAL)

### Error Paling Umum: `Gagal mengirim pesan... markedUnread` atau Server Macet

Ini adalah error yang paling sering terjadi pada `whatsapp-web.js`. Ini hampir selalu berarti **sesi login Anda di server telah rusak (corrupt)**. Tidak ada perubahan kode yang bisa memperbaikinya, solusinya adalah **mereset sesi login secara manual**.

**Solusi Cepat dan Paling Andal (Wajib Dilakukan Sekarang):**

1.  **Hentikan Server:** Tutup jendela terminal tempat `node server.js` berjalan.
2.  **Hapus Folder Sesi:** Di dalam folder `WhatsappServer-local` Anda, cari dan **HAPUS** seluruh folder yang bernama `.wwebjs_auth`. Jangan khawatir, ini 100% aman. Folder ini akan dibuat ulang secara otomatis.
3.  **Jalankan Ulang Server:** Buka kembali terminal, masuk ke folder `WhatsappServer-local`, dan jalankan lagi `node server.js`.
4.  **Pindai Ulang QR Code:** Anda akan diminta untuk memindai QR code baru. Ini akan membuat sesi yang baru dan bersih.

Setelah langkah-langkah ini, error `markedUnread` seharusnya hilang dan notifikasi akan terkirim dengan andal. Lakukan langkah-langkah ini setiap kali Anda menghadapi masalah pengiriman yang tidak bisa dijelaskan.
