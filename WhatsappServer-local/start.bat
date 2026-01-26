@echo off
title AbTrack WhatsApp Server
echo Menjalankan server notifikasi di PowerShell...
powershell.exe -NoExit -Command "& {Set-Location -Path '%~dp0'; node server.js}"
