@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo [ERROR] Node.js 22.13.0 or newer is required.
  exit /b 1
)
if not exist node_modules (
  call npm.cmd install || exit /b 1
)
echo Starting Supplier Comment Maintenance Workspace...
echo Default URL: http://localhost:3000/ (or the next available port)
call npm.cmd run dev
