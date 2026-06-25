# Ensures PM2 can resolve the Windows home directory (HOMEPATH/HOME).
# Call before any pm2 CLI invocation in minimal shells (-NoProfile, Task Scheduler, CI).

if (-not $env:HOMEPATH -and $env:USERPROFILE) {
    $env:HOMEPATH = $env:USERPROFILE -replace '^[^:]+:', ''
}

if (-not $env:HOME -and $env:USERPROFILE) {
    $env:HOME = $env:USERPROFILE
}
