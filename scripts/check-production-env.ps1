<#
Validates production .env before deploy/build. Run on the Windows server.

  .\scripts\check-production-env.ps1
#>
$ErrorActionPreference = 'Stop'

$repoPath = "C:\Users\Administrator\Desktop\Github\KGS-PURCHASE"
Set-Location $repoPath

if (-not (Test-Path -LiteralPath '.env')) {
    Write-Error @"
.env file is MISSING at $repoPath

Copy .env.example to .env and fill in Acumatica + MySQL values.
Login will fail with 'undefined/entity/auth/login' until ACUMATICA_BASE_URL is set.
"@
    exit 1
}

$required = @(
    'ACUMATICA_BASE_URL',
    'ACUMATICA_COMPANY',
    'MYSQL_HOST',
    'MYSQL_USER',
    'MYSQL_PASSWORD',
    'NEXT_PUBLIC_BASE_PATH',
    'SYNC_SECRET'
)

$envMap = @{}
Get-Content '.env' | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { return }
    $key = $line.Substring(0, $idx).Trim()
    $val = $line.Substring($idx + 1).Trim().Trim("'").Trim('"')
    $envMap[$key] = $val
}

$missing = @()
foreach ($key in $required) {
    if (-not $envMap[$key]) { $missing += $key }
}

if ($envMap['ACUMATICA_BASE_URL'] -match 'your-acumatica-host') {
    $missing += 'ACUMATICA_BASE_URL (still placeholder)'
}

if ($missing.Count -gt 0) {
    Write-Host "Missing or empty in .env:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "Fix .env on the server, then: pm2 reload kgs-purchase-http --update-env" -ForegroundColor Yellow
    exit 1
}

$mysqlHost = $envMap['MYSQL_HOST']
$mysqlPort = if ($envMap['MYSQL_PORT']) { [int]$envMap['MYSQL_PORT'] } else { 3306 }

function Test-TcpPort {
    param([string]$HostName, [int]$Port)
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $async = $client.BeginConnect($HostName, $Port, $null, $null)
        $ok = $async.AsyncWaitHandle.WaitOne(3000, $false)
        if ($ok -and $client.Connected) {
            $client.Close()
            return $true
        }
        $client.Close()
        return $false
    } catch {
        return $false
    }
}

$localhostMysql = Test-TcpPort -HostName '127.0.0.1' -Port $mysqlPort
$configuredMysql = Test-TcpPort -HostName $mysqlHost -Port $mysqlPort

if (-not $configuredMysql -and $localhostMysql -and $mysqlHost -ne '127.0.0.1' -and $mysqlHost -ne 'localhost') {
    Write-Error @"
MySQL is not reachable at MYSQL_HOST=$mysqlHost`:$mysqlPort, but 127.0.0.1`:$mysqlPort is open.

When MySQL runs on this server, set MYSQL_HOST=127.0.0.1 in .env (the public IP is often blocked by the firewall for local connections).
Then run: pm2 reload kgs-purchase-http --update-env
"@
    exit 1
}

if (-not $configuredMysql -and -not $localhostMysql) {
    Write-Error "MySQL is not reachable on $mysqlHost`:$mysqlPort or 127.0.0.1`:$mysqlPort. Start MySQL or fix MYSQL_HOST in .env."
    exit 1
}

Write-Host "OK - production .env has required variables." -ForegroundColor Green
Write-Host "  ACUMATICA_BASE_URL = $($envMap['ACUMATICA_BASE_URL'])"
Write-Host "  NEXT_PUBLIC_BASE_URL = $($envMap['NEXT_PUBLIC_BASE_URL'])"
