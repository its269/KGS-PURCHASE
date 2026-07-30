# Stops the kgs-purchase-http application before a build or rollback.
# Tries pm2 first; falls back to killing the process that owns the app port,
# which prevents EBUSY errors when next build cleans .next\standalone.
# Also stops leftover `next dev` / start-server processes for this repo that
# can lock the live `.next` folder and break activate-next-build.

param(
    [int]$Port = 3001,
    [string]$Pm2App = 'kgs-purchase-http'
)

$ErrorActionPreference = 'Continue'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    Write-Host "Stopping $Pm2App via pm2..."
    pm2 stop $Pm2App 2>&1 | Out-Null
    Start-Sleep -Seconds 5
} else {
    Write-Host "pm2 not on PATH - will use port-based process kill"
}

# Kill any process still holding the TCP port (releases .next\standalone locks)
$netstatLines = netstat -ano 2>&1 | Select-String "TCP\s+[0-9.:\[\]]+:$Port\s+.*LISTENING"
if ($netstatLines) {
    foreach ($line in $netstatLines) {
        $parts = ($line.ToString().Trim() -split '\s+')
        $procId = $parts[-1]
        if ($procId -match '^\d+$' -and [int]$procId -ne 0) {
            Write-Host "Killing PID $procId (listening on port $Port)..."
            Stop-Process -Id ([int]$procId) -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 3
    Write-Host "Port $Port process stopped"
} else {
    Write-Host "No process listening on port $Port - nothing to kill"
}

# Extra safety: stop Next.js start-server processes for this repo (next dev on any port)
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
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

Start-Sleep -Seconds 2
exit 0
