<#
Patches C:\nginx\conf\nginx.conf to proxy /kgs-purchase -> 127.0.0.1:3001.
Run as Administrator, then reloads nginx.

  .\scripts\setup-kgs-purchase-proxy.ps1
#>
$ErrorActionPreference = 'Stop'

function Assert-Admin {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Error "Run as Administrator."
        exit 1
    }
}

Assert-Admin

$nginxConf = 'C:\nginx\conf\nginx.conf'
if (-not (Test-Path -LiteralPath $nginxConf)) {
    throw "Nginx config not found: $nginxConf"
}

$content = Get-Content -LiteralPath $nginxConf -Raw

if ($content -match 'upstream kgs_purchase') {
    Write-Host 'KGS-PURCHASE upstream already present in nginx.conf'
} else {
    $content = $content -replace '(upstream nextjs \{[^}]+\})', "`$1`r`n`r`n    upstream kgs_purchase {`r`n        server 127.0.0.1:3001;`r`n        keepalive 16;`r`n    }"
}

if ($content -notmatch 'location \^~ /kgs-purchase') {
    $locationBlock = @'

        # KGS-PURCHASE app (isolated from CMS on port 3000)
        location ^~ /kgs-purchase {
            proxy_pass http://kgs_purchase;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_connect_timeout 60s;
            proxy_send_timeout    60s;
            proxy_read_timeout    60s;
        }

'@
    $content = $content -replace '(\s+location / \{)', "$locationBlock`$1"
}

if ($content -notmatch '190\.82\.233\.232') {
    $content = $content -replace 'server_name\s+([^;]+);', 'server_name $1 190.82.233.232;'
}

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($nginxConf, $content, $utf8NoBom)
Write-Host "Updated $nginxConf"

Push-Location C:\nginx
& .\nginx.exe -t
if ($LASTEXITCODE -ne 0) { throw 'nginx -t failed' }
& .\nginx.exe -s reload
Pop-Location

Write-Host 'Nginx reloaded. Test: http://190.82.233.232/kgs-purchase/signin'
