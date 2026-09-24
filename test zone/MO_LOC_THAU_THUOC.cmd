@echo off
cd /d "%~dp0procurement"
pythonw.exe app.py
if errorlevel 1 (
  echo Khong mo duoc ung dung. Hay cai Python 3.10+ co Tcl/Tk.
  pause
)
