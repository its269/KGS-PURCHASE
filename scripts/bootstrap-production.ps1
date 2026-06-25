<#
First-time production bootstrap for KGS-PURCHASE on this Windows server.
Run from repo root in PowerShell (not required for GitHub Actions deploy after initial setup).

  .\scripts\bootstrap-production.ps1
#>
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

Write-Host "=== KGS-PURCHASE production bootstrap ==="

if (-not (Test-Path -LiteralPath '.env')) {
    Write-Warning '.env not found. Create .env with production secrets before continuing.'
    Write-Host 'Required: NEXT_PUBLIC_BASE_PATH=/kgs-purchase, NEXT_PUBLIC_BASE_URL, ACUMATICA_*, MYSQL_*, SYNC_SECRET'
}

& .\scripts\ensure-pm2-env.ps1

Write-Host 'Installing dependencies...'
npm ci

$env:NEXT_TELEMETRY_DISABLED = '1'
$env:NODE_OPTIONS = '--max-old-space-size=8192'
if (-not $env:NEXT_PUBLIC_BASE_PATH) {
    $env:NEXT_PUBLIC_BASE_PATH = '/kgs-purchase'
}

Write-Host 'Building...'
npm run build

& .\scripts\copy-standalone-assets.ps1

& .\scripts\pm2-env.bat
pm2 delete kgs-purchase-http 2>$null
pm2 start ecosystem.config.js --only kgs-purchase-http
pm2 save
pm2 status

Write-Host ''
Write-Host 'Bootstrap complete. Health check:'
Start-Sleep -Seconds 5
try {
    $r = Invoke-WebRequest -Uri 'http://localhost:3001/kgs-purchase/signin' -UseBasicParsing -TimeoutSec 15
    Write-Host "OK - HTTP $($r.StatusCode)"
} catch {
    Write-Warning $_.Exception.Message
}

Write-Host ''
Write-Host 'If port 80 /kgs-purchase is not reachable yet, run (as Admin):'
Write-Host '  .\scripts\setup-kgs-purchase-proxy.ps1'
