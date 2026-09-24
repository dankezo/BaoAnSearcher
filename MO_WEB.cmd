@echo off
cd /d "%~dp0"
start "BaoAn API" cmd /k python -m uvicorn server.main:app --host 127.0.0.1 --port 8787
cd web
if not exist node_modules npm install
start "BaoAn UI" cmd /k npm run dev
echo Mo http://127.0.0.1:5173
