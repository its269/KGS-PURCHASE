# Copies static assets into the Next.js standalone output (required for production).
# Optional -DistDir lets CI prepare .next-incoming before swapping over live .next.
#
# When NEXT_DIST_DIR is custom (e.g. .next-incoming), Next nests the server build
# under standalone/<distDirName>/ (with BUILD_ID). Static assets must go there —
# not always standalone/.next/static — or CSS/JS 404 and the UI renders blank.

param(
    [string]$DistDir = '.next'
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$distRoot = Join-Path $root $DistDir

if (-not (Test-Path -LiteralPath "$distRoot\standalone\server.js")) {
    throw "Standalone server.js not found under $DistDir - run npm run build first"
}

function Invoke-Robocopy {
    param([string]$Source, [string]$Destination)

    if (-not (Test-Path -LiteralPath $Source)) {
        Write-Host "Skip missing: $Source"
        return 0
    }

    & robocopy $Source $Destination /E /NFL /NDL /NJH /NJS /nc /ns /np
    return $LASTEXITCODE
}

function Get-StandaloneServerDistDir {
    param([string]$StandaloneRoot)

    $distDirName = Split-Path -Leaf $DistDir
    $candidates = @(
        (Join-Path $StandaloneRoot $distDirName),
        (Join-Path $StandaloneRoot '.next'),
        (Join-Path $StandaloneRoot '.next-incoming')
    ) | Select-Object -Unique

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath (Join-Path $candidate 'BUILD_ID')) {
            return $candidate
        }
    }

    throw "Could not find BUILD_ID under $StandaloneRoot (looked for: $($candidates -join ', '))"
}

$standaloneRoot = Join-Path $distRoot 'standalone'
$serverDistDir = Get-StandaloneServerDistDir -StandaloneRoot $standaloneRoot
$staticDest = Join-Path $serverDistDir 'static'

Write-Host "Standalone server dist: $serverDistDir"

$staticExit = Invoke-Robocopy -Source "$distRoot\static" -Destination $staticDest
$publicExit = Invoke-Robocopy -Source "$root\public" -Destination "$standaloneRoot\public"

foreach ($code in @($staticExit, $publicExit)) {
    if ($code -ge 8) {
        throw "robocopy failed with exit code $code"
    }
}

$cssDir = Join-Path $staticDest 'css'
if (-not (Test-Path -LiteralPath $cssDir) -or -not (Get-ChildItem -LiteralPath $cssDir -File -ErrorAction SilentlyContinue)) {
    throw "Static CSS missing after copy: $cssDir"
}

Write-Host "Standalone assets copied for $DistDir -> $staticDest"
exit 0
