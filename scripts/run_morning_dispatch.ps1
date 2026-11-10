$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$logFile = Join-Path $projectRoot ('data/morning_dispatch_' + (Get-Date -Format 'yyyyMMdd') + '.log')
Add-Content -LiteralPath $logFile -Value ((Get-Date -Format o) + ' Dispatching daily sources through GitHub API.')
& (Get-Command gh -ErrorAction Stop).Source workflow run daily-crawl.yml --repo dankezo/BaoAnSearcher --ref master --field 'only=tenders,prices,ycbg,dav' --field 'days=3' --field 'daily=true' >> $logFile 2>&1
exit $LASTEXITCODE
