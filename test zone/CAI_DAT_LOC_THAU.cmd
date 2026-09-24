@echo off
cd /d "%~dp0procurement"
python -m pip install --target vendor -r requirements.txt
if errorlevel 1 (
  echo Cai dat chua thanh cong. Kiem tra ket noi mang va Python.
) else (
  echo Da san sang. Mo MO_LOC_THAU_THUOC.cmd de su dung.
)
pause
