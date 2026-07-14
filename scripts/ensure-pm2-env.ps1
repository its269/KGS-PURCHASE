# Ensures PM2 can resolve the Windows home directory (HOMEPATH/HOME)
# and that pm2 itself is on PATH (AppData\Roaming\npm).
# Call before any pm2 CLI invocation in minimal shells (-NoProfile, Task Scheduler, CI).

if (-not $env:HOMEPATH -and $env:USERPROFILE) {
    $env:HOMEPATH = $env:USERPROFILE -replace '^[^:]+:', ''
}

if (-not $env:HOME -and $env:USERPROFILE) {
    $env:HOME = $env:USERPROFILE
}

function Add-PathFront([string]$dir) {
    if (-not $dir) { return }
    if (-not (Test-Path -LiteralPath $dir)) { return }
    if ($env:Path -notlike "*$dir*") {
        $env:Path = "$dir;$env:Path"
        Write-Host "Added to PATH: $dir"
    }
}

$npmRoaming = if ($env:APPDATA) {
    Join-Path $env:APPDATA 'npm'
} else {
    'C:\Users\Administrator\AppData\Roaming\npm'
}

Add-PathFront $npmRoaming
Add-PathFront 'C:\Users\Administrator\AppData\Roaming\npm'
Add-PathFront 'C:\Program Files\nodejs'

if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Write-Host 'WARN: pm2 still not on PATH after ensure-pm2-env'
} else {
    Write-Host "pm2: $((Get-Command pm2).Source)"
}
