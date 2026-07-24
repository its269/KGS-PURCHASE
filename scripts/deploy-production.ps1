<#
Manual production deploy — same steps as .github/workflows/deploy.yml.
Run on the Windows production server (190.92.233.232) as Administrator.

  cd C:\Users\Administrator\Desktop\Github\KGS-PURCHASE
  .\scripts\deploy-production.ps1

Optional:
  .\scripts\deploy-production.ps1 -SkipPull        # rebuild current checkout only
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
        git fetch origin main
        git reset --hard origin/main
        Write-Host "At commit: $(git log -1 --oneline)"
    }

    Write-Step "Verify production .env"
    & .\scripts\check-production-env.ps1 -RepoPath $RepoPath

    Write-Step "Stop app and backup current build"
    $ErrorActionPreference = 'Continue'
    & .\scripts\ensure-pm2-env.ps1
    pm2 stop kgs-purchase-http 2>&1 | Out-Null
    Start-Sleep -Seconds 8
    & .\scripts\backup-next-build.ps1
    if ($LASTEXITCODE -ne 0) { throw "Backup failed" }
    $ErrorActionPreference = 'Stop'

    Write-Step "Install dependencies"
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

    Write-Step "Build production bundle"
    $env:NEXT_TELEMETRY_DISABLED = '1'
    $env:NODE_OPTIONS = '--max-old-space-size=8192'
    $env:NEXT_PUBLIC_BASE_PATH = '/kgs-purchase'
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

    Write-Step "Copy standalone assets"
    & .\scripts\copy-standalone-assets.ps1

    if (-not (Test-Path -LiteralPath ".next\BUILD_ID")) {
        throw "BUILD_ID missing - build failed"
    }
    if (-not (Test-Path -LiteralPath ".next\standalone\server.js")) {
        throw "standalone server.js missing"
    }
    Write-Host "Build ID: $(Get-Content .next\BUILD_ID -Raw)"

    Write-Step "Restart production server"
    & .\scripts\pm2-env.bat
    pm2 reload kgs-purchase-http --update-env
    if ($LASTEXITCODE -ne 0) {
        pm2 start ecosystem.config.js --only kgs-purchase-http
    }
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
    pm2 stop kgs-purchase-http 2>&1 | Out-Null
    Start-Sleep -Seconds 8
    & .\scripts\restore-next-backup.ps1
    pm2 reload kgs-purchase-http --update-env
    if ($LASTEXITCODE -ne 0) {
        pm2 start ecosystem.config.js --only kgs-purchase-http
    }
    pm2 save
    pm2 status
    Write-Host "Rollback complete" -ForegroundColor Yellow
    exit 1
}
