$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 15) -ExecutionTimeLimit (New-TimeSpan -Minutes 50)
foreach ($task in @(
    @{Name='BaoAnSearcher DAV Daily'; Script='run_dav_daily.ps1'; Times=@('04:30','05:45')},
    @{Name='BaoAnSearcher Morning Dispatch'; Script='run_morning_dispatch.ps1'; Times=@('04:45','05:45')}
)) {
    $runner = Join-Path $PSScriptRoot $task.Script
    $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`"" -WorkingDirectory $projectRoot
    $triggers = @($task.Times | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ })
    $triggers += New-ScheduledTaskTrigger -AtLogOn -User $account
    Register-ScheduledTask -TaskName $task.Name -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'Early daily update with morning retry and catch-up at logon; successful sources are skipped.' -Force | Select-Object TaskName,State
}
$legacy = Get-ScheduledTask -TaskName 'BaoAnSearcher YCBG Daily' -ErrorAction SilentlyContinue
if ($legacy) {
    Export-ScheduledTask -TaskName $legacy.TaskName | Set-Content -LiteralPath (Join-Path $projectRoot 'data/legacy_ycbg_daily_task.xml') -Encoding UTF8
    Disable-ScheduledTask -TaskName $legacy.TaskName | Select-Object TaskName,State
}
