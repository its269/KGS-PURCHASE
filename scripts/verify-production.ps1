<#
Quick production health check (run on the server or after deploy).

  .\scripts\verify-production.ps1
  .\scripts\verify-production.ps1 -RepoPath "C:\path\to\KGS-PURCHASE"
#>
param(
    [string]$RepoPath = "C:\Users\Administrator\Desktop\Github\KGS-PURCHASE"
)
$ErrorActionPreference = 'Continue'

Write-Host "=== KGS-PURCHASE production check ===" -ForegroundColor Cyan

$repoPath = $RepoPath
if (Test-Path $repoPath) {
    Push-Location $repoPath
    $commit = (git rev-parse --short HEAD 2>$null)
    Write-Host "Repo path : $repoPath"
    Write-Host "Git commit: $commit"
    if (Test-Path ".next\BUILD_ID") {
        Write-Host "Build ID  : $(Get-Content .next\BUILD_ID -Raw)"
    } else {
        Write-Warning 'No .next\BUILD_ID - app may not be built yet.'
    }

    Write-Host ""
    Write-Host "Environment (.env):"
    if (Test-Path ".env") {
        try {
            & .\scripts\check-production-env.ps1
        } catch {
            Write-Warning $_.Exception.Message
        }
    } else {
        Write-Host "FAIL .env file missing — login will not work" -ForegroundColor Red
    }

    Pop-Location
} else {
    Write-Warning "Repo not found at $repoPath"
}

Write-Host ""
Write-Host "PM2 status:"
& "$repoPath\scripts\ensure-pm2-env.ps1" 2>$null
pm2 status kgs-purchase-http 2>&1

$urls = @(
    "http://localhost:3001/kgs-purchase/signin",
    "http://190.92.233.232/kgs-purchase/signin"
)
Write-Host ""
foreach ($url in $urls) {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
        Write-Host "OK  $url -> HTTP $($r.StatusCode)" -ForegroundColor Green
    } catch {
        Write-Host "FAIL $url -> $($_.Exception.Message)" -ForegroundColor Red
    }
}

$runnerSvc = Get-Service -Name "actions.runner.*" -ErrorAction SilentlyContinue | Select-Object -First 1
Write-Host ""
if ($runnerSvc) {
    $color = if ($runnerSvc.Status -eq "Running") { "Green" } else { "Yellow" }
    Write-Host "GitHub runner service: $($runnerSvc.Name) [$($runnerSvc.Status)]" -ForegroundColor $color
} else {
    Write-Warning "No GitHub Actions runner service found. Deploy workflows will stay Queued."
    Write-Host "Run: .\scripts\register-self-hosted-runner.ps1 -RegistrationToken `"TOKEN`""
}
