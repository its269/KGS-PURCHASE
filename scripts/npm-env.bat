@echo off
REM Use before npm commands in cmd.exe on this server.
REM Searches candidate Node.js directories in priority order.

set "NODE_TOOLS="
set "REPO=%~dp0.."

REM 0. Project-local portable Node (installed by ensure-node-path.ps1)
if exist "%REPO%\.tools\node-v20.18.1-win-x64\npm.cmd" (
    set "NODE_TOOLS=%REPO%\.tools\node-v20.18.1-win-x64"
    goto :found
)

REM 1. Standard system-wide installer path
if exist "C:\Program Files\nodejs\npm.cmd" (
    set "NODE_TOOLS=C:\Program Files\nodejs"
    goto :found
)

REM 2. Administrator local-appdata installer path
if exist "C:\Users\Administrator\AppData\Local\Programs\nodejs\npm.cmd" (
    set "NODE_TOOLS=C:\Users\Administrator\AppData\Local\Programs\nodejs"
    goto :found
)

REM 3. Scan Desktop\Github project .tools directories for any bundled node-v*-win-x64
for /D %%P in ("C:\Users\Administrator\Desktop\Github\*") do (
    for /D %%T in ("%%P\.tools\node-v*-win-x64") do (
        if exist "%%T\npm.cmd" (
            set "NODE_TOOLS=%%T"
            goto :found
        )
    )
    for /D %%S in ("%%P\*") do (
        for /D %%T in ("%%S\.tools\node-v*-win-x64") do (
            if exist "%%T\npm.cmd" (
                set "NODE_TOOLS=%%T"
                goto :found
            )
        )
    )
)

echo ERROR: npm not found. Run: powershell -File "%~dp0ensure-node-path.ps1"
exit /b 1

:found
set "PATH=%NODE_TOOLS%;%APPDATA%\npm;%PATH%"
