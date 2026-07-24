<#
Manual production deploy - same staged flow as .github/workflows/deploy.yml.
Builds into .next-incoming while the live app keeps serving from .next, then swaps.

  cd C:\Users\Administrator\Desktop\Github\KGS-PURCHASE
  .\scripts\deploy-production.ps1

Optional:
  .\scripts\deploy-production.ps1 -SkipPull
  .\scripts\deploy-production.ps1 -RepoPath "D:\apps\KGS-PURCHASE"
#>
param(
    [string]$RepoPath = "C:\Users\Administrator\Desktop\Github\KGS-PURCHASE",
    [switch]$SkipPull
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "=== $Message ===" -ForegroundColor Cyan
}

if (-not (Test-Path -LiteralPath $RepoPath)) {
    Write-Error "Repo path not found: $RepoPath"
    exit 1
}

Set-Location $RepoPath
& "$PSScriptRoot\ensure-node-path.ps1"
Write-Host "Deploy target: $RepoPath"
Write-Host "Public URL   : http://190.92.233.232/kgs-purchase/signin"

try {
    if (-not $SkipPull) {
        Write-Step "Pull latest code"
        git -c safe.directory=C:/Users/Administrator/Desktop/Github/KGS-PURCHASE fetch origin main
        git -c safe.directory=C:/Users/Administrator/Desktop/Github/KGS-PURCHASE reset --hard origin/main
        Write-Host "At commit: $(git log -1 --oneline)"
    }

    Write-Step "Verify production .env"
    & .\scripts\check-production-env.ps1

    Write-Step "Install dependencies"
    & .\scripts\ensure-node-path.ps1
    $env:NPM_CONFIG_CACHE = "$env:ProgramData\kgs-purchase-npm-cache"
    New-Item -ItemType Directory -Force -Path $env:NPM_CONFIG_CACHE | Out-Null
    if (Test-Path "node_modules") {
        Write-Host "node_modules present - running npm install"
        npm install --no-audit --no-fund
    } else {
        npm ci
    }
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

    Write-Step "Build production bundle (staged into .next-incoming)"
    & .\scripts\ensure-next-swc.ps1
    if ($LASTEXITCODE -ne 0) { throw "SWC ensure failed" }

    if (Test-Path '.next-incoming') {
        cmd /c 'rmdir /s /q ".next-incoming"' 2>&1 | Out-Null
    }

    $env:NEXT_TELEMETRY_DISABLED = '1'
    $env:NODE_OPTIONS = '--max-old-space-size=8192'
    $env:NEXT_PUBLIC_BASE_PATH = '/kgs-purchase'
    $env:NEXT_DIST_DIR = '.next-incoming'
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

    Write-Step "Copy standalone assets into staged build"
    & .\scripts\copy-standalone-assets.ps1 -DistDir '.next-incoming'

    if (-not (Test-Path -LiteralPath ".next-incoming\BUILD_ID")) {
        throw "BUILD_ID missing in staged build"
    }
    if (-not (Test-Path -LiteralPath ".next-incoming\standalone\server.js")) {
        throw "standalone server.js missing in staged build"
    }
    Write-Host "Staged Build ID: $(Get-Content .next-incoming\BUILD_ID -Raw)"

    Write-Step "Stop app and activate staged build"
    $ErrorActionPreference = 'Continue'
    & .\scripts\ensure-pm2-env.ps1
    & .\scripts\stop-app.ps1
    $ErrorActionPreference = 'Stop'
    & .\scripts\activate-next-build.ps1
    if ($LASTEXITCODE -ne 0) { throw "activate-next-build failed" }

    Write-Step "Restart production server"
    & .\scripts\ensure-pm2-env.ps1
    & .\scripts\ensure-node-path.ps1
    if (-not (Test-Path '.next\standalone\server.js')) {
        throw 'Cannot start: .next\standalone\server.js is missing'
    }
    pm2 delete kgs-purchase-http 2>$null
    pm2 start ecosystem.config.js --only kgs-purchase-http
    if ($LASTEXITCODE -ne 0) { throw "pm2 start failed" }
    pm2 save
    pm2 status

    Write-Step "Health check"
    Start-Sleep -Seconds 8
    try {
        $r = Invoke-WebRequest -Uri 'http://localhost:3001/kgs-purchase/signin' -UseBasicParsing -TimeoutSec 15
        Write-Host "OK  localhost:3001/kgs-purchase/signin -> HTTP $($r.StatusCode)" -ForegroundColor Green
    } catch {
        Write-Warning "Local health check: $($_.Exception.Message)"
    }
    try {
        $r2 = Invoke-WebRequest -Uri 'http://190.92.233.232/kgs-purchase/signin' -UseBasicParsing -TimeoutSec 15
        Write-Host "OK  http://190.92.233.232/kgs-purchase/signin -> HTTP $($r2.StatusCode)" -ForegroundColor Green
    } catch {
        Write-Warning "Public health check: $($_.Exception.Message)"
        Write-Host "If local OK but public fails, run: .\scripts\setup-kgs-purchase-proxy.ps1"
    }

    Write-Host ""
    Write-Host "DEPLOY SUCCESS" -ForegroundColor Green
    Write-Host "Open: http://190.92.233.232/kgs-purchase/signin"
}
catch {
    Write-Host ""
    Write-Host "DEPLOY FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Rolling back..." -ForegroundColor Yellow

    $ErrorActionPreference = 'Continue'
    & .\scripts\ensure-pm2-env.ps1
    & .\scripts\ensure-node-path.ps1
    & .\scripts\stop-app.ps1
    & .\scripts\restore-next-backup.ps1
    if (Test-Path '.next\standalone\server.js') {
        pm2 delete kgs-purchase-http 2>$null
        pm2 start ecosystem.config.js --only kgs-purchase-http
        pm2 save
    }
    pm2 status
    Write-Host "Rollback complete" -ForegroundColor Yellow
    exit 1
}
