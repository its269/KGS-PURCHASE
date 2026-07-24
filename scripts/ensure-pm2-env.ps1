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

    # Never fail the whole deploy on ACL probe errors (common for Actions service accounts).
    $exists = $true
    try {
        if (-not (Test-Path -LiteralPath $dir -ErrorAction Stop)) {
            $exists = $false
        }
    } catch {
        Write-Host "WARN: cannot probe path '$dir' ($($_.Exception.Message)). Adding to PATH anyway."
    }
    if (-not $exists) { return }

    $parts = $env:Path -split ';' | Where-Object {
        $_ -and $_.TrimEnd('\') -ne $dir.TrimEnd('\')
    }
    $env:Path = ($dir + ';' + ($parts -join ';')).TrimEnd(';')
    Write-Host "Added to PATH: $dir"
}

function Grant-UsersReadExecute([string]$dir) {
    if (-not $dir) { return }
    try {
        if (-not (Test-Path -LiteralPath $dir -ErrorAction Stop)) { return }

        # Only touch the directory ACL (no /T). Recursive icacls on AppData\npm
        # can take minutes and stall/fail GitHub Actions deploys.
        $acl = Get-Acl -LiteralPath $dir
        $usersSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545')
        $hasUsers = $acl.Access | Where-Object {
            $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $usersSid.Value -and
            $_.FileSystemRights.ToString() -match 'ReadAndExecute|Read|FullControl'
        }
        if ($hasUsers) { return }

        icacls $dir /grant "*S-1-5-32-545:(OI)(CI)RX" /C /Q 2>$null | Out-Null
        Write-Host "Granted Users RX on $dir"
    } catch {
        # Best-effort only — deploy must continue even if ACL update fails
    }
}

$adminNpm = 'C:\Users\Administrator\AppData\Roaming\npm'
$npmRoaming = if ($env:APPDATA) {
    Join-Path $env:APPDATA 'npm'
} else {
    $adminNpm
}

# Allow the Actions / service account to read Administrator's global npm shims (pm2, etc.)
Grant-UsersReadExecute $adminNpm
if ($npmRoaming -ne $adminNpm) {
    Grant-UsersReadExecute $npmRoaming
}

Add-PathFront $npmRoaming
Add-PathFront $adminNpm
Add-PathFront 'C:\Program Files\nodejs'

$repoRoot = Split-Path -Parent $PSScriptRoot
$portableNpm = Join-Path $repoRoot '.tools'
Get-ChildItem -LiteralPath $portableNpm -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    Select-Object -First 1 |
    ForEach-Object { Add-PathFront $_.FullName }

if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Write-Host 'WARN: pm2 still not on PATH after ensure-pm2-env'
} else {
    Write-Host "pm2: $((Get-Command pm2).Source)"
}
