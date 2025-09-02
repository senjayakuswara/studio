@echo off
echo ======================================================
echo ==                                                  ==
echo ==      Menjalankan Ngrok untuk WhatsApp Server     ==
echo ==                                                  ==
echo ======================================================
echo.
echo Script ini akan membuat jembatan aman dari internet
echo ke server notifikasi lokal Anda di port 3000.
echo.
echo PENTING:
echo 1. Pastikan server notifikasi (node server.js) SUDAH berjalan.
echo 2. Jendela ini HARUS tetap terbuka agar notifikasi berfungsi.
echo 3. Salin URL "Forwarding" (yang berawalan https://)
echo    dan tempel ke Pengaturan Aplikasi di AbTrack.
echo.

ngrok http 3000
