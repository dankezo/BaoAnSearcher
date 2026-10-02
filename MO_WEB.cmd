@echo off
cd /d "%~dp0"
cd web
if not exist node_modules call npm install
call npm run build
if errorlevel 1 exit /b 1
cd ..
netstat -ano | findstr ":8787" | findstr "LISTENING" >nul
if errorlevel 1 start "BaoAn API" cmd /k python -m uvicorn server.main:app --host 127.0.0.1 --port 8787
timeout /t 2 /nobreak >nul
echo Mo http://127.0.0.1:8787
start "" http://127.0.0.1:8787/
