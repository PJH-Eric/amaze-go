@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 26.12.1 is required: https://nodejs.org
  pause
  exit /b 1
)

node -e "const [major, minor, patch] = process.versions.node.split('.').map(Number); if (major !== 26 || minor < 12 || (minor === 12 && patch < 1)) process.exit(1)"
if errorlevel 1 (
  echo Node.js 26.12.1 or a newer 26.x patch release is required.
  for /f %%V in ('node --version') do echo Current version: %%V
  echo Install Node.js 26.12.1: https://nodejs.org/
  echo.
  pause
  exit /b 1
)
start "" http://localhost:3080
node server.js
