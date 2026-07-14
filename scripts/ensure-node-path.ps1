# Ensures npm/node are on PATH for this Windows server.
# Searches standard installation paths and a bundled tools fallback.

# Resolve user-specific base paths robustly (may be unset in service/CI accounts)
$userProfile = if ($env:USERPROFILE) { $env:USERPROFILE } else { 'C:\Users\Administrator' }
$appData     = if ($env:APPDATA)     { $env:APPDATA }     else { Join-Path $userProfile 'AppData\Roaming' }
$localData   = if ($env:LOCALAPPDATA){ $env:LOCALAPPDATA } else { Join-Path $userProfile 'AppData\Local' }

$candidateNodeDirs = @(
    'C:\Program Files\nodejs',
    'C:\Program Files (x86)\nodejs',
    (Join-Path $localData 'Programs\nodejs'),
    'C:\Users\Administrator\Desktop\Github\KelinConnect\kelin-connect-nextjs\.tools\node-v20.10.0-win-x64'
)

# nvm-managed versions - search every known nvm root location
$nvmRoots = @()
if ($env:NVM_HOME) { $nvmRoots += $env:NVM_HOME }
$nvmRoots += (Join-Path $appData    'nvm')
$nvmRoots += (Join-Path $userProfile 'AppData\Roaming\nvm')
$nvmRoots += 'C:\nvm'
$nvmRoots += 'C:\nvm-windows'

foreach ($nvmRoot in ($nvmRoots | Select-Object -Unique)) {
    if (Test-Path $nvmRoot -ErrorAction SilentlyContinue) {
        Get-ChildItem $nvmRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { $candidateNodeDirs += $_.FullName }
    }
}

foreach ($dir in $candidateNodeDirs) {
    if (-not $dir) { continue }
    $hasNpm = (Test-Path (Join-Path $dir 'npm.cmd') -ErrorAction SilentlyContinue) -or
              (Test-Path (Join-Path $dir 'npm')     -ErrorAction SilentlyContinue)
    if ($hasNpm) {
        if ($env:Path -notlike "*$dir*") {
            $env:Path = "$dir;$env:Path"
            Write-Host "Added to PATH: $dir"
        }
        break
    }
}

# Always ensure the user-roaming npm prefix (pm2, etc.) is on PATH
$npmRoaming = Join-Path $appData 'npm'
if ($env:Path -notlike "*$npmRoaming*") {
    $env:Path = "$npmRoaming;$env:Path"
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm not found. Searched: $($candidateNodeDirs -join '; ')"
}
Write-Host "npm: $((Get-Command npm).Source)"
