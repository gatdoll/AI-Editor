@echo off
chcp 65001 >nul
title Editing Video
cd /d "%~dp0"
node scripts\start-all.mjs
echo.
echo Aplikasi berhenti. Tekan tombol apa saja untuk menutup jendela ini.
pause >nul
