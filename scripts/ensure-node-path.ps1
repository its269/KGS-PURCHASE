# Ensures npm/node are on PATH for this Windows server.
# Program Files\nodejs may only include node.exe on this host.

$defaultNodeTools = 'C:\Users\Administrator\Desktop\Github\KelinConnect\kelin-connect-nextjs\.tools\node-v20.10.0-win-x64'
$npmRoaming = Join-Path $env:APPDATA 'npm'

$hasBundledNpm = $false
try {
    $hasBundledNpm = Test-Path -LiteralPath (Join-Path $defaultNodeTools 'npm.cmd') -ErrorAction Stop
} catch {
    $hasBundledNpm = $false
}

if ($hasBundledNpm -and $env:Path -notlike "*$defaultNodeTools*") {
    $env:Path = "$defaultNodeTools;$npmRoaming;$env:Path"
} elseif ($env:Path -notlike "*$npmRoaming*") {
    $env:Path = "$npmRoaming;$env:Path"
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm command is not available for this runner account."
}
