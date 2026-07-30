# Stops the kgs-purchase-http application before a build or rollback.
# Tries pm2 first; then force-kills anything still holding the app port.
# Also stops leftover `next dev` / start-server processes for this repo that
# can lock the live `.next` folder and break activate-next-build.
#
# IMPORTANT: GitHub Actions runner must run as Local System so it can stop
# the SYSTEM-owned PM2 process. NETWORK SERVICE cannot kill it (Access Denied).

param(
    [int]$Port = 3001,
    [string]$Pm2App = 'kgs-purchase-http'
)

$ErrorActionPreference = 'Continue'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Get-ListeningPids([int]$ListenPort) {
    $ids = @()
    $netstatLines = netstat -ano 2>&1 | Select-String "TCP\s+[0-9.:\[\]]+:$ListenPort\s+.*LISTENING"
    foreach ($line in $netstatLines) {
        $parts = ($line.ToString().Trim() -split '\s+')
        $procId = $parts[-1]
        if ($procId -match '^\d+$' -and [int]$procId -ne 0) {
            $ids += [int]$procId
        }
    }
    return ($ids | Select-Object -Unique)
}

if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    Write-Host "Stopping $Pm2App via pm2..."
    pm2 stop $Pm2App 2>&1 | Out-Null
    Start-Sleep -Seconds 5
} else {
    Write-Host "pm2 not on PATH - will use port-based process kill"
}

$listenPids = Get-ListeningPids -ListenPort $Port
if ($listenPids.Count -gt 0) {
    foreach ($procId in $listenPids) {
        Write-Host "Force-killing PID $procId (listening on port $Port)..."
        cmd /c "taskkill /F /PID $procId /T" 2>&1 | Out-Null
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 3
} else {
    Write-Host "No process listening on port $Port"
}

# Extra safety: stop Next.js start-server / next dev for this repo on any port
$repoMarker = [regex]::Escape($repoRoot)
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.CommandLine -and
        $_.CommandLine -match $repoMarker -and
        (
            $_.CommandLine -match 'node_modules[\\/]+next[\\/]+dist[\\/]+server[\\/]+lib[\\/]+start-server' -or
            $_.CommandLine -match 'next[\\/]+dist[\\/]+bin[\\/]+next["\s]+dev' -or
            $_.CommandLine -match '["\s]next["\s]+dev'
        ) -and
        $_.CommandLine -notmatch 'ProcessContainerFork'
    } |
    ForEach-Object {
        Write-Host "Stopping leftover Next process PID $($_.ProcessId)..."
        cmd /c "taskkill /F /PID $($_.ProcessId) /T" 2>&1 | Out-Null
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

Start-Sleep -Seconds 2

$still = Get-ListeningPids -ListenPort $Port
if ($still.Count -gt 0) {
    throw "Port $Port still held by PID(s): $($still -join ', '). Runner must run as Local System to stop PM2."
}

Write-Host "Port $Port is free"
exit 0
