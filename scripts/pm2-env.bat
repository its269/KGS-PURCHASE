@echo off
REM Ensure PM2 resolves the correct Windows home directory before any pm2 command.
if not defined HOMEPATH if defined USERPROFILE set "HOMEPATH=%USERPROFILE:C:=%"
if not defined HOME if defined USERPROFILE set "HOME=%USERPROFILE%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-pm2-env.ps1" >nul 2>nul
