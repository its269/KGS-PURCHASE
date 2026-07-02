<#
Register Windows Task Scheduler jobs for automated Acumatica sync.
Run on the production server as Administrator.

  .\scripts\register-auto-sync-task.ps1
  .\scripts\register-auto-sync-task.ps1 -Remove

Creates:
  - KGS-Purchase-AutoSync-Incremental (every 30 minutes)
  - KGS-Purchase-AutoSync-Full (daily at 2:00 AM)
#>
param(
    [string]$RepoPath = $PSScriptRoot + "\..",
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$RepoPath = (Resolve-Path $RepoPath).Path

$incrementalName = "KGS-Purchase-AutoSync-Incremental"
$fullName = "KGS-Purchase-AutoSync-Full"

function Get-NodePath {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) { return $node.Source }
    throw "node not found on PATH"
}

if ($Remove) {
    Unregister-ScheduledTask -TaskName $incrementalName -Confirm:$false -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $fullName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed scheduled tasks: $incrementalName, $fullName" -ForegroundColor Green
    exit 0
}

$nodeExe = Get-NodePath
$wrapperIncremental = Join-Path $RepoPath "scripts\run-auto-sync-incremental.bat"
$wrapperFull = Join-Path $RepoPath "scripts\run-auto-sync-full.bat"

@(
    "@echo off",
    "cd /d `"$RepoPath`"",
    "set SYNC_MODE=incremental",
    "node scripts\auto-sync.mjs",
    "exit /b %ERRORLEVEL%"
) | Set-Content -Path $wrapperIncremental -Encoding ASCII

@(
    "@echo off",
    "cd /d `"$RepoPath`"",
    "set SYNC_MODE=full",
    "node scripts\auto-sync.mjs",
    "exit /b %ERRORLEVEL%"
) | Set-Content -Path $wrapperFull -Encoding ASCII

$actionIncremental = New-ScheduledTaskAction -Execute $wrapperIncremental -WorkingDirectory $RepoPath
$actionFull = New-ScheduledTaskAction -Execute $wrapperFull -WorkingDirectory $RepoPath

$triggerIncremental = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration ([TimeSpan]::MaxValue)
$triggerFull = New-ScheduledTaskTrigger -Daily -At "02:00"

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $incrementalName -Action $actionIncremental -Trigger $triggerIncremental -Principal $principal -Settings $settings -Force | Out-Null
Register-ScheduledTask -TaskName $fullName -Action $actionFull -Trigger $triggerFull -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Registered scheduled tasks:" -ForegroundColor Green
Write-Host "  $incrementalName — every 30 minutes"
Write-Host "  $fullName — daily at 2:00 AM"
Write-Host ""
Write-Host "Ensure .env in $RepoPath has SYNC_SECRET and NEXT_PUBLIC_BASE_URL=http://localhost:3001/kgs-purchase"
