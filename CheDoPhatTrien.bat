@echo off
chcp 65001 >nul
title Trình tải phim ngắn Hongguo - Chế độ phát triển
cd /d "%~dp0"

echo ============================================
echo  Trình tải phim ngắn Hongguo - Chế độ phát triển
echo  Chạy song song máy chủ phát triển React + Electron
echo ============================================
echo.

if not exist node_modules (
    echo Lần chạy đầu tiên, đang cài thư viện, vui lòng đợi...
    call npm install
)

call npm run dev
