# Copies static assets into the Next.js standalone output (required for production).

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')

if (-not (Test-Path -LiteralPath "$root\.next\standalone\server.js")) {
    throw 'Standalone server.js not found — run npm run build first'
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

$staticExit = Invoke-Robocopy -Source "$root\.next\static" -Destination "$root\.next\standalone\.next\static"
$publicExit = Invoke-Robocopy -Source "$root\public" -Destination "$root\.next\standalone\public"

foreach ($code in @($staticExit, $publicExit)) {
    if ($code -ge 8) {
        throw "robocopy failed with exit code $code"
    }
}

Write-Host 'Standalone assets copied'
exit 0
