@echo off
title Ngrok Tunnel for WhatsApp Server

echo =================================================================
echo.
echo   Memulai Ngrok Tunnel untuk Port 3000
echo   Biarkan jendela ini tetap terbuka!
echo.
echo =================================================================

REM Cek apakah ngrok.exe ada di folder ini
if exist "%~dp0ngrok.exe" (
    REM Jalankan ngrok dari folder saat ini
    "%~dp0ngrok.exe" http 3000
) else (
    REM Coba jalankan ngrok dari PATH sistem jika tidak ditemukan di folder lokal
    ngrok http 3000
)

pause
