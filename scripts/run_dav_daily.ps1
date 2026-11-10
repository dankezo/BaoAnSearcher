$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$env:PYTHONUTF8 = '1'
$env:PYTHONUNBUFFERED = '1'
$logFile = Join-Path $projectRoot ('data/dav_daily_' + (Get-Date -Format 'yyyyMMdd') + '.log')
& (Get-Command python -ErrorAction Stop).Source (Join-Path $PSScriptRoot 'dav_daily.py') --publish --daily >> $logFile 2>&1
exit $LASTEXITCODE
