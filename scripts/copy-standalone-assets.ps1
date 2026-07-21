# Copies static assets into the Next.js standalone output (required for production).
# Optional -DistDir lets CI prepare .next-incoming before swapping over live .next.

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

$staticExit = Invoke-Robocopy -Source "$distRoot\static" -Destination "$distRoot\standalone\.next\static"
$publicExit = Invoke-Robocopy -Source "$root\public" -Destination "$distRoot\standalone\public"

foreach ($code in @($staticExit, $publicExit)) {
    if ($code -ge 8) {
        throw "robocopy failed with exit code $code"
    }
}

Write-Host "Standalone assets copied for $DistDir"
exit 0
