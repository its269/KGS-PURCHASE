# Mirrors the current .next production build to .next-backup for rollback.
# Uses robocopy + cmd rmdir, which is more reliable than Remove-Item on Windows CI runners.
# Incomplete builds (no BUILD_ID) are skipped so deploy can continue.

$ErrorActionPreference = 'Continue'

function Get-BuildIdPath {
    param([string]$Root)

    $direct = Join-Path $Root 'BUILD_ID'
    if (Test-Path -LiteralPath $direct) {
        return $direct
    }

    $nested = Join-Path $Root '.next\BUILD_ID'
    if (Test-Path -LiteralPath $nested) {
        return $nested
    }

    return $null
}

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

function Invoke-RobocopyBackup {
    param(
        [string]$Source,
        [string]$Destination,
        [switch]$Mirror
    )

    $modeFlag = if ($Mirror) { '/MIR' } else { '/E' }
    & robocopy $Source $Destination $modeFlag '/R:3' '/W:2' '/NFL' '/NDL' '/NJH' '/NJS' '/nc' '/ns' '/np'
    return $LASTEXITCODE
}

if (-not (Test-Path -LiteralPath '.next')) {
    Write-Host 'No existing .next folder to backup - skipping'
    exit 0
}

$sourceBuildId = Get-BuildIdPath '.next'
if (-not $sourceBuildId) {
    Write-Host 'WARN: current .next has no BUILD_ID (incomplete/corrupt). Skipping backup and keeping existing .next-backup if present.'
    exit 0
}

$backupExists = Test-Path -LiteralPath '.next-backup'
if ($backupExists) {
    Clear-BuildDir '.next-backup' | Out-Null
    $backupExists = Test-Path -LiteralPath '.next-backup'
}

if ($backupExists) {
    $exitCode = Invoke-RobocopyBackup -Source '.next' -Destination '.next-backup' -Mirror
} else {
    $exitCode = Invoke-RobocopyBackup -Source '.next' -Destination '.next-backup'
}

if ($exitCode -ge 8) {
    throw "robocopy backup failed with exit code $exitCode"
}

$backupBuildId = Get-BuildIdPath '.next-backup'
if (-not $backupBuildId) {
    throw 'Backup verification failed: BUILD_ID missing'
}

Write-Host "Backup of current .next created at .next-backup"
exit 0
