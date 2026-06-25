<#
Registers a self-hosted GitHub Actions runner for KGS-PURCHASE on this Windows server.

Usage (run as Administrator):
  .\register-self-hosted-runner.ps1 -OwnerRepo "its269/KGS-PURCHASE" -RunnerName "kgs-purchase-runner"

Obtain a one-time token from:
  https://github.com/its269/KGS-PURCHASE/settings/actions/runners -> New self-hosted runner
#>
param(
    [Parameter(Mandatory = $false)]
    [string]$OwnerRepo = "its269/KGS-PURCHASE",

    [string]$RunnerName = "kgs-purchase-runner",
    [string]$RunnerLabels = "self-hosted,windows",
    [string]$RunnerVersion = "v2.308.0",
    [string]$InstallPath = "C:\actions-runner-kgs-purchase"
)

function Assert-Admin {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Error "Run as Administrator."
        exit 1
    }
}

Assert-Admin

Write-Host "Owner/Repo: $OwnerRepo"
Write-Host "Runner name: $RunnerName"
Write-Host "Install path: $InstallPath"

if (-not (Test-Path $InstallPath)) { New-Item -ItemType Directory -Path $InstallPath | Out-Null }
Set-Location $InstallPath

$zip = "actions-runner-win-x64-$RunnerVersion.zip"
$downloadUrl = "https://github.com/actions/runner/releases/download/$RunnerVersion/$zip"
Write-Host "Downloading $downloadUrl"
Invoke-WebRequest -Uri $downloadUrl -OutFile $zip -UseBasicParsing
Expand-Archive -Path $zip -DestinationPath . -Force

Write-Host ""
Write-Host "NEXT: Get registration token from GitHub, then run:"
Write-Host "  .\config.cmd --url `"https://github.com/$OwnerRepo`" --token TOKEN --name `"$RunnerName`" --work _work --labels `"$RunnerLabels`""
Write-Host ""
Write-Host "Then install as service (optional): .\run.cmd for interactive test first."
