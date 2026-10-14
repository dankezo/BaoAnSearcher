@echo off
cd /d "%~dp0"
if not exist data mkdir data
python scripts\crawl_ycbg.py --publish >> data\ycbg_daily.log 2>&1
exit /b %errorlevel%
