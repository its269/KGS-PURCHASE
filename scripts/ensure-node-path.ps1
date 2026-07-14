# Ensures npm/node are on PATH for this Windows server.
# Searches standard installation paths and project tool folders,
# then auto-downloads a portable Node.js into the repo .tools folder if nothing is found.

$ErrorActionPreference = 'Stop'

# Resolve user-specific base paths robustly (may be unset in service/CI accounts)
$userProfile = if ($env:USERPROFILE) { $env:USERPROFILE } else { 'C:\Users\Administrator' }
$appData     = if ($env:APPDATA)     { $env:APPDATA }     else { Join-Path $userProfile 'AppData\Roaming' }
$localData   = if ($env:LOCALAPPDATA){ $env:LOCALAPPDATA } else { Join-Path $userProfile 'AppData\Local' }

$repoRoot = Split-Path -Parent $PSScriptRoot
$portableNodeVersion = 'v20.18.1'
$portableNodeName = "node-$portableNodeVersion-win-x64"
$portableNodeDir = Join-Path $repoRoot ".tools\$portableNodeName"
$legacyKelinNode = 'C:\Users\Administrator\Desktop\Github\KelinConnect\kelin-connect-nextjs\.tools\node-v20.10.0-win-x64'

function Test-NpmDir([string]$dir) {
    if (-not $dir) { return $false }
    return (Test-Path (Join-Path $dir 'npm.cmd') -ErrorAction SilentlyContinue) -or
           (Test-Path (Join-Path $dir 'npm')     -ErrorAction SilentlyContinue)
}

function Add-PathFront([string]$dir) {
    if (-not $dir) { return }
    if (-not (Test-Path -LiteralPath $dir)) { return }

    # Remove any existing occurrence, then prepend so this install wins over stale PATH entries
    $parts = $env:Path -split ';' | Where-Object {
        $_ -and $_.TrimEnd('\') -ne $dir.TrimEnd('\')
    }
    $env:Path = ($dir + ';' + ($parts -join ';')).TrimEnd(';')
    Write-Host "Added to PATH: $dir"
}

function Install-PortableNode {
    Write-Host "npm not found on PATH. Installing portable Node.js $portableNodeVersion into .tools ..."
    $toolsRoot = Join-Path $repoRoot '.tools'
    New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null

    $zipName = "$portableNodeName.zip"
    $zipPath = Join-Path $toolsRoot $zipName
    $url = "https://nodejs.org/dist/$portableNodeVersion/$zipName"

    Write-Host "Downloading $url"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing

    Write-Host "Extracting to $toolsRoot"
    if (Test-Path $portableNodeDir) {
        Remove-Item -Recurse -Force $portableNodeDir
    }
    Expand-Archive -Path $zipPath -DestinationPath $toolsRoot -Force
    Remove-Item -Force $zipPath -ErrorAction SilentlyContinue

    if (-not (Test-NpmDir $portableNodeDir)) {
        throw "Portable Node install failed. Expected npm at: $portableNodeDir"
    }

    Write-Host "Portable Node ready: $portableNodeDir"
    return $portableNodeDir
}

$candidateNodeDirs = @(
    # Prefer the system install when present (avoids stale portable Node + broken native bindings)
    'C:\Program Files\nodejs',
    'C:\Program Files (x86)\nodejs',
    $portableNodeDir,
    (Join-Path $localData 'Programs\nodejs'),
    # Hardcoded Administrator profile fallbacks — needed when the runner service runs as
    # NETWORK SERVICE and $env:LOCALAPPDATA resolves to the service account profile instead
    # of the Administrator profile where Node.js is actually installed.
    'C:\Users\Administrator\AppData\Local\Programs\nodejs',
    # Chocolatey and Scoop package manager paths
    'C:\ProgramData\chocolatey\bin',
    'C:\tools\nodejs',
    # Volta version manager
    (Join-Path $userProfile '.volta\bin'),
    'C:\Users\Administrator\.volta\bin',
    $legacyKelinNode
)

# nvm-managed versions - search every known nvm root location
$nvmRoots = @()
if ($env:NVM_HOME) { $nvmRoots += $env:NVM_HOME }
$nvmRoots += (Join-Path $appData    'nvm')
$nvmRoots += (Join-Path $userProfile 'AppData\Roaming\nvm')
# Hardcoded Administrator profile nvm root — needed when runner service account differs from
# the Administrator account where nvm was installed.
$nvmRoots += 'C:\Users\Administrator\AppData\Roaming\nvm'
$nvmRoots += 'C:\nvm'
$nvmRoots += 'C:\nvm-windows'
# System-wide NVM for Windows installation path
$nvmRoots += 'C:\Program Files\nvm'

foreach ($nvmRoot in ($nvmRoots | Select-Object -Unique)) {
    if (Test-Path $nvmRoot -ErrorAction SilentlyContinue) {
        Get-ChildItem $nvmRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { $candidateNodeDirs += $_.FullName }
    }
}

# Broad scan: find any bundled node-v*-win-x64 distribution under Desktop\Github projects.
$githubRoot = 'C:\Users\Administrator\Desktop\Github'
if (Test-Path $githubRoot -ErrorAction SilentlyContinue) {
    Get-ChildItem $githubRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $proj = $_.FullName
        $toolsDir = Join-Path $proj '.tools'
        if (Test-Path $toolsDir -ErrorAction SilentlyContinue) {
            Get-ChildItem $toolsDir -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending |
                ForEach-Object { $candidateNodeDirs += $_.FullName }
        }
        Get-ChildItem $proj -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $subToolsDir = Join-Path $_.FullName '.tools'
            if (Test-Path $subToolsDir -ErrorAction SilentlyContinue) {
                Get-ChildItem $subToolsDir -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue |
                    Sort-Object Name -Descending |
                    ForEach-Object { $candidateNodeDirs += $_.FullName }
            }
        }
    }
}

$foundDir = $null
foreach ($dir in ($candidateNodeDirs | Select-Object -Unique)) {
    if (Test-NpmDir $dir) {
        $foundDir = $dir
        break
    }
}

if (-not $foundDir) {
    $foundDir = Install-PortableNode
}

Add-PathFront $foundDir

# Always ensure the user-roaming npm prefix (pm2, etc.) is on PATH
$npmRoaming = Join-Path $appData 'npm'
Add-PathFront $npmRoaming
# Hardcoded Administrator roaming npm — needed when runner service account differs
Add-PathFront 'C:\Users\Administrator\AppData\Roaming\npm'

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm not found after PATH setup. Tried: $($candidateNodeDirs -join '; ')"
}

Write-Host "npm: $((Get-Command npm).Source)"
Write-Host "node: $((Get-Command node -ErrorAction SilentlyContinue).Source)"
