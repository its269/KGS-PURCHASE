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

$roboCopyExit = & robocopy '.next-backup' '.next' /E /R:3 /W:2 /NFL /NDL /NJH /NJS /nc /ns /np
if ($roboCopyExit -ge 8) {
    throw "robocopy restore failed with exit code $roboCopyExit"
}
cmd /c 'rmdir /s /q ".next-backup"' 2>&1 | Out-Null
Write-Host 'Restored from backup'
exit 0
