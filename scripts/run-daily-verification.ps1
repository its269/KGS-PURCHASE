<#
Run all daily verification scripts (local dev or production server).

  .\scripts\run-daily-verification.ps1
  .\scripts\run-daily-verification.ps1 -BaseUrl "http://localhost:3001/kgs-purchase"
#>
param(
    [string]$RepoPath = $PSScriptRoot + "\..",
    [string]$BaseUrl = ""
)

$ErrorActionPreference = 'Continue'
Set-Location (Resolve-Path $RepoPath)

$steps = @(
    @{ Name = "Login";           Cmd = "node scripts/verify-login.mjs $BaseUrl".Trim() },
    @{ Name = "Company migration"; Cmd = "node scripts/verify-company-migration.mjs" },
    @{ Name = "Sync health";     Cmd = "node scripts/verify-sync-health.mjs" },
    @{ Name = "Ecommerce switch"; Cmd = "node scripts/verify-ecommerce-switch.mjs $BaseUrl".Trim() },
    @{ Name = "Replenishment QA"; Cmd = "node scripts/verify-replenishment-qa.mjs" },
    @{ Name = "PO annotations"; Cmd = "node scripts/verify-po-annotations.mjs $BaseUrl".Trim() }
)

$failed = 0
foreach ($step in $steps) {
    Write-Host "`n=== $($step.Name) ===" -ForegroundColor Cyan
    Invoke-Expression $step.Cmd
    if ($LASTEXITCODE -ne 0) { $failed++ }
}

Write-Host "`n=== Summary ===" -ForegroundColor Cyan
if ($failed -eq 0) {
    Write-Host "All $($steps.Count) checks passed." -ForegroundColor Green
} else {
    Write-Host "$failed of $($steps.Count) checks failed." -ForegroundColor Red
    exit 1
}
