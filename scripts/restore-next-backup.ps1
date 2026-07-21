# Restores .next-backup to .next for deploy rollback on Windows.
# Never Move-Item a backup into an existing .next folder — that nests as .next\.next-backup.
# If .next is locked, rename it aside so restore can proceed.

$ErrorActionPreference = 'Continue'

function Clear-BuildDir {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return $true
    }

    for ($attempt = 1; $attempt -le 5; $attempt++) {
        cmd /c "rmdir /s /q `"$Path`"" 2>&1 | Out-Null
        if (-not (Test-Path -LiteralPath $Path)) {
            return $true
        }
        Start-Sleep -Seconds 2
    }

    $staleName = "$(Split-Path -Leaf $Path)-stale-$(Get-Date -Format 'yyyyMMddHHmmss')"
    try {
        Rename-Item -LiteralPath $Path -NewName $staleName -Force
        Write-Host "Renamed locked folder to $staleName"
        return (-not (Test-Path -LiteralPath $Path))
    } catch {
        Write-Host "WARN: could not clear $Path - $($_.Exception.Message)"
        return $false
    }
}

function Test-ValidBuild([string]$Root) {
    return (Test-Path -LiteralPath (Join-Path $Root 'BUILD_ID')) -and
           (Test-Path -LiteralPath (Join-Path $Root 'standalone\server.js'))
}

# Recover from a previously nested backup created by a bad Move-Item
$nestedBackup = '.next\.next-backup'
if ((Test-Path -LiteralPath $nestedBackup) -and (Test-ValidBuild $nestedBackup)) {
    Write-Host 'Found nested backup at .next\.next-backup — promoting to repo-root .next-backup'
    if (Test-Path -LiteralPath '.next-backup') {
        Clear-BuildDir '.next-backup' | Out-Null
    }
    if (-not (Test-Path -LiteralPath '.next-backup')) {
        Move-Item -LiteralPath $nestedBackup -Destination '.next-backup' -Force
    }
}

if (-not (Test-Path -LiteralPath '.next-backup')) {
    Write-Host 'No backup found - restarting with current build'
    exit 0
}

if (-not (Test-ValidBuild '.next-backup')) {
    Write-Host 'WARN: .next-backup is incomplete (missing BUILD_ID or standalone/server.js) - leaving current .next in place'
    exit 0
}

if (-not (Clear-BuildDir '.next')) {
    throw 'Rollback failed: could not remove or rename current .next'
}

# After Clear-BuildDir, .next must not exist — otherwise Move-Item nests the backup
if (Test-Path -LiteralPath '.next') {
    throw 'Rollback failed: .next still exists after clear; refusing Move-Item to avoid nesting'
}

Move-Item -LiteralPath '.next-backup' -Destination '.next' -Force

if (-not (Test-ValidBuild '.next')) {
    throw 'Rollback failed: restored .next is missing BUILD_ID or standalone/server.js'
}

Write-Host 'Restored from backup'
exit 0
