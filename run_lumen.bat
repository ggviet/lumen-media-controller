@echo off
echo [LUMEN] Đang kiểm tra môi trường...
cd /d "%~dp0"
if not exist node_modules (
    echo [LUMEN] Đang cài đặt Electron (Vui lòng đợi trong giây lát)...
    call npm install electron --save-dev
)
echo [LUMEN] Đang khởi chạy ứng dụng...
call npm start
pause
