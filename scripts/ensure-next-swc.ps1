# Ensures the Next.js Windows SWC native binary loads correctly.
# Corrupted downloads under node_modules/@next/swc-win32-x64-msvc cause:
#   "next-swc.win32-x64-msvc.node is not a valid Win32 application"
# Call after npm install and before `npm run build`.

$ErrorActionPreference = 'Continue'

function Test-NextSwcLoad {
    # Resolve from process.cwd() so a temp script outside the repo still finds node_modules
    $script = @'
const path = require("path");
const mod = path.join(process.cwd(), "node_modules", "@next", "swc-win32-x64-msvc");
try {
  require(mod);
  process.exit(0);
} catch (e) {
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
}
'@
    $tmp = Join-Path $env:TEMP ("kgs-swc-check-" + [guid]::NewGuid().ToString() + ".js")
    Set-Content -LiteralPath $tmp -Value $script -Encoding ASCII
    try {
        cmd /c "node `"$tmp`""
        return ($LASTEXITCODE -eq 0)
    } finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'node is not on PATH. Run ensure-node-path.ps1 first.'
}

if (-not (Test-Path -LiteralPath 'node_modules\next')) {
    Write-Host 'next is not installed yet - skipping SWC check'
    exit 0
}

$pkgJson = 'node_modules\next\package.json'
$nextVersion = $null
if (Test-Path -LiteralPath $pkgJson) {
    try {
        $nextVersion = (Get-Content -LiteralPath $pkgJson -Raw | ConvertFrom-Json).version
    } catch {
        $nextVersion = $null
    }
}

if (Test-NextSwcLoad) {
    Write-Host 'Next SWC native binary OK'
    exit 0
}

Write-Host 'Next SWC native binary failed to load - repairing...'

$swcDir = 'node_modules\@next\swc-win32-x64-msvc'
if (Test-Path -LiteralPath $swcDir) {
    Remove-Item -Recurse -Force -LiteralPath $swcDir -ErrorAction SilentlyContinue
}

# Drop a possibly corrupted package tarball from the local npm cache
$cache = if ($env:NPM_CONFIG_CACHE) { $env:NPM_CONFIG_CACHE } else { $null }
if ($cache -and (Test-Path -LiteralPath $cache)) {
    Get-ChildItem -LiteralPath $cache -Recurse -Directory -Filter 'swc-win32-x64-msvc*' -ErrorAction SilentlyContinue |
        ForEach-Object {
            Write-Host "Clearing cached SWC folder: $($_.FullName)"
            Remove-Item -Recurse -Force -LiteralPath $_.FullName -ErrorAction SilentlyContinue
        }
}

$spec = if ($nextVersion) { "@next/swc-win32-x64-msvc@$nextVersion" } else { '@next/swc-win32-x64-msvc' }
Write-Host "Reinstalling $spec"
cmd /c "npm install $spec --no-save --no-audit --no-fund"
if ($LASTEXITCODE -ne 0) {
    throw "Failed to reinstall $spec"
}

if (-not (Test-NextSwcLoad)) {
    throw 'Next SWC still failed to load after reinstall. Clear npm cache and retry.'
}

Write-Host 'Next SWC native binary repaired'
exit 0
