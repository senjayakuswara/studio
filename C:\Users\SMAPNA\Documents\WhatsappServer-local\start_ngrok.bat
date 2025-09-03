
@echo off
title Ngrok Tunnel for AbTrack

echo =================================================================
echo.
echo   Memulai Ngrok Tunnel untuk Port 3000
echo   Salin URL "Forwarding" (https://...) dan tempel di Pengaturan Aplikasi.
echo   Biarkan jendela ini tetap terbuka!
echo.
echo =================================================================

REM Menjalankan ngrok.exe dari folder saat ini
.\ngrok.exe http 3000
    