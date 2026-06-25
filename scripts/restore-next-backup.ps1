# Restores .next-backup to .next for deploy rollback on Windows.

$ErrorActionPreference = 'Continue'

if (-not (Test-Path -LiteralPath '.next-backup')) {
    Write-Host 'No backup found - restarting with current build'
    exit 0
}

if (Test-Path -LiteralPath '.next') {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        cmd /c 'rmdir /s /q ".next"' 2>&1 | Out-Null
        if (-not (Test-Path -LiteralPath '.next')) {
            break
        }
        Start-Sleep -Seconds 2
    }
}

if (Test-Path -LiteralPath '.next') {
    throw 'Rollback failed: could not remove current .next'
}

Move-Item -LiteralPath '.next-backup' -Destination '.next' -Force
Write-Host 'Restored from backup'
exit 0
