# Ensures npm/node are on PATH for this Windows server.
# Searches standard installation paths and a bundled tools fallback.

$candidateNodeDirs = @(
    'C:\Program Files\nodejs',
    'C:\Program Files (x86)\nodejs',
    'C:\Users\Administrator\Desktop\Github\KelinConnect\kelin-connect-nextjs\.tools\node-v20.10.0-win-x64'
)

# nvm-managed versions live under APPDATA\nvm
$nvmRoot = if ($env:NVM_HOME) { $env:NVM_HOME } else { Join-Path $env:APPDATA 'nvm' }
if (Test-Path $nvmRoot -ErrorAction SilentlyContinue) {
    Get-ChildItem $nvmRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { $candidateNodeDirs += $_.FullName }
}

foreach ($dir in $candidateNodeDirs) {
    if (-not $dir) { continue }
    $hasNpm = (Test-Path (Join-Path $dir 'npm.cmd') -ErrorAction SilentlyContinue) -or
              (Test-Path (Join-Path $dir 'npm')     -ErrorAction SilentlyContinue)
    if ($hasNpm -and $env:Path -notlike "*$dir*") {
        $env:Path = "$dir;$env:Path"
        Write-Host "Added to PATH: $dir"
        break
    }
}

# Always ensure the user-roaming npm prefix (pm2, etc.) is on PATH
$npmRoaming = if ($env:APPDATA) { Join-Path $env:APPDATA 'npm' } else { $null }
if ($npmRoaming -and $env:Path -notlike "*$npmRoaming*") {
    $env:Path = "$npmRoaming;$env:Path"
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm command is not available for this runner account."
}
