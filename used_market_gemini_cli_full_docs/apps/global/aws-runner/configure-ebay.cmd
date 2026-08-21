@echo off
setlocal
title USED MARKET - eBay Production API Setup
cd /d "%~dp0.."
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0configure-ebay-credentials.ps1"
if errorlevel 1 (
  echo.
  echo eBay setup failed. The previous server configuration was preserved.
) else (
  echo.
  echo eBay setup and live verification passed.
)
pause
endlocal
