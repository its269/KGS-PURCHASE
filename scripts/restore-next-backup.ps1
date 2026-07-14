# Restores .next-backup to .next for deploy rollback on Windows.
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
        return $true
    } catch {
        Write-Host "WARN: could not clear $Path - $($_.Exception.Message)"
        return $false
    }
}

if (-not (Test-Path -LiteralPath '.next-backup')) {
    Write-Host 'No backup found - restarting with current build'
    exit 0
}

$backupBuildId = Join-Path '.next-backup' 'BUILD_ID'
if (-not (Test-Path -LiteralPath $backupBuildId)) {
    Write-Host 'WARN: .next-backup has no BUILD_ID - leaving current .next in place'
    exit 0
}

if (-not (Clear-BuildDir '.next')) {
    throw 'Rollback failed: could not remove or rename current .next'
}

Move-Item -LiteralPath '.next-backup' -Destination '.next' -Force
Write-Host 'Restored from backup'
exit 0
