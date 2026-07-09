@echo off
REM Use before npm commands in cmd.exe on this server.
set "NODE_TOOLS=C:\Users\Administrator\Desktop\Github\KelinConnect\kelin-connect-nextjs\.tools\node-v20.10.0-win-x64"
if not exist "%NODE_TOOLS%\npm.cmd" (
    echo ERROR: npm not found at %NODE_TOOLS%
    exit /b 1
)
set "PATH=%NODE_TOOLS%;%APPDATA%\npm;%PATH%"
