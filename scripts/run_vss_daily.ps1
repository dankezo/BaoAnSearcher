$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$logFolder = Join-Path $projectRoot 'data'
New-Item -ItemType Directory -Path $logFolder -Force | Out-Null
$logFile = Join-Path $logFolder ('vss_daily_' + (Get-Date -Format 'yyyyMMdd') + '.log')
$pythonPath = (Get-Command python -ErrorAction Stop).Source
$env:PYTHONUTF8 = '1'
$env:PYTHONUNBUFFERED = '1'
& $pythonPath (Join-Path $PSScriptRoot 'vss_daily.py') --publish --daily >> $logFile 2>&1
exit $LASTEXITCODE
