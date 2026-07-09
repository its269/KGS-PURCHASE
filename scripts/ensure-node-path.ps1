# Ensures npm/node are on PATH for this Windows server.
# Program Files\nodejs only has node.exe; full npm lives in KelinConnect tools.

$nodeTools = 'C:\Users\Administrator\Desktop\Github\KelinConnect\kelin-connect-nextjs\.tools\node-v20.10.0-win-x64'
$npmRoaming = Join-Path $env:APPDATA 'npm'

if (-not (Test-Path -LiteralPath (Join-Path $nodeTools 'npm.cmd'))) {
    throw "npm.cmd not found at $nodeTools"
}

$prefix = "$nodeTools;$npmRoaming;"
if ($env:Path -notlike "*$nodeTools*") {
    $env:Path = $prefix + $env:Path
}
