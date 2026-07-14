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
    # Previously bundled node for KelinConnect project (kept for compatibility)
    'C:\Users\Administrator\Desktop\Github\KelinConnect\kelin-connect-nextjs\.tools\node-v20.10.0-win-x64'
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
# This handles version upgrades and new project .tools folders without script changes.
$githubRoot = 'C:\Users\Administrator\Desktop\Github'
if (Test-Path $githubRoot -ErrorAction SilentlyContinue) {
    Get-ChildItem $githubRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $proj = $_.FullName
        # Check .tools directly in each project root
        $toolsDir = Join-Path $proj '.tools'
        if (Test-Path $toolsDir -ErrorAction SilentlyContinue) {
            Get-ChildItem $toolsDir -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending |
                ForEach-Object { $candidateNodeDirs += $_.FullName }
        }
        # Also check one level deeper (e.g. Github\Org\repo\.tools\node-v*)
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
# Hardcoded Administrator roaming npm — needed when runner service account differs
$adminNpmRoaming = 'C:\Users\Administrator\AppData\Roaming\npm'
if ($env:Path -notlike "*$adminNpmRoaming*") {
    $env:Path = "$adminNpmRoaming;$env:Path"
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm not found. Searched: $($candidateNodeDirs -join '; ')"
}
Write-Host "npm: $((Get-Command npm).Source)"
