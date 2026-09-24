@echo off
cd /d "%~dp0"
pythonw.exe drug_tool.py
if errorlevel 1 (
  echo Khong mo duoc ung dung. Hay cai Python 3.10+ co Tkinter.
  pause
)
