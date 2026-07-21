# Activates a staged Next.js build (.next-incoming by default) as the live .next folder.
# Live production keeps serving from .next until this script runs after stop-app.

param(
    [string]$IncomingDir = '.next-incoming',
    [string]$LiveDir = '.next'
)

$ErrorActionPreference = 'Stop'

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

if (-not (Test-ValidBuild $IncomingDir)) {
    throw "Incoming build is incomplete: $IncomingDir (need BUILD_ID and standalone/server.js)"
}

# Keep a rollback copy of the currently live build before replacing it
if (Test-ValidBuild $LiveDir) {
    if (Test-Path -LiteralPath '.next-backup') {
        Clear-BuildDir '.next-backup' | Out-Null
    }
    if (-not (Test-Path -LiteralPath '.next-backup')) {
        Move-Item -LiteralPath $LiveDir -Destination '.next-backup' -Force
        Write-Host "Moved live build to .next-backup"
    } else {
        if (-not (Clear-BuildDir $LiveDir)) {
            throw "Could not clear live build directory $LiveDir"
        }
    }
} else {
    if (-not (Clear-BuildDir $LiveDir)) {
        throw "Could not clear incomplete live build directory $LiveDir"
    }
}

if (Test-Path -LiteralPath $LiveDir) {
    throw "Live directory $LiveDir still exists; refusing activate to avoid nesting"
}

Move-Item -LiteralPath $IncomingDir -Destination $LiveDir -Force

if (-not (Test-ValidBuild $LiveDir)) {
    throw "Activated build is incomplete under $LiveDir"
}

Write-Host "Activated $IncomingDir as $LiveDir"
exit 0
