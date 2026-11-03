@echo off
chcp 65001 >nul
title Trình tải phim ngắn Hongguo - Khởi động
cd /d "%~dp0"

REM Ưu tiên bản không cần cài; nếu chưa có thì mở bộ cài đặt
if exist "dist\win-unpacked\TrinhTaiPhimNganHongguo.exe" (
    echo Đang khởi động Trình tải phim ngắn Hongguo...
    start "" "dist\win-unpacked\TrinhTaiPhimNganHongguo.exe"
    exit /b
)

for %%F in ("dist\*-Setup-*.exe") do (
    echo Chưa có bản không cần cài, đang mở bộ cài đặt. Hãy cài xong rồi dùng.
    start "" "%%~fF"
    exit /b
)

echo Không tìm thấy tệp chạy, hãy chạy npm run build trước.
pause
